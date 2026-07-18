import { describe, expect, it } from "vitest";

import { assertHardenedRuntimeMode, isDemoMode, signalConfigSchema } from "./index.js";

const required = {
  APP_PUBLIC_URL: "http://localhost:3000",
  MOBILE_DEEP_LINK_SCHEME: "signal",
  DATABASE_URL: "postgresql://localhost/signal",
  REDIS_URL: "redis://localhost:6379",
  S3_ENDPOINT: "http://localhost:9000",
  S3_REGION: "us-east-1",
  S3_BUCKET: "signal-local",
  S3_ACCESS_KEY_ID: "test",
  S3_SECRET_ACCESS_KEY: "test",
  TEMPORAL_ADDRESS: "localhost:7233",
  TEMPORAL_NAMESPACE: "default",
  TEMPORAL_TASK_QUEUE_TASKS: "tasks",
  TEMPORAL_TASK_QUEUE_BROWSER: "browser",
  TEMPORAL_TASK_QUEUE_SANDBOX: "sandbox",
  TEMPORAL_TASK_QUEUE_DOCUMENTS: "documents",
  OIDC_ISSUER: "http://localhost:8080/realms/signal",
  OIDC_CLIENT_ID: "signal",
  OIDC_AUDIENCE: "signal",
  OIDC_MOBILE_REDIRECT_URI: "signal://oauth/callback",
  COMPOSIO_CALLBACK_URL: "http://localhost:3000/v1/connections/callback",
  OPA_URL: "http://localhost:8181",
  KMS_KEY_ID: "test",
  OTEL_EXPORTER_OTLP_ENDPOINT: "http://localhost:4318",
  CLAMAV_HOST: "localhost",
  BROWSER_IMAGE: "playwright:test",
  SANDBOX_IMAGE: "node:test",
};

describe("typed configuration", () => {
  it("uses the required model by default", () => {
    expect(signalConfigSchema.parse(required).META_MODEL_ID).toBe("meta/muse-spark-1.1");
  });

  it("rejects an invalid deep-link scheme", () => {
    expect(
      signalConfigSchema.safeParse({ ...required, MOBILE_DEEP_LINK_SCHEME: "Signal App" }).success,
    ).toBe(false);
  });

  it("never enables deterministic demo behavior in a hardened environment", () => {
    expect(isDemoMode({ NODE_ENV: "development", DEMO_MODE: "true" })).toBe(true);
    expect(isDemoMode({ NODE_ENV: "production", DEMO_MODE: "true" })).toBe(false);
    expect(() =>
      assertHardenedRuntimeMode({
        NODE_ENV: "production",
        DEMO_MODE: "true",
        PUSH_PROVIDER: "platform",
      }),
    ).toThrow("DEMO_MODE");
    expect(() =>
      assertHardenedRuntimeMode({
        NODE_ENV: "staging",
        DEMO_MODE: "false",
        PUSH_PROVIDER: "development",
      }),
    ).toThrow("APNs/FCM");
  });
});
