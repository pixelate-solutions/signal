import { execFile } from "node:child_process";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, normalize } from "node:path";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";

import Fastify from "fastify";
import { z } from "zod";

import {
  PostgresTenantRecordStore,
  S3ObjectStore,
  resolveSecretHandle,
  s3ClientConfigFromEnvironment,
} from "@signal/persistence";

import {
  AdapterSigner,
  AwsKmsAdapterSigner,
  RemoteSandboxProvider,
  assertGeneratedChangesScoped,
  sandboxJobSchema,
} from "./index.js";
import { SelfExtensionService } from "./extension-service.js";

const execFileAsync = promisify(execFile);
const scopeRequestSchema = z.object({ paths: z.array(z.string()).min(1).max(500) }).strict();
const createSchema = z
  .object({
    tenantId: z.string().min(8),
    taskId: z.string().min(8),
    userId: z.string().min(8),
    gap: z.unknown(),
  })
  .strict();
const tenantSchema = z.object({ tenantId: z.string().min(8) }).strict();
const approvalSchema = tenantSchema
  .extend({ userId: z.string().min(8), candidateDigest: z.string().min(8) })
  .strict();
const rollbackSchema = tenantSchema.extend({ reason: z.string().min(1).max(2_000) }).strict();

function required(name: string): string {
  const value = process.env[name];
  if (value === undefined || value.length === 0) throw new Error(`${name} is required.`);
  return value;
}

function authorizeService(raw: string | undefined): void {
  const expected = process.env["INTERNAL_SERVICE_TOKEN"];
  if (expected === undefined || raw !== expected)
    throw new Error("Internal authentication required.");
}

async function isolatedRunnerHost() {
  const app = Fastify({ logger: true, bodyLimit: 30 * 1024 * 1024 });
  let queuedExecutions = 0;
  let executionTail: Promise<unknown> = Promise.resolve();
  app.get("/health", async () => ({
    status: "ok",
    service: "sandbox-runner",
    isolation: process.env["SANDBOX_ISOLATION_CLASS"] ?? "node-permission-model",
    queuedExecutions,
  }));
  app.post("/v1/execute", async (request, reply) => {
    const expected = process.env["SANDBOX_RUNNER_TOKEN"];
    if (expected === undefined || request.headers.authorization !== `Bearer ${expected}`) {
      return reply.code(401).send({ error: "sandbox authentication required" });
    }
    const parsed = sandboxJobSchema.safeParse(request.body);
    if (!parsed.success) return reply.code(422).send({ error: "invalid sandbox job" });
    const job = parsed.data;
    if (
      job.command.length !== 3 ||
      job.command[0] !== "node" ||
      job.command[1] !== "--test" ||
      !/^[a-zA-Z0-9_./-]+\.mjs$/.test(job.command[2] ?? "")
    ) {
      return reply.code(403).send({ error: "sandbox command is not allowlisted" });
    }
    if (queuedExecutions >= 8) {
      return reply.header("retry-after", "1").code(429).send({ error: "sandbox queue is full" });
    }
    const execute = async () => {
      const workspace = await mkdtemp(join(tmpdir(), "signal-generated-"));
      try {
        let totalBytes = 0;
        for (const file of job.files ?? []) {
          const safe = normalize(file.path);
          if (safe.startsWith("..") || safe.startsWith("/") || safe.includes("\0")) {
            return reply.code(403).send({ error: "unsafe sandbox file path" });
          }
          const bytes = Buffer.from(file.contentBase64, "base64");
          totalBytes += bytes.byteLength;
          if (totalBytes > 20 * 1024 * 1024) {
            return reply.code(413).send({ error: "sandbox workspace is too large" });
          }
          const destination = join(workspace, safe);
          await mkdir(dirname(destination), { recursive: true, mode: 0o700 });
          await writeFile(destination, bytes, { mode: 0o600 });
        }
        const target = join(workspace, job.command[2] ?? "");
        const networkPermissions =
          job.networkMode === "none"
            ? []
            : job.egressDomains.map((domain) => `--allow-net=${domain}`);
        try {
          const execution = await execFileAsync(
            process.execPath,
            [
              "--permission",
              `--allow-fs-read=${workspace}`,
              ...networkPermissions,
              "--test",
              target,
            ],
            {
              cwd: workspace,
              timeout: job.timeoutMs,
              maxBuffer: 10 * 1024 * 1024,
              env: { PATH: "/usr/local/bin:/usr/bin:/bin", LANG: "C.UTF-8" },
            },
          );
          return {
            exitCode: 0,
            stdout: execution.stdout,
            stderr: execution.stderr,
            timedOut: false,
          };
        } catch (error) {
          const failure = error as {
            code?: number | string;
            stdout?: string;
            stderr?: string;
            killed?: boolean;
          };
          return {
            exitCode: typeof failure.code === "number" ? failure.code : 1,
            stdout: failure.stdout ?? "",
            stderr: failure.stderr ?? "Sandbox execution failed.",
            timedOut: failure.killed === true,
          };
        }
      } finally {
        await rm(workspace, { recursive: true, force: true });
      }
    };
    queuedExecutions += 1;
    const scheduled = executionTail.then(execute, execute);
    executionTail = scheduled.then(
      () => undefined,
      () => undefined,
    );
    try {
      return await scheduled;
    } finally {
      queuedExecutions -= 1;
    }
  });
  return app;
}

async function controllerHost() {
  const databaseUrl = required("DATABASE_URL");
  const records = new PostgresTenantRecordStore(databaseUrl);
  const objects = new S3ObjectStore(required("S3_BUCKET"), s3ClientConfigFromEnvironment());
  const production =
    process.env["NODE_ENV"] === "production" || process.env["NODE_ENV"] === "staging";
  const kmsSigningKeyId = process.env["ADAPTER_SIGNING_KMS_KEY_ID"];
  if (production && (kmsSigningKeyId === undefined || kmsSigningKeyId.length === 0)) {
    throw new Error("ADAPTER_SIGNING_KMS_KEY_ID is required outside development.");
  }
  const signingHandle = process.env["ADAPTER_SIGNING_KEY_HANDLE"];
  const signer =
    kmsSigningKeyId === undefined
      ? new AdapterSigner(
          Buffer.from(
            (signingHandle === undefined
              ? (process.env["INTERNAL_SERVICE_TOKEN"] ?? "signal-local-generated-signing-identity")
              : await resolveSecretHandle(signingHandle)
            ).padEnd(32, "0"),
          ),
        )
      : new AwsKmsAdapterSigner(kmsSigningKeyId, {
          region: process.env["S3_REGION"] ?? "us-east-1",
          ...(process.env["KMS_ENDPOINT"] === undefined
            ? {}
            : { endpoint: process.env["KMS_ENDPOINT"] }),
        });
  const sandbox = new RemoteSandboxProvider(
    required("SANDBOX_EXECUTOR_URL"),
    required("SANDBOX_RUNNER_TOKEN"),
  );
  const canaryUrl = process.env["GENERATED_CANARY_URL"];
  const service = new SelfExtensionService(
    records,
    objects,
    sandbox,
    signer,
    undefined,
    canaryUrl === undefined
      ? undefined
      : async (candidate) => {
          const response = await fetch(`${canaryUrl.replace(/\/$/, "")}/v1/canary`, {
            method: "POST",
            headers: {
              authorization: `Bearer ${required("GENERATED_CANARY_TOKEN")}`,
              "content-type": "application/json",
            },
            body: JSON.stringify({
              candidateId: candidate.id,
              candidateDigest: candidate.candidateDigest,
              provider: candidate.gap.provider,
              sideEffect: candidate.gap.sideEffect,
              runtime: {
                method: candidate.runtime.method,
                path: candidate.runtime.path,
              },
            }),
            signal: AbortSignal.timeout(120_000),
          });
          const body = (await response.json().catch(() => ({}))) as {
            passed?: boolean;
            summary?: string;
            evidenceDigest?: string;
          };
          return {
            passed: response.ok && body.passed === true,
            summary: body.summary ?? `External canary returned HTTP ${response.status}.`,
            ...(body.evidenceDigest === undefined ? {} : { evidenceDigest: body.evidenceDigest }),
          };
        },
  );
  const app = Fastify({ logger: true, bodyLimit: 2 * 1024 * 1024 });
  app.addHook("onRequest", async (request, reply) => {
    if (request.url === "/health") return;
    try {
      authorizeService(request.headers["x-signal-service-token"] as string | undefined);
    } catch {
      await reply.code(401).send({ error: "internal authentication required" });
    }
  });
  app.get("/health", async () => ({
    status: "ok",
    service: "sandbox-controller",
    execution: "isolated-remote-runner",
  }));
  app.post("/v1/validate-generated-scope", async (request, reply) => {
    const input = scopeRequestSchema.safeParse(request.body);
    if (!input.success) return reply.code(422).send({ valid: false, error: "invalid request" });
    try {
      assertGeneratedChangesScoped(input.data.paths);
      return { valid: true };
    } catch (error) {
      return reply.code(403).send({
        valid: false,
        error: error instanceof Error ? error.message : "generated scope denied",
      });
    }
  });
  app.post("/v1/candidates", async (request, reply) => {
    const input = createSchema.safeParse(request.body);
    if (!input.success) return reply.code(422).send({ error: "invalid capability gap" });
    return service.create(input.data);
  });
  app.get("/v1/candidates", async (request, reply) => {
    const input = tenantSchema.safeParse(request.query);
    if (!input.success) return reply.code(422).send({ error: "invalid tenant" });
    return { items: await service.list(input.data.tenantId), nextCursor: null };
  });
  app.get("/v1/candidates/:id", async (request, reply) => {
    const input = tenantSchema.safeParse(request.query);
    const id = (request.params as { id?: unknown }).id;
    if (!input.success || typeof id !== "string")
      return reply.code(422).send({ error: "invalid candidate" });
    const candidate = await service.get(input.data.tenantId, id);
    if (candidate === undefined) return reply.code(404).send({ error: "candidate not found" });
    return candidate;
  });
  app.post("/v1/candidates/:id/approve", async (request, reply) => {
    const input = approvalSchema.safeParse(request.body);
    const id = (request.params as { id?: unknown }).id;
    if (!input.success || typeof id !== "string")
      return reply.code(422).send({ error: "invalid approval" });
    return service.approve(input.data.tenantId, id, input.data.userId, input.data.candidateDigest);
  });
  app.post("/v1/candidates/:id/activate", async (request, reply) => {
    const input = tenantSchema.safeParse(request.body);
    const id = (request.params as { id?: unknown }).id;
    if (!input.success || typeof id !== "string")
      return reply.code(422).send({ error: "invalid activation" });
    return service.activate(input.data.tenantId, id);
  });
  app.post("/v1/candidates/:id/rollback", async (request, reply) => {
    const input = rollbackSchema.safeParse(request.body);
    const id = (request.params as { id?: unknown }).id;
    if (!input.success || typeof id !== "string")
      return reply.code(422).send({ error: "invalid rollback" });
    return service.rollback(input.data.tenantId, id, input.data.reason);
  });
  return app;
}

export async function createSandboxControllerHost() {
  return process.env["SANDBOX_RUNNER_MODE"] === "true" ? isolatedRunnerHost() : controllerHost();
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const app = await createSandboxControllerHost();
  await app.listen({ host: "0.0.0.0", port: Number(process.env["PORT"] ?? 3300) });
}
