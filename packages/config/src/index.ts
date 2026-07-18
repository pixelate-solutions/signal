import { z } from "zod";

const optionalSecret = z.string().min(1).optional();

export const signalConfigSchema = z
  .object({
    NODE_ENV: z.enum(["development", "test", "staging", "production"]).default("development"),
    APP_PUBLIC_URL: z.url(),
    MOBILE_DEEP_LINK_SCHEME: z.string().regex(/^[a-z][a-z0-9+.-]*$/),
    PORT: z.coerce.number().int().min(1).max(65_535).default(3000),
    DEMO_MODE: z
      .enum(["true", "false"])
      .default("false")
      .transform((value) => value === "true"),
    DATABASE_URL: z.url(),
    REDIS_URL: z.url(),
    S3_ENDPOINT: z.url().optional(),
    S3_REGION: z.string().min(1),
    S3_BUCKET: z.string().min(3),
    S3_ACCESS_KEY_ID: z.string().min(1).optional(),
    S3_SECRET_ACCESS_KEY: z.string().min(1).optional(),
    TEMPORAL_ADDRESS: z.string().min(1),
    TEMPORAL_NAMESPACE: z.string().min(1),
    TEMPORAL_TLS: z
      .enum(["true", "false"])
      .default("false")
      .transform((value) => value === "true"),
    TEMPORAL_API_KEY: optionalSecret,
    TEMPORAL_TASK_QUEUE_TASKS: z.string().min(1),
    TEMPORAL_TASK_QUEUE_BROWSER: z.string().min(1),
    TEMPORAL_TASK_QUEUE_SANDBOX: z.string().min(1),
    TEMPORAL_TASK_QUEUE_DOCUMENTS: z.string().min(1),
    OIDC_ISSUER: z.url(),
    OIDC_PUBLIC_ISSUER: z.url().optional(),
    OIDC_JWKS_URL: z.url().optional(),
    OIDC_CLIENT_ID: z.string().min(1),
    OIDC_AUDIENCE: z.string().min(1),
    OIDC_MOBILE_CLIENT_ID: z.string().min(1).default("signal-mobile"),
    OIDC_MOBILE_REDIRECT_URI: z.string().min(1),
    META_MODEL_API_BASE_URL: z.url().default("https://api.meta.ai/v1"),
    META_MODEL_API_KEY: optionalSecret,
    META_MODEL_ID: z.string().default("meta/muse-spark-1.1"),
    META_MODEL_API_VERSION: z.string().default("public-preview-2026-07"),
    COMPOSIO_API_KEY: optionalSecret,
    COMPOSIO_CALLBACK_URL: z.url(),
    COMPOSIO_AUTH_CONFIGS_JSON: optionalSecret,
    COMPOSIO_TOOLS_JSON: optionalSecret,
    GOOGLE_OAUTH_CLIENT_ID: optionalSecret,
    GOOGLE_OAUTH_CLIENT_SECRET_HANDLE: optionalSecret,
    GITHUB_OAUTH_CLIENT_ID: optionalSecret,
    GITHUB_OAUTH_CLIENT_SECRET_HANDLE: optionalSecret,
    OAUTH_STATE_SIGNING_KEY_HANDLE: optionalSecret,
    OPA_URL: z.url(),
    KMS_KEY_ID: z.string().min(1),
    KMS_ENDPOINT: z.url().optional(),
    PUSH_PROVIDER: z.enum(["development", "firebase", "platform"]).default("development"),
    FIREBASE_SERVICE_ACCOUNT_JSON_HANDLE: optionalSecret,
    FIREBASE_PROJECT_ID: optionalSecret,
    APNS_KEY_HANDLE: optionalSecret,
    OTEL_EXPORTER_OTLP_ENDPOINT: z.url(),
    CLAMAV_HOST: z.string().min(1),
    BROWSER_IMAGE: z.string().min(1),
    SANDBOX_IMAGE: z.string().min(1),
  })
  .strict()
  .superRefine((value, context) => {
    if ((value.S3_ACCESS_KEY_ID === undefined) !== (value.S3_SECRET_ACCESS_KEY === undefined)) {
      context.addIssue({
        code: "custom",
        message: "S3_ACCESS_KEY_ID and S3_SECRET_ACCESS_KEY must be configured together.",
        path: ["S3_ACCESS_KEY_ID"],
      });
    }
  });

export type SignalConfig = z.infer<typeof signalConfigSchema>;

export function isDemoMode(environment: NodeJS.ProcessEnv = process.env): boolean {
  return (
    environment["NODE_ENV"] === "test" ||
    (environment["NODE_ENV"] === "development" && environment["DEMO_MODE"] === "true")
  );
}

export function assertHardenedRuntimeMode(environment: NodeJS.ProcessEnv = process.env): void {
  if (environment["NODE_ENV"] !== "staging" && environment["NODE_ENV"] !== "production") return;
  if (environment["DEMO_MODE"] !== "false") {
    throw new Error("DEMO_MODE must be explicitly disabled in staging and production.");
  }
  if (!["firebase", "platform"].includes(environment["PUSH_PROVIDER"] ?? "")) {
    throw new Error("A production APNs/FCM push provider is required in staging and production.");
  }
}

export function loadConfig(environment: NodeJS.ProcessEnv = process.env): SignalConfig {
  return signalConfigSchema.parse(environment);
}
