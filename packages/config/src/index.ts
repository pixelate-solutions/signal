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
    S3_ENDPOINT: z.url(),
    S3_REGION: z.string().min(1),
    S3_BUCKET: z.string().min(3),
    S3_ACCESS_KEY_ID: z.string().min(1),
    S3_SECRET_ACCESS_KEY: z.string().min(1),
    TEMPORAL_ADDRESS: z.string().min(1),
    TEMPORAL_NAMESPACE: z.string().min(1),
    TEMPORAL_TASK_QUEUE_TASKS: z.string().min(1),
    TEMPORAL_TASK_QUEUE_BROWSER: z.string().min(1),
    TEMPORAL_TASK_QUEUE_SANDBOX: z.string().min(1),
    TEMPORAL_TASK_QUEUE_DOCUMENTS: z.string().min(1),
    OIDC_ISSUER: z.url(),
    OIDC_CLIENT_ID: z.string().min(1),
    OIDC_AUDIENCE: z.string().min(1),
    OIDC_MOBILE_REDIRECT_URI: z.string().min(1),
    META_MODEL_API_BASE_URL: z.url().default("https://api.meta.ai/v1"),
    META_MODEL_API_KEY: optionalSecret,
    META_MODEL_ID: z.string().default("meta/muse-spark-1.1"),
    META_MODEL_API_VERSION: z.string().default("public-preview-2026-07"),
    COMPOSIO_API_KEY: optionalSecret,
    COMPOSIO_CALLBACK_URL: z.url(),
    OPA_URL: z.url(),
    KMS_KEY_ID: z.string().min(1),
    PUSH_PROVIDER: z.enum(["development", "firebase"]).default("development"),
    FIREBASE_SERVICE_ACCOUNT_JSON_HANDLE: optionalSecret,
    APNS_KEY_HANDLE: optionalSecret,
    OTEL_EXPORTER_OTLP_ENDPOINT: z.url(),
    CLAMAV_HOST: z.string().min(1),
    BROWSER_IMAGE: z.string().min(1),
    SANDBOX_IMAGE: z.string().min(1),
  })
  .strict();

export type SignalConfig = z.infer<typeof signalConfigSchema>;

export function loadConfig(environment: NodeJS.ProcessEnv = process.env): SignalConfig {
  return signalConfigSchema.parse(environment);
}
