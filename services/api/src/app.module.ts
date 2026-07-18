import { createHash } from "node:crypto";

import { Module } from "@nestjs/common";
import { GoogleAuth } from "google-auth-library";

import { ArtifactService, ClamAvScanner, HttpDocumentProcessor } from "@signal/artifact-service";
import { DeviceCommandProtocol } from "@signal/auth-sdk";
import {
  ConnectionManager,
  CredentialBroker,
  InMemoryEncryptedSecretStore,
  parseComposioAuthConfigs,
  type SecretStore,
} from "@signal/connection-service";
import { isDemoMode } from "@signal/config";
import {
  HttpIdentityOperationsProvider,
  HttpIdentityLifecycleProvider,
  IdentityService,
  OidcAdminIdentityLifecycleProvider,
  SesInvitationDeliveryProvider,
} from "@signal/identity-service";
import { MemoryService } from "@signal/memory-service";
import {
  ApnsPushProvider,
  DevelopmentPushSink,
  FirebasePushProvider,
  NotificationService,
  PlatformPushProvider,
} from "@signal/notification-service";
import {
  AwsKmsEnvelopeCipher,
  InMemoryObjectStore,
  InMemoryTenantRecordStore,
  LocalEnvelopeCipher,
  PostgresEnvelopeSecretStore,
  PostgresTenantRecordStore,
  S3ObjectStore,
  resolveSecretHandle,
  s3ClientConfigFromEnvironment,
  type ObjectStore,
  type TenantRecordStore,
} from "@signal/persistence";
import { InMemoryTaskStore, PostgresTaskStore, SignalTaskService } from "@signal/task-service";

import { SignalAuthGuard } from "./auth.js";
import { ActionsController } from "./controllers/actions.controller.js";
import { BrowserSessionsController } from "./controllers/browser.controller.js";
import {
  ArtifactsController,
  UploadPartsController,
  UploadsController,
} from "./controllers/artifacts.controller.js";
import {
  ConnectionCallbackController,
  ConnectionsController,
} from "./controllers/connections.controller.js";
import { ConversationsController } from "./controllers/conversations.controller.js";
import {
  DevicesController,
  InternalDeviceCommandsController,
} from "./controllers/devices.controller.js";
import { DevelopmentController } from "./controllers/development.controller.js";
import { DeveloperCapabilitiesController } from "./controllers/developer.controller.js";
import { HealthController } from "./controllers/health.controller.js";
import {
  AccountController,
  IdentityConfigurationController,
  InvitationLandingController,
} from "./controllers/identity.controller.js";
import { MemoriesController } from "./controllers/memories.controller.js";
import { OpsController } from "./controllers/ops.controller.js";
import { OperationsControlController } from "./controllers/operations-control.controller.js";
import { PoliciesController } from "./controllers/policies.controller.js";
import { SecurityController } from "./controllers/security.controller.js";
import { SettingsController } from "./controllers/settings.controller.js";
import { TasksController } from "./controllers/tasks.controller.js";
import { DeviceRegistry, SettingsManager } from "./control-plane.js";
import { DemoTaskRuntime } from "./demo-runtime.js";
import { DemoTaskRuntimeAdapter, TemporalTaskRuntime } from "./task-runtime.js";
import { PolicyControlService } from "./policy-control.js";
import { OperationsControlService } from "./operations-control.js";
import { RuntimeMaintenanceService } from "./runtime-maintenance.js";
import {
  ARTIFACT_SERVICE,
  CONNECTION_MANAGER,
  CREDENTIAL_BROKER,
  DEVELOPMENT_PUSH_SINK,
  DEVICE_REGISTRY,
  IDENTITY_SERVICE,
  MEMORY_SERVICE,
  NOTIFICATION_SERVICE,
  OBJECT_STORE,
  OPERATIONS_CONTROL,
  POLICY_CONTROL,
  RECORD_STORE,
  RUNTIME_MAINTENANCE,
  SECRET_STORE,
  SETTINGS_MANAGER,
  TASK_RUNTIME,
  TASK_SERVICE,
} from "./tokens.js";

@Module({
  controllers: [
    HealthController,
    IdentityConfigurationController,
    InvitationLandingController,
    AccountController,
    ConversationsController,
    TasksController,
    ActionsController,
    SecurityController,
    UploadPartsController,
    UploadsController,
    ArtifactsController,
    BrowserSessionsController,
    MemoriesController,
    SettingsController,
    ConnectionsController,
    ConnectionCallbackController,
    DevicesController,
    InternalDeviceCommandsController,
    OpsController,
    OperationsControlController,
    PoliciesController,
    DevelopmentController,
    DeveloperCapabilitiesController,
  ],
  providers: [
    SignalAuthGuard,
    {
      provide: RECORD_STORE,
      useFactory: (): TenantRecordStore => {
        if (process.env["NODE_ENV"] === "test") return new InMemoryTenantRecordStore();
        const databaseUrl = process.env["DATABASE_URL"];
        if (databaseUrl === undefined) throw new Error("DATABASE_URL is required.");
        return new PostgresTenantRecordStore(databaseUrl);
      },
    },
    {
      provide: OBJECT_STORE,
      useFactory: (): ObjectStore => {
        if (process.env["NODE_ENV"] === "test") return new InMemoryObjectStore();
        const bucket = process.env["S3_BUCKET"];
        const region = process.env["S3_REGION"];
        if (bucket === undefined || region === undefined) {
          throw new Error("S3 bucket and region are required.");
        }
        return new S3ObjectStore(bucket, s3ClientConfigFromEnvironment());
      },
    },
    {
      provide: IDENTITY_SERVICE,
      inject: [OBJECT_STORE, RECORD_STORE],
      useFactory: (objects: ObjectStore, records: TenantRecordStore) => {
        const databaseUrl = process.env["DATABASE_URL"];
        if (databaseUrl === undefined && process.env["NODE_ENV"] !== "test") {
          throw new Error("DATABASE_URL is required for identity persistence.");
        }
        const lifecycleEndpoint = process.env["IDENTITY_LIFECYCLE_ENDPOINT"];
        const lifecycleTokenHandle = process.env["IDENTITY_LIFECYCLE_TOKEN_HANDLE"];
        const oidcAdminClientId = process.env["OIDC_ADMIN_CLIENT_ID"];
        const oidcAdminSecretHandle = process.env["OIDC_ADMIN_CLIENT_SECRET_HANDLE"];
        const operationsEndpoint = process.env["IDENTITY_OPERATIONS_ENDPOINT"];
        const operationsTokenHandle = process.env["IDENTITY_OPERATIONS_TOKEN_HANDLE"];
        const invitationEmailFrom = process.env["INVITATION_EMAIL_FROM"];
        const production =
          process.env["NODE_ENV"] === "production" || process.env["NODE_ENV"] === "staging";
        if (
          production &&
          (lifecycleEndpoint === undefined || lifecycleTokenHandle === undefined) &&
          (oidcAdminClientId === undefined || oidcAdminSecretHandle === undefined)
        ) {
          throw new Error(
            "Configure either OIDC_ADMIN_CLIENT_ID/OIDC_ADMIN_CLIENT_SECRET_HANDLE or the generic identity lifecycle endpoint outside development.",
          );
        }
        if (
          production &&
          invitationEmailFrom === undefined &&
          (operationsEndpoint === undefined || operationsTokenHandle === undefined)
        ) {
          throw new Error(
            "Configure INVITATION_EMAIL_FROM for SES or IDENTITY_OPERATIONS_ENDPOINT/IDENTITY_OPERATIONS_TOKEN_HANDLE for invitation delivery outside development.",
          );
        }
        const identityOperations =
          operationsEndpoint !== undefined && operationsTokenHandle !== undefined
            ? new HttpIdentityOperationsProvider(operationsEndpoint, () =>
                resolveSecretHandle(operationsTokenHandle),
              )
            : undefined;
        return new IdentityService(
          databaseUrl ?? "postgresql://unused:unused@localhost:5432/unused",
          objects,
          records,
          oidcAdminClientId !== undefined && oidcAdminSecretHandle !== undefined
            ? new OidcAdminIdentityLifecycleProvider(
                process.env["OIDC_ISSUER"] ?? "",
                oidcAdminClientId,
                () => resolveSecretHandle(oidcAdminSecretHandle),
              )
            : lifecycleEndpoint !== undefined && lifecycleTokenHandle !== undefined
              ? new HttpIdentityLifecycleProvider(lifecycleEndpoint, () =>
                  resolveSecretHandle(lifecycleTokenHandle),
                )
              : undefined,
          invitationEmailFrom === undefined
            ? identityOperations
            : new SesInvitationDeliveryProvider(invitationEmailFrom, {
                region: process.env["S3_REGION"] ?? "us-east-1",
              }),
          identityOperations,
          process.env["APP_PUBLIC_URL"] ?? "http://localhost:3000",
        );
      },
    },
    {
      provide: SECRET_STORE,
      useFactory: (): SecretStore => {
        if (process.env["NODE_ENV"] === "test") return new InMemoryEncryptedSecretStore();
        const databaseUrl = process.env["DATABASE_URL"];
        const keyId = process.env["KMS_KEY_ID"];
        if (databaseUrl === undefined || keyId === undefined) {
          throw new Error("DATABASE_URL and KMS_KEY_ID are required for encrypted credentials.");
        }
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
      },
    },
    {
      provide: CREDENTIAL_BROKER,
      inject: [SECRET_STORE, RECORD_STORE],
      useFactory: (secretStore: SecretStore, records: TenantRecordStore) =>
        new CredentialBroker(secretStore, undefined, records),
    },
    {
      provide: ARTIFACT_SERVICE,
      inject: [RECORD_STORE, OBJECT_STORE],
      useFactory: (records: TenantRecordStore, objects: ObjectStore) =>
        new ArtifactService(
          process.env["APP_PUBLIC_URL"] ?? "http://localhost:3000",
          undefined,
          process.env["NODE_ENV"] === "test"
            ? undefined
            : new ClamAvScanner(process.env["CLAMAV_HOST"] ?? "localhost"),
          records,
          objects,
          process.env["NODE_ENV"] === "test"
            ? undefined
            : new HttpDocumentProcessor(
                process.env["DOCUMENT_WORKER_URL"] ?? "http://document-worker:3400",
              ),
        ),
    },
    {
      provide: MEMORY_SERVICE,
      inject: [RECORD_STORE],
      useFactory: (records: TenantRecordStore) => new MemoryService(undefined, records),
    },
    {
      provide: SETTINGS_MANAGER,
      inject: [RECORD_STORE],
      useFactory: (records: TenantRecordStore) => new SettingsManager(records),
    },
    {
      provide: POLICY_CONTROL,
      inject: [RECORD_STORE],
      useFactory: (records: TenantRecordStore) => new PolicyControlService(records),
    },
    {
      provide: OPERATIONS_CONTROL,
      inject: [RECORD_STORE],
      useFactory: (records: TenantRecordStore) => new OperationsControlService(records),
    },
    RuntimeMaintenanceService,
    {
      provide: RUNTIME_MAINTENANCE,
      useExisting: RuntimeMaintenanceService,
    },
    {
      provide: DEVICE_REGISTRY,
      inject: [RECORD_STORE, CREDENTIAL_BROKER, NOTIFICATION_SERVICE],
      useFactory: async (
        records: TenantRecordStore,
        broker: CredentialBroker,
        notifications: NotificationService,
      ) => {
        const handle = process.env["DEVICE_COMMAND_SIGNING_SEED_HANDLE"];
        if (
          (process.env["NODE_ENV"] === "production" || process.env["NODE_ENV"] === "staging") &&
          (handle === undefined || handle.length === 0)
        ) {
          throw new Error("DEVICE_COMMAND_SIGNING_SEED_HANDLE is required outside development.");
        }
        const material =
          handle === undefined || handle.length === 0
            ? (process.env["INTERNAL_SERVICE_TOKEN"] ?? "signal-local-device-signing-seed")
            : await resolveSecretHandle(handle);
        const decoded = Buffer.from(material, "base64url");
        const seed =
          decoded.byteLength === 32 ? decoded : createHash("sha256").update(material).digest();
        return new DeviceRegistry(records, broker, new DeviceCommandProtocol(seed), notifications);
      },
    },
    { provide: DEVELOPMENT_PUSH_SINK, useFactory: () => new DevelopmentPushSink() },
    {
      provide: NOTIFICATION_SERVICE,
      inject: [DEVELOPMENT_PUSH_SINK, RECORD_STORE, CREDENTIAL_BROKER],
      useFactory: async (
        sink: DevelopmentPushSink,
        records: TenantRecordStore,
        broker: CredentialBroker,
      ) => {
        const pushMode = process.env["PUSH_PROVIDER"] ?? "development";
        if (pushMode === "development") {
          return new NotificationService(sink, undefined, records);
        }
        const handle = process.env["FIREBASE_SERVICE_ACCOUNT_JSON_HANDLE"];
        if (handle === undefined) {
          throw new Error("FIREBASE_SERVICE_ACCOUNT_JSON_HANDLE is required for Firebase push.");
        }
        const credentials = JSON.parse(await resolveSecretHandle(handle)) as Record<
          string,
          unknown
        >;
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
            if (token === null || token === undefined) {
              throw new Error("Firebase access token unavailable.");
            }
            return token;
          },
          async (credentialHandle, message) =>
            (await resolvePushToken(credentialHandle, message)).token,
        );
        if (pushMode === "firebase") {
          return new NotificationService(firebase, undefined, records);
        }
        if (pushMode !== "platform") {
          throw new Error(`Unsupported PUSH_PROVIDER ${pushMode}.`);
        }
        const apnsKeyHandle = process.env["APNS_KEY_HANDLE"];
        const teamId = process.env["APNS_TEAM_ID"];
        const keyId = process.env["APNS_KEY_ID"];
        const bundleId = process.env["APNS_BUNDLE_ID"];
        if (
          apnsKeyHandle === undefined ||
          teamId === undefined ||
          keyId === undefined ||
          bundleId === undefined
        ) {
          throw new Error(
            "APNS_KEY_HANDLE, APNS_TEAM_ID, APNS_KEY_ID, and APNS_BUNDLE_ID are required for platform push.",
          );
        }
        const provider = new PlatformPushProvider(resolvePushToken, {
          firebase,
          apns: new ApnsPushProvider({
            teamId,
            keyId,
            bundleId,
            resolvePrivateKey: () => resolveSecretHandle(apnsKeyHandle),
            production: process.env["APNS_ENVIRONMENT"] === "production",
          }),
        });
        return new NotificationService(provider, undefined, records);
      },
    },
    {
      provide: CONNECTION_MANAGER,
      inject: [RECORD_STORE, CREDENTIAL_BROKER],
      useFactory: async (records: TenantRecordStore, broker: CredentialBroker) => {
        const googleClientId = process.env["GOOGLE_OAUTH_CLIENT_ID"];
        const googleSecretHandle = process.env["GOOGLE_OAUTH_CLIENT_SECRET_HANDLE"];
        const githubClientId = process.env["GITHUB_OAUTH_CLIENT_ID"];
        const githubSecretHandle = process.env["GITHUB_OAUTH_CLIENT_SECRET_HANDLE"];
        const composioAuthConfigs = parseComposioAuthConfigs(
          process.env["COMPOSIO_AUTH_CONFIGS_JSON"],
        );
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
        const signingHandle = process.env["OAUTH_STATE_SIGNING_KEY_HANDLE"];
        const signingSecret =
          signingHandle === undefined || signingHandle.length === 0
            ? (process.env["INTERNAL_SERVICE_TOKEN"] ?? "signal-local-oauth-state-signing-secret")
            : await resolveSecretHandle(signingHandle);
        if (
          (process.env["NODE_ENV"] === "production" || process.env["NODE_ENV"] === "staging") &&
          (signingHandle === undefined || signingHandle.length === 0)
        ) {
          throw new Error("OAUTH_STATE_SIGNING_KEY_HANDLE is required outside development.");
        }
        return new ConnectionManager(
          {
            publicBaseUrl: process.env["APP_PUBLIC_URL"] ?? "http://localhost:3000",
            demoMode: isDemoMode(),
            oauthStateSigningKey: createHash("sha256").update(signingSecret).digest(),
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
      },
    },
    {
      provide: TASK_SERVICE,
      useFactory: () => {
        if (process.env["NODE_ENV"] === "test") {
          return new SignalTaskService(new InMemoryTaskStore());
        }
        const databaseUrl = process.env["DATABASE_URL"];
        if (databaseUrl === undefined) {
          throw new Error("DATABASE_URL is required for durable task execution.");
        }
        return new SignalTaskService(new PostgresTaskStore(databaseUrl));
      },
    },
    {
      provide: TASK_RUNTIME,
      inject: [TASK_SERVICE, NOTIFICATION_SERVICE],
      useFactory: async (tasks: SignalTaskService, notifications: NotificationService) => {
        if (process.env["NODE_ENV"] === "test") {
          return new DemoTaskRuntimeAdapter(new DemoTaskRuntime(tasks, notifications));
        }
        return TemporalTaskRuntime.connect({
          address: process.env["TEMPORAL_ADDRESS"] ?? "localhost:7233",
          namespace: process.env["TEMPORAL_NAMESPACE"] ?? "default",
          taskQueue: process.env["TEMPORAL_TASK_QUEUE_TASKS"] ?? "signal-tasks",
          tls: process.env["TEMPORAL_TLS"] === "true",
          ...(process.env["TEMPORAL_API_KEY"] === undefined
            ? {}
            : { apiKey: process.env["TEMPORAL_API_KEY"] }),
        });
      },
    },
  ],
})
export class AppModule {}
