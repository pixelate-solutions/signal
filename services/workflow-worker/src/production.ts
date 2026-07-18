import { createHash } from "node:crypto";
import { createServer } from "node:http";

import { GoogleAuth } from "google-auth-library";

import { ArtifactService, HttpDocumentProcessor } from "@signal/artifact-service";
import { assertHardenedRuntimeMode, isDemoMode } from "@signal/config";
import {
  costLedgerEntrySchema,
  providerHealthSchema,
  type ProviderHealth,
} from "@signal/contracts";
import {
  ConnectionManager,
  CredentialBroker,
  parseComposioAuthConfigs,
  type SecretStore,
} from "@signal/connection-service";
import { MemoryService } from "@signal/memory-service";
import { MetaMuseSparkProvider, ObservedModelProvider } from "@signal/model-gateway";
import {
  ApnsPushProvider,
  DevelopmentPushSink,
  FirebasePushProvider,
  NotificationService,
  PlatformPushProvider,
  type PushProvider,
} from "@signal/notification-service";
import {
  AwsKmsEnvelopeCipher,
  LocalEnvelopeCipher,
  PostgresEnvelopeSecretStore,
  PostgresTenantRecordStore,
  S3ObjectStore,
  resolveSecretHandle,
  s3ClientConfigFromEnvironment,
} from "@signal/persistence";
import {
  PostgresApprovalDirectory,
  PostgresTaskStore,
  SignalTaskService,
} from "@signal/task-service";

import { ProductionWorkflowActivities } from "./activities.js";
import type { WorkflowActivities } from "./types.js";
import { runWorker } from "./worker.js";

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

async function signingKey(): Promise<Uint8Array> {
  const handle = process.env["OAUTH_STATE_SIGNING_KEY_HANDLE"];
  if (
    (process.env["NODE_ENV"] === "production" || process.env["NODE_ENV"] === "staging") &&
    (handle === undefined || handle.length === 0)
  ) {
    throw new Error("OAUTH_STATE_SIGNING_KEY_HANDLE is required outside development.");
  }
  const secret =
    handle === undefined || handle.length === 0
      ? (process.env["INTERNAL_SERVICE_TOKEN"] ?? "signal-local-oauth-state-signing-secret")
      : await resolveSecretHandle(handle);
  return createHash("sha256").update(secret).digest();
}

async function pushProvider(broker: CredentialBroker): Promise<PushProvider> {
  const pushMode = process.env["PUSH_PROVIDER"] ?? "development";
  if (pushMode === "development") return new DevelopmentPushSink();
  const handle = required("FIREBASE_SERVICE_ACCOUNT_JSON_HANDLE");
  const credentials = JSON.parse(await resolveSecretHandle(handle)) as Record<string, unknown>;
  const credentialProjectId = credentials["project_id"];
  const projectId =
    process.env["FIREBASE_PROJECT_ID"] ??
    (typeof credentialProjectId === "string" ? credentialProjectId : "");
  if (projectId.length === 0) throw new Error("FIREBASE_PROJECT_ID is required.");
  const auth = new GoogleAuth({
    credentials,
    projectId,
    scopes: ["https://www.googleapis.com/auth/firebase.messaging"],
  });
  const resolvePushToken = (
    credentialHandle: string,
    message: { tenantId: string; actionRequestId: string },
  ) =>
    broker.withCredential(
      credentialHandle,
      {
        tenantId: message.tenantId,
        taskId: message.actionRequestId,
        adapter: "push.delivery",
      },
      async (plaintext) => {
        const parsed = JSON.parse(plaintext) as {
          token?: string;
          platform?: "ios" | "android";
        };
        if (parsed.token === undefined || parsed.platform === undefined) {
          throw new Error("Push token credential is malformed.");
        }
        return { token: parsed.token, platform: parsed.platform };
      },
    );
  const firebase = new FirebasePushProvider(
    projectId,
    async () => {
      const token = await auth.getAccessToken();
      if (token === null || token === undefined)
        throw new Error("Firebase access token unavailable.");
      return token;
    },
    async (credentialHandle, message) => (await resolvePushToken(credentialHandle, message)).token,
  );
  if (pushMode === "firebase") return firebase;
  if (pushMode !== "platform") throw new Error(`Unsupported PUSH_PROVIDER ${pushMode}.`);
  const apnsKeyHandle = required("APNS_KEY_HANDLE");
  return new PlatformPushProvider(resolvePushToken, {
    firebase,
    apns: new ApnsPushProvider({
      teamId: required("APNS_TEAM_ID"),
      keyId: required("APNS_KEY_ID"),
      bundleId: required("APNS_BUNDLE_ID"),
      resolvePrivateKey: () => resolveSecretHandle(apnsKeyHandle),
      production: process.env["APNS_ENVIRONMENT"] === "production",
    }),
  });
}

assertHardenedRuntimeMode();
const databaseUrl = required("DATABASE_URL");
const records = new PostgresTenantRecordStore(databaseUrl);
const objects = new S3ObjectStore(required("S3_BUCKET"), s3ClientConfigFromEnvironment());
const secretStore = await createSecretStore(databaseUrl);
const broker = new CredentialBroker(secretStore, undefined, records);
const googleClientId = process.env["GOOGLE_OAUTH_CLIENT_ID"];
const googleSecretHandle = process.env["GOOGLE_OAUTH_CLIENT_SECRET_HANDLE"];
const githubClientId = process.env["GITHUB_OAUTH_CLIENT_ID"];
const githubSecretHandle = process.env["GITHUB_OAUTH_CLIENT_SECRET_HANDLE"];
const composioAuthConfigs = parseComposioAuthConfigs(process.env["COMPOSIO_AUTH_CONFIGS_JSON"]);
const composioParts = [
  process.env["COMPOSIO_API_KEY"],
  process.env["COMPOSIO_CALLBACK_URL"],
  composioAuthConfigs,
  process.env["COMPOSIO_TOOLS_JSON"],
].filter((value) => value !== undefined);
if (composioParts.length > 0 && composioParts.length < 4) {
  throw new Error(
    "Composio requires COMPOSIO_API_KEY, COMPOSIO_CALLBACK_URL, COMPOSIO_AUTH_CONFIGS_JSON, and COMPOSIO_TOOLS_JSON together.",
  );
}
const connections = new ConnectionManager(
  {
    publicBaseUrl: process.env["APP_PUBLIC_URL"] ?? "http://localhost:3000",
    demoMode: isDemoMode(),
    oauthStateSigningKey: await signingKey(),
    ...(process.env["COMPOSIO_API_KEY"] === undefined
      ? {}
      : { composioApiKey: process.env["COMPOSIO_API_KEY"] }),
    ...(process.env["COMPOSIO_CALLBACK_URL"] === undefined
      ? {}
      : { composioCallbackUrl: process.env["COMPOSIO_CALLBACK_URL"] }),
    ...(composioAuthConfigs === undefined ? {} : { composioAuthConfigs }),
    ...(googleClientId === undefined || googleSecretHandle === undefined
      ? {}
      : {
          googleOAuth: {
            clientId: googleClientId,
            resolveClientSecret: () => resolveSecretHandle(googleSecretHandle),
          },
        }),
    ...(githubClientId === undefined || githubSecretHandle === undefined
      ? {}
      : {
          githubOAuth: {
            clientId: githubClientId,
            resolveClientSecret: () => resolveSecretHandle(githubSecretHandle),
          },
        }),
  },
  { records, broker },
);
const tasks = new SignalTaskService(
  new PostgresTaskStore(databaseUrl),
  undefined,
  undefined,
  new PostgresApprovalDirectory(databaseUrl),
);
const memories = new MemoryService(undefined, records);
const artifacts = new ArtifactService(
  process.env["APP_PUBLIC_URL"] ?? "http://localhost:3000",
  undefined,
  undefined,
  records,
  objects,
  new HttpDocumentProcessor(process.env["DOCUMENT_WORKER_URL"] ?? "http://document-worker:3400"),
);
const metaModel = new MetaMuseSparkProvider({
  baseUrl: process.env["META_MODEL_API_BASE_URL"] ?? "https://api.meta.ai/v1",
  ...(process.env["META_MODEL_API_KEY"] === undefined
    ? {}
    : { apiKey: process.env["META_MODEL_API_KEY"] }),
  model: process.env["META_MODEL_ID"] ?? "meta/muse-spark-1.1",
  apiVersion: process.env["META_MODEL_API_VERSION"] ?? "public-preview-2026-07",
});
const model = new ObservedModelProvider(metaModel, async (observation) => {
  const provider = observation.metadata?.provider ?? "meta-model-api";
  const usage = observation.metadata?.usage ?? {
    inputTokens: 0,
    outputTokens: 0,
    reasoningTokens: 0,
  };
  const inputRate = Number(process.env["META_INPUT_COST_MICROS_PER_MILLION"] ?? 0);
  const outputRate = Number(process.env["META_OUTPUT_COST_MICROS_PER_MILLION"] ?? 0);
  const reasoningRate = Number(process.env["META_REASONING_COST_MICROS_PER_MILLION"] ?? outputRate);
  const costMicros = Math.max(
    0,
    Math.ceil(
      (usage.inputTokens * inputRate +
        usage.outputTokens * outputRate +
        usage.reasoningTokens * reasoningRate) /
        1_000_000,
    ),
  );
  await records.runExclusive(observation.request.metadata.tenantId, async (transaction) => {
    const previous = await transaction.get<ProviderHealth>("provider.health", provider);
    const executions = (previous?.executions ?? 0) + 1;
    const success = observation.error === null;
    const successes = (previous?.successes ?? 0) + (success ? 1 : 0);
    const consecutiveFailures = success ? 0 : (previous?.consecutiveFailures ?? 0) + 1;
    const circuit = consecutiveFailures >= 5 ? "open" : "closed";
    await transaction.put(
      "provider.health",
      provider,
      providerHealthSchema.parse({
        provider,
        state: circuit === "open" ? "unavailable" : success ? "healthy" : "degraded",
        circuit,
        executions,
        successes,
        consecutiveFailures,
        reliability: successes / executions,
        latencyMs:
          previous === undefined
            ? observation.durationMs
            : previous.latencyMs * 0.8 + observation.durationMs * 0.2,
        estimatedCostMinor: Math.floor(costMicros / 10_000),
        lastErrorClass: success ? null : "model_provider",
        lastObservedAt: observation.observedAt,
        nextProbeAt: circuit === "open" ? new Date(Date.now() + 60_000).toISOString() : null,
      }),
    );
    const ledgerId = `cst_model_${observation.request.requestId.replace(/[^a-zA-Z0-9_-]/g, "_")}`;
    await transaction.put(
      "provider.cost-ledger",
      ledgerId,
      costLedgerEntrySchema.parse({
        id: ledgerId,
        tenantId: observation.request.metadata.tenantId,
        taskId: observation.request.metadata.taskId,
        userId: null,
        provider,
        capability: `model.${observation.metadata?.model ?? "unknown"}`,
        inputUnits: usage.inputTokens,
        outputUnits: usage.outputTokens,
        reasoningUnits: usage.reasoningTokens,
        durationMs: observation.durationMs,
        costMinor: Math.floor(costMicros / 10_000),
        costMicros,
        currency: "USD",
        occurredAt: observation.observedAt,
      }),
    );
  });
});
const notifications = new NotificationService(await pushProvider(broker), undefined, records);
const implementation = new ProductionWorkflowActivities({
  tasks,
  memories,
  connections,
  model,
  records,
  notifications,
  artifacts,
});
const activities: WorkflowActivities = {
  initializeTask: implementation.initializeTask.bind(implementation),
  transitionTask: implementation.transitionTask.bind(implementation),
  retrieveAndPlan: implementation.retrieveAndPlan.bind(implementation),
  executeStep: implementation.executeStep.bind(implementation),
  createActionRequest: implementation.createActionRequest.bind(implementation),
  recordInstruction: implementation.recordInstruction.bind(implementation),
  recordExternalEvent: implementation.recordExternalEvent.bind(implementation),
  verifyOutcome: implementation.verifyOutcome.bind(implementation),
  completeTask: implementation.completeTask.bind(implementation),
  failTask: implementation.failTask.bind(implementation),
  persistCheckpoint: implementation.persistCheckpoint.bind(implementation),
  revokeTaskLeases: implementation.revokeTaskLeases.bind(implementation),
};

let ready = false;
const health = createServer(async (request, response) => {
  if (request.url === "/provider-health") {
    if (!ready) {
      response.writeHead(503, { "content-type": "application/json" });
      response.end(JSON.stringify({ status: "starting", service: "workflow-worker" }));
      return;
    }
    try {
      const modelHealth = await metaModel.health();
      response.writeHead(modelHealth.status === "healthy" ? 200 : 503, {
        "content-type": "application/json",
      });
      response.end(
        JSON.stringify({
          status: modelHealth.status === "healthy" ? "ok" : "degraded",
          service: "workflow-worker",
          providers: { model: modelHealth },
        }),
      );
    } catch (error) {
      response.writeHead(503, { "content-type": "application/json" });
      response.end(
        JSON.stringify({
          status: "degraded",
          service: "workflow-worker",
          providers: {
            model: {
              status: "unhealthy",
              reason: error instanceof Error ? error.message : "Provider probe failed.",
            },
          },
        }),
      );
    }
    return;
  }
  if (request.url !== "/health") {
    response.writeHead(404).end();
    return;
  }
  response.writeHead(ready ? 200 : 503, { "content-type": "application/json" });
  response.end(JSON.stringify({ status: ready ? "ok" : "starting", service: "workflow-worker" }));
});
health.listen(Number(process.env["PORT"] ?? 3500), "0.0.0.0");

await runWorker({
  activities,
  onReady: () => {
    ready = true;
  },
});
