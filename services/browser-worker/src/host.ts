import { createHash, randomUUID } from "node:crypto";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { fileURLToPath } from "node:url";

import Fastify from "fastify";
import { z } from "zod";

import { ArtifactService, ClamAvScanner, HttpDocumentProcessor } from "@signal/artifact-service";
import type { Principal } from "@signal/auth-sdk";
import { CredentialBroker, type SecretStore } from "@signal/connection-service";
import {
  AwsKmsEnvelopeCipher,
  LocalEnvelopeCipher,
  PostgresEnvelopeSecretStore,
  PostgresTenantRecordStore,
  S3ObjectStore,
  s3ClientConfigFromEnvironment,
  type ObjectStore,
  type TenantRecordStore,
} from "@signal/persistence";

import {
  BrowserOperator,
  PlaywrightEngine,
  browserModeSchema,
  browserStepSchema,
  type BrowserEvidence,
} from "./index.js";

const SESSION_NAMESPACE = "browser.sessions";
const EVENT_NAMESPACE = "browser.events";
const EVIDENCE_NAMESPACE = "browser.evidence";

const requestSchema = z
  .object({
    sessionId: z.string().min(8).optional(),
    tenantId: z.string().min(8),
    userId: z.string().min(8),
    taskId: z.string().min(8),
    allowlist: z.array(z.string().min(1)).min(1).max(50),
    mode: browserModeSchema,
    steps: z.array(browserStepSchema).min(1).max(100),
    approvedFinalActionDigest: z.string().optional(),
  })
  .strict();

type BrowserJob = z.infer<typeof requestSchema>;

type BrowserSession = {
  id: string;
  tenantId: string;
  userId: string;
  taskId: string;
  allowlist: string[];
  profileHandle: string | null;
  status: "RUNNING" | "SUCCEEDED" | "TAKEOVER_REQUIRED" | "MFA_REQUIRED" | "FAILED";
  completedSteps: number;
  artifactIds: string[];
  createdAt: string;
  updatedAt: string;
  lastError: string | null;
};

type BrowserRuntime = {
  records: TenantRecordStore;
  objects: ObjectStore;
  broker: CredentialBroker;
  artifacts: ArtifactService;
};

function required(name: string): string {
  const value = process.env[name];
  if (value === undefined || value.length === 0) throw new Error(`${name} is required.`);
  return value;
}

async function createSecretStore(databaseUrl: string): Promise<SecretStore> {
  const keyId = required("KMS_KEY_ID");
  const production =
    process.env["NODE_ENV"] === "production" || process.env["NODE_ENV"] === "staging";
  const cipher = production
    ? new AwsKmsEnvelopeCipher(keyId, {
        region: process.env["S3_REGION"] ?? "us-east-1",
        ...(process.env["KMS_ENDPOINT"] === undefined
          ? {}
          : { endpoint: process.env["KMS_ENDPOINT"] }),
      })
    : new LocalEnvelopeCipher(
        process.env["INTERNAL_SERVICE_TOKEN"] ?? "signal-local-development-envelope-secret",
        keyId,
      );
  return new PostgresEnvelopeSecretStore(databaseUrl, cipher);
}

async function createRuntime(): Promise<BrowserRuntime> {
  const databaseUrl = required("DATABASE_URL");
  const records = new PostgresTenantRecordStore(databaseUrl);
  const objects = new S3ObjectStore(required("S3_BUCKET"), s3ClientConfigFromEnvironment());
  const broker = new CredentialBroker(await createSecretStore(databaseUrl), undefined, records);
  return {
    records,
    objects,
    broker,
    artifacts: new ArtifactService(
      process.env["APP_PUBLIC_URL"] ?? "http://localhost:3000",
      undefined,
      new ClamAvScanner(process.env["CLAMAV_HOST"] ?? "clamav"),
      records,
      objects,
      new HttpDocumentProcessor(
        process.env["DOCUMENT_WORKER_URL"] ?? "http://document-worker:3400",
      ),
    ),
  };
}

function principal(job: BrowserJob): Principal {
  const now = new Date();
  return {
    subject: "service|browser-worker",
    tenantId: job.tenantId,
    userId: job.userId,
    roles: ["service_operator"],
    scopes: ["browser:execute"],
    sessionId: `ses_browser_${createHash("sha256").update(job.taskId).digest("hex").slice(0, 20)}`,
    authenticatedAt: now.toISOString(),
    expiresAt: new Date(now.getTime() + 300_000).toISOString(),
    deviceId: null,
  };
}

async function sessionFor(runtime: BrowserRuntime, job: BrowserJob): Promise<BrowserSession> {
  const id = job.sessionId ?? `brs_${randomUUID().replaceAll("-", "")}`;
  return runtime.records.runExclusive(job.tenantId, async (transaction) => {
    const existing = await transaction.get<BrowserSession>(SESSION_NAMESPACE, id);
    if (existing !== undefined) {
      if (existing.taskId !== job.taskId || existing.userId !== job.userId) {
        throw new Error("Browser session does not belong to this task and user.");
      }
      return existing;
    }
    const now = new Date().toISOString();
    const created: BrowserSession = {
      id,
      tenantId: job.tenantId,
      userId: job.userId,
      taskId: job.taskId,
      allowlist: job.allowlist,
      profileHandle: null,
      status: "RUNNING",
      completedSteps: 0,
      artifactIds: [],
      createdAt: now,
      updatedAt: now,
      lastError: null,
    };
    await transaction.put(SESSION_NAMESPACE, id, created);
    return created;
  });
}

async function appendEvent(
  runtime: BrowserRuntime,
  session: BrowserSession,
  type: string,
  detail: Record<string, unknown>,
): Promise<void> {
  await runtime.records.runExclusive(session.tenantId, async (transaction) => {
    const existing = (await transaction.list<{ sessionId: string }>(EVENT_NAMESPACE)).filter(
      (event) => event.sessionId === session.id,
    );
    const sequence = existing.length + 1;
    await transaction.put(EVENT_NAMESPACE, `${session.id}:${String(sequence).padStart(8, "0")}`, {
      id: `bev_${randomUUID().replaceAll("-", "")}`,
      sessionId: session.id,
      taskId: session.taskId,
      sequence,
      type,
      detail,
      occurredAt: new Date().toISOString(),
    });
  });
}

async function storageState(
  runtime: BrowserRuntime,
  session: BrowserSession,
): Promise<string | undefined> {
  if (session.profileHandle === null) return undefined;
  return runtime.broker.withCredential(
    session.profileHandle,
    { tenantId: session.tenantId, taskId: session.taskId, adapter: "browser.profile.restore" },
    async (plaintext) => plaintext,
  );
}

async function runBrowserJob(runtime: BrowserRuntime, job: BrowserJob) {
  const session = await sessionFor(runtime, job);
  const sessionPrincipal = principal(job);
  const temporaryDirectory = await mkdtemp(join(tmpdir(), "signal-browser-"));
  const requireTls =
    process.env["NODE_ENV"] === "production" || process.env["NODE_ENV"] === "staging";
  const engine = await PlaywrightEngine.launch({
    allowlist: session.allowlist,
    requireTls,
    ...(await storageState(runtime, session).then((value) =>
      value === undefined ? {} : { storageState: value },
    )),
    ...(process.env["CHROMIUM_EXECUTABLE_PATH"] === undefined
      ? {}
      : { executablePath: process.env["CHROMIUM_EXECUTABLE_PATH"] }),
  });
  await runtime.records.runExclusive(job.tenantId, async (transaction) => {
    await transaction.put(SESSION_NAMESPACE, session.id, {
      ...session,
      status: "RUNNING",
      updatedAt: new Date().toISOString(),
      lastError: null,
    } satisfies BrowserSession);
  });
  try {
    const operator = new BrowserOperator(
      engine,
      (handle) =>
        runtime.broker.withCredential(
          handle,
          { tenantId: job.tenantId, taskId: job.taskId, adapter: "browser.form.fill" },
          async (plaintext) => plaintext,
        ),
      { event: (type, detail) => appendEvent(runtime, session, type, detail) },
      {
        resolveArtifact: async (artifactId) => {
          const artifact = await runtime.artifacts.get(sessionPrincipal, artifactId);
          const path = join(temporaryDirectory, basename(artifact.originalName));
          await writeFile(path, await runtime.artifacts.bytes(sessionPrincipal, artifactId), {
            mode: 0o600,
          });
          return path;
        },
        persistSession: async (state) => {
          let profileHandle = session.profileHandle;
          if (profileHandle === null) {
            profileHandle = await runtime.broker.create(
              {
                tenantId: job.tenantId,
                ownerUserId: job.userId,
                provider: "browser",
                secretType: "browser_state",
              },
              state,
            );
          } else {
            await runtime.broker.rotate(profileHandle, job.tenantId, state);
          }
          session.profileHandle = profileHandle;
        },
        captureEvidence: async (evidence: BrowserEvidence, screenshot) => {
          const screenshotKey = `tenants/${job.tenantId}/browser/${session.id}/evidence/${evidence.id}.png`;
          await runtime.objects.put(screenshotKey, screenshot, "image/png");
          await runtime.records.runExclusive(job.tenantId, async (transaction) => {
            await transaction.put(EVIDENCE_NAMESPACE, evidence.id, {
              ...evidence,
              tenantId: job.tenantId,
              taskId: job.taskId,
              sessionId: session.id,
              screenshotKey,
            });
            await transaction.put("evidence.items", evidence.id, {
              ...evidence,
              tenantId: job.tenantId,
              taskId: job.taskId,
              type: "browser_state",
              screenshotKey,
            });
          });
        },
        captureDownload: async (download) => {
          const artifact = await runtime.artifacts.ingest(sessionPrincipal, download);
          await appendEvent(runtime, session, "browser.download_captured", {
            artifactId: artifact.id,
            fileName: artifact.originalName,
            checksum: artifact.checksum,
          });
          return artifact.id;
        },
      },
      requireTls,
    );
    const { approvedFinalActionDigest, ...jobWithoutDigest } = job;
    const result = await operator.execute({
      ...jobWithoutDigest,
      steps: job.steps.slice(session.completedSteps),
      ...(approvedFinalActionDigest === undefined ? {} : { approvedFinalActionDigest }),
    });
    const updated: BrowserSession = {
      ...session,
      profileHandle: session.profileHandle,
      status: result.status,
      completedSteps: session.completedSteps + result.completedSteps,
      artifactIds: [...new Set([...session.artifactIds, ...result.artifactIds])],
      updatedAt: new Date().toISOString(),
      lastError: null,
    };
    await runtime.records.runExclusive(job.tenantId, async (transaction) => {
      await transaction.put(SESSION_NAMESPACE, session.id, updated);
    });
    await appendEvent(runtime, updated, `browser.${result.status.toLowerCase()}`, {
      completedSteps: updated.completedSteps,
      evidenceIds: result.evidence.map((item) => item.id),
      artifactIds: updated.artifactIds,
    });
    return { session: updated, evidence: result.evidence };
  } catch (error) {
    const failed: BrowserSession = {
      ...session,
      status: "FAILED",
      updatedAt: new Date().toISOString(),
      lastError: error instanceof Error ? error.message : "Browser execution failed.",
    };
    await runtime.records.runExclusive(job.tenantId, async (transaction) => {
      await transaction.put(SESSION_NAMESPACE, session.id, failed);
    });
    await appendEvent(runtime, failed, "browser.failed", { reason: failed.lastError });
    throw error;
  } finally {
    await rm(temporaryDirectory, { recursive: true, force: true });
  }
}

export async function createBrowserWorkerHost(runtime?: BrowserRuntime) {
  runtime ??= await createRuntime();
  const app = Fastify({ logger: true, bodyLimit: 2 * 1024 * 1024 });
  app.addHook("onRequest", async (request, reply) => {
    if (request.url === "/health") return;
    const expected = process.env["INTERNAL_SERVICE_TOKEN"];
    if (
      process.env["NODE_ENV"] !== "development" &&
      (expected === undefined || request.headers["x-signal-service-token"] !== expected)
    ) {
      await reply.code(401).send({ error: "internal authentication required" });
    }
  });
  app.get("/health", async () => ({ status: "ok", service: "browser-worker" }));
  app.post("/v1/run", async (request, reply) => {
    const parsed = requestSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(422).send({ error: "invalid browser job", issues: parsed.error.issues });
    }
    return runBrowserJob(runtime, parsed.data);
  });
  app.get("/v1/sessions/:id", async (request, reply) => {
    const query = z.object({ tenantId: z.string().min(8) }).safeParse(request.query);
    const id = z
      .string()
      .min(8)
      .safeParse((request.params as { id?: unknown }).id);
    if (!query.success || !id.success) return reply.code(422).send({ error: "invalid query" });
    const session = await runtime.records.runExclusive(query.data.tenantId, (transaction) =>
      transaction.get<BrowserSession>(SESSION_NAMESPACE, id.data),
    );
    if (session === undefined) return reply.code(404).send({ error: "session not found" });
    return session;
  });
  app.get("/v1/sessions/:id/events", async (request, reply) => {
    const query = z.object({ tenantId: z.string().min(8) }).safeParse(request.query);
    const id = z
      .string()
      .min(8)
      .safeParse((request.params as { id?: unknown }).id);
    if (!query.success || !id.success) return reply.code(422).send({ error: "invalid query" });
    const events = await runtime.records.runExclusive(query.data.tenantId, async (transaction) =>
      (
        await transaction.list<Record<string, unknown> & { sessionId: string; sequence: number }>(
          EVENT_NAMESPACE,
        )
      )
        .filter((event) => event.sessionId === id.data)
        .sort((left, right) => left.sequence - right.sequence),
    );
    return { items: events, nextCursor: null };
  });
  return app;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const app = await createBrowserWorkerHost();
  await app.listen({ host: "0.0.0.0", port: Number(process.env["PORT"] ?? 3200) });
}
