#!/usr/bin/env bash
set -euo pipefail

for signal_command in aws jq openssl terraform; do
  if ! command -v "$signal_command" >/dev/null 2>&1; then
    echo "Missing required command: $signal_command" >&2
    exit 1
  fi
done

: "${SIGNAL_RUNTIME_INPUT_FILE:?Set SIGNAL_RUNTIME_INPUT_FILE to a private JSON file based on infra/runtime-secret.example.json.}"
signal_terraform_dir="${SIGNAL_TERRAFORM_DIR:-infra/terraform/aws}"

if [[ ! -r "$SIGNAL_RUNTIME_INPUT_FILE" ]]; then
  echo "Runtime input is not readable: $SIGNAL_RUNTIME_INPUT_FILE" >&2
  exit 1
fi

if ! jq -e '
  def pem($label):
    ("^" + ("-" * 5) + "BEGIN " + $label + ("-" * 5) + "[\\s\\S]+" + ("-" * 5) + "END " + $label + ("-" * 5) + "\\n?$");
  . as $input |
  [
    $input.APP_PUBLIC_URL,
    $input.TEMPORAL_ADDRESS,
    $input.TEMPORAL_NAMESPACE,
    $input.TEMPORAL_API_KEY,
    $input.OIDC_ISSUER,
    $input.OIDC_PUBLIC_ISSUER,
    $input.OIDC_JWKS_URL,
    $input.OIDC_CLIENT_ID,
    $input.OIDC_AUDIENCE,
    $input.OIDC_MOBILE_CLIENT_ID,
    $input.OIDC_MOBILE_REDIRECT_URI,
    $input.OIDC_OPS_CLIENT_ID,
    $input.OIDC_OPS_REDIRECT_URI,
    $input.OIDC_ADMIN_CLIENT_ID,
    $input.OIDC_ADMIN_CLIENT_SECRET,
    $input.INVITATION_EMAIL_FROM,
    $input.META_MODEL_API_KEY,
    $input.TRANSCRIPTION_API_URL,
    $input.TRANSCRIPTION_API_TOKEN,
    $input.TRANSCRIPTION_MODEL,
    $input.GOOGLE_OAUTH_CLIENT_ID,
    $input.GOOGLE_OAUTH_CLIENT_SECRET,
    $input.GITHUB_OAUTH_CLIENT_ID,
    $input.GITHUB_OAUTH_CLIENT_SECRET,
    $input.GITHUB_RUNNER_APP_ID,
    $input.GITHUB_RUNNER_INSTALLATION_ID,
    $input.GITHUB_RUNNER_PRIVATE_KEY,
    $input.GHCR_USERNAME,
    $input.GHCR_PULL_TOKEN,
    $input.COMPOSIO_API_KEY,
    $input.FIREBASE_PROJECT_ID,
    $input.APNS_PRIVATE_KEY,
    $input.APNS_TEAM_ID,
    $input.APNS_KEY_ID,
    $input.APNS_BUNDLE_ID,
    $input.APNS_ENVIRONMENT
  ] | all(type == "string" and length > 0) and
  ($input.COMPOSIO_AUTH_CONFIGS | type == "object" and length > 0 and all(.[]; type == "string" and length > 0)) and
  ($input.COMPOSIO_TOOLS | type == "array" and length > 0 and all(.[];
    type == "object" and
    (.name | type == "string" and length > 0) and
    (.toolSlug | type == "string" and length > 0) and
    (.toolVersion | type == "string" and length > 0 and ascii_downcase != "latest") and
    (.provider | type == "string" and length > 0) and
    (.description | type == "string" and length > 0) and
    (.inputSchema | type == "object") and
    (.requiredScopes | type == "array") and
    (.riskClass | IN("R0", "R1", "R2", "R3", "R4")) and
    (.sideEffect | IN("none", "reversible", "external", "financial", "irreversible")) and
    ((.sideEffect == "none") or (.verification | type == "object"))
  )) and
  ($input.FIREBASE_SERVICE_ACCOUNT | type == "object" and length > 0) and
  ($input.GENERATED_CANARY_CONFIG | type == "object") and
  ([$input | .. | strings | select(test("CHANGE_ME|replace-me|example\\.invalid"; "i"))] | length == 0) and
  ($input.APP_PUBLIC_URL | startswith("https://")) and
  ($input.OIDC_ISSUER | startswith("https://")) and
  ($input.OIDC_PUBLIC_ISSUER | startswith("https://")) and
  ($input.OIDC_JWKS_URL | startswith("https://")) and
  ($input.TRANSCRIPTION_API_URL | startswith("https://")) and
  ($input.GOOGLE_OAUTH_CLIENT_ID | test("^[0-9]+-[A-Za-z0-9_-]+\\.apps\\.googleusercontent\\.com$")) and
  ($input.GITHUB_RUNNER_APP_ID | test("^[0-9]+$")) and
  ($input.GITHUB_RUNNER_INSTALLATION_ID | test("^[0-9]+$")) and
  ($input.GITHUB_RUNNER_PRIVATE_KEY | test(pem("(RSA )?PRIVATE KEY"))) and
  ($input.GHCR_PULL_TOKEN | length >= 20) and
  ($input.FIREBASE_SERVICE_ACCOUNT.private_key | test(pem("PRIVATE KEY"))) and
  ($input.APNS_PRIVATE_KEY | test(pem("PRIVATE KEY"))) and
  ($input.APNS_ENVIRONMENT == "sandbox" or $input.APNS_ENVIRONMENT == "production")
' "$SIGNAL_RUNTIME_INPUT_FILE" >/dev/null; then
  echo "Runtime input is incomplete, contains placeholders, or has invalid production values." >&2
  exit 1
fi

signal_input="$(jq -c . "$SIGNAL_RUNTIME_INPUT_FILE")"
signal_runtime_secret_arn="$(terraform -chdir="$signal_terraform_dir" output -raw runtime_secret_arn)"
signal_database_secret_arn="$(terraform -chdir="$signal_terraform_dir" output -raw database_master_secret_arn)"
signal_database_endpoint="$(terraform -chdir="$signal_terraform_dir" output -raw database_endpoint)"
signal_redis_endpoint="$(terraform -chdir="$signal_terraform_dir" output -raw redis_primary_endpoint)"
signal_s3_bucket="$(terraform -chdir="$signal_terraform_dir" output -raw artifact_bucket)"
signal_kms_key="$(terraform -chdir="$signal_terraform_dir" output -raw kms_key_arn)"
signal_signing_key="$(terraform -chdir="$signal_terraform_dir" output -raw adapter_signing_kms_key_arn)"
signal_aws_region="$(terraform -chdir="$signal_terraform_dir" output -raw aws_region)"

signal_database_secret="$(
  aws secretsmanager get-secret-value \
    --secret-id "$signal_database_secret_arn" \
    --region "$signal_aws_region" \
    --query SecretString \
    --output text
)"
signal_database_user="$(jq -er .username <<<"$signal_database_secret")"
signal_database_password="$(jq -er .password <<<"$signal_database_secret")"
signal_database_host="${signal_database_endpoint%:*}"
signal_database_port="${signal_database_endpoint##*:}"
signal_database_user_encoded="$(jq -rn --arg value "$signal_database_user" '$value | @uri')"
signal_database_password_encoded="$(jq -rn --arg value "$signal_database_password" '$value | @uri')"
signal_database_url="postgresql://${signal_database_user_encoded}:${signal_database_password_encoded}@${signal_database_host}:${signal_database_port}/signal?sslmode=require"

signal_random_base64url() {
  openssl rand -base64 "$1" | tr -d '\n=' | tr '+/' '-_'
}

signal_existing_payload="$(
  aws secretsmanager get-secret-value \
    --secret-id "$signal_runtime_secret_arn" \
    --region "$signal_aws_region" \
    --query SecretString \
    --output text 2>/dev/null || true
)"
if [[ "${SIGNAL_ROTATE_INTERNAL_SECRETS:-false}" != "true" ]] &&
  jq -e '
    .INTERNAL_SERVICE_TOKEN and
    .OAUTH_STATE_SIGNING_KEY and
    .DEVICE_COMMAND_SIGNING_SEED and
    .SANDBOX_RUNNER_TOKEN and
    .GENERATED_CANARY_TOKEN
  ' >/dev/null 2>&1 <<<"$signal_existing_payload"; then
  signal_internal_token="$(jq -er .INTERNAL_SERVICE_TOKEN <<<"$signal_existing_payload")"
  signal_oauth_state_key="$(jq -er .OAUTH_STATE_SIGNING_KEY <<<"$signal_existing_payload")"
  signal_device_seed="$(jq -er .DEVICE_COMMAND_SIGNING_SEED <<<"$signal_existing_payload")"
  signal_sandbox_token="$(jq -er .SANDBOX_RUNNER_TOKEN <<<"$signal_existing_payload")"
  signal_canary_token="$(jq -er .GENERATED_CANARY_TOKEN <<<"$signal_existing_payload")"
else
  signal_internal_token="$(signal_random_base64url 48)"
  signal_oauth_state_key="$(signal_random_base64url 48)"
  signal_device_seed="$(signal_random_base64url 32)"
  signal_sandbox_token="$(signal_random_base64url 48)"
  signal_canary_token="$(signal_random_base64url 48)"
fi

signal_payload="$(
  jq -cn \
    --argjson input "$signal_input" \
    --arg databaseUrl "$signal_database_url" \
    --arg redisUrl "rediss://${signal_redis_endpoint}:6379" \
    --arg s3Bucket "$signal_s3_bucket" \
    --arg awsRegion "$signal_aws_region" \
    --arg kmsKey "$signal_kms_key" \
    --arg signingKey "$signal_signing_key" \
    --arg internalToken "$signal_internal_token" \
    --arg oauthStateKey "$signal_oauth_state_key" \
    --arg deviceSeed "$signal_device_seed" \
    --arg sandboxToken "$signal_sandbox_token" \
    --arg canaryToken "$signal_canary_token" '
      {
        DATABASE_URL: $databaseUrl,
        REDIS_URL: $redisUrl,
        S3_REGION: $awsRegion,
        S3_BUCKET: $s3Bucket,
        KMS_KEY_ID: $kmsKey,
        ADAPTER_SIGNING_KMS_KEY_ID: $signingKey,
        INTERNAL_SERVICE_TOKEN: $internalToken,
        OAUTH_STATE_SIGNING_KEY_HANDLE: "env://OAUTH_STATE_SIGNING_KEY",
        OAUTH_STATE_SIGNING_KEY: $oauthStateKey,
        DEVICE_COMMAND_SIGNING_SEED_HANDLE: "env://DEVICE_COMMAND_SIGNING_SEED",
        DEVICE_COMMAND_SIGNING_SEED: $deviceSeed,
        SANDBOX_RUNNER_TOKEN: $sandboxToken,
        GENERATED_CANARY_TOKEN: $canaryToken,
        GENERATED_CANARY_CONFIG_JSON: ($input.GENERATED_CANARY_CONFIG | tojson),
        DEMO_MODE: "false",
        TEMPORAL_TLS: "true",
        PUSH_PROVIDER: "platform",
        MOBILE_DEEP_LINK_SCHEME: "signal",
        BROWSER_IMAGE: "mcr.microsoft.com/playwright:v1.61.1-noble",
        SANDBOX_IMAGE: "node:24-bookworm-slim",
        ALLOW_DESTRUCTIVE_MIGRATION: "false",
        APP_PUBLIC_URL: $input.APP_PUBLIC_URL,
        TEMPORAL_ADDRESS: $input.TEMPORAL_ADDRESS,
        TEMPORAL_NAMESPACE: $input.TEMPORAL_NAMESPACE,
        TEMPORAL_API_KEY: $input.TEMPORAL_API_KEY,
        OIDC_ISSUER: $input.OIDC_ISSUER,
        OIDC_PUBLIC_ISSUER: $input.OIDC_PUBLIC_ISSUER,
        OIDC_JWKS_URL: $input.OIDC_JWKS_URL,
        OIDC_CLIENT_ID: $input.OIDC_CLIENT_ID,
        OIDC_AUDIENCE: $input.OIDC_AUDIENCE,
        OIDC_MOBILE_CLIENT_ID: $input.OIDC_MOBILE_CLIENT_ID,
        OIDC_MOBILE_REDIRECT_URI: $input.OIDC_MOBILE_REDIRECT_URI,
        OIDC_OPS_CLIENT_ID: $input.OIDC_OPS_CLIENT_ID,
        OIDC_OPS_REDIRECT_URI: $input.OIDC_OPS_REDIRECT_URI,
        OIDC_ADMIN_CLIENT_ID: $input.OIDC_ADMIN_CLIENT_ID,
        OIDC_ADMIN_CLIENT_SECRET_HANDLE: "env://OIDC_ADMIN_CLIENT_SECRET",
        OIDC_ADMIN_CLIENT_SECRET: $input.OIDC_ADMIN_CLIENT_SECRET,
        INVITATION_EMAIL_FROM: $input.INVITATION_EMAIL_FROM,
        META_MODEL_API_BASE_URL: ($input.META_MODEL_API_BASE_URL // "https://api.meta.ai/v1"),
        META_MODEL_API_KEY: $input.META_MODEL_API_KEY,
        META_MODEL_ID: ($input.META_MODEL_ID // "meta/muse-spark-1.1"),
        META_MODEL_API_VERSION: ($input.META_MODEL_API_VERSION // "public-preview-2026-07"),
        META_INPUT_COST_MICROS_PER_MILLION: ($input.META_INPUT_COST_MICROS_PER_MILLION // "0"),
        META_OUTPUT_COST_MICROS_PER_MILLION: ($input.META_OUTPUT_COST_MICROS_PER_MILLION // "0"),
        META_REASONING_COST_MICROS_PER_MILLION: ($input.META_REASONING_COST_MICROS_PER_MILLION // "0"),
        TRANSCRIPTION_API_URL: $input.TRANSCRIPTION_API_URL,
        TRANSCRIPTION_API_TOKEN: $input.TRANSCRIPTION_API_TOKEN,
        TRANSCRIPTION_MODEL: $input.TRANSCRIPTION_MODEL,
        GOOGLE_OAUTH_CLIENT_ID: $input.GOOGLE_OAUTH_CLIENT_ID,
        GOOGLE_OAUTH_CLIENT_SECRET_HANDLE: "env://GOOGLE_OAUTH_CLIENT_SECRET",
        GOOGLE_OAUTH_CLIENT_SECRET: $input.GOOGLE_OAUTH_CLIENT_SECRET,
        GITHUB_OAUTH_CLIENT_ID: $input.GITHUB_OAUTH_CLIENT_ID,
        GITHUB_OAUTH_CLIENT_SECRET_HANDLE: "env://GITHUB_OAUTH_CLIENT_SECRET",
        GITHUB_OAUTH_CLIENT_SECRET: $input.GITHUB_OAUTH_CLIENT_SECRET,
        GITHUB_RUNNER_APP_ID: $input.GITHUB_RUNNER_APP_ID,
        GITHUB_RUNNER_INSTALLATION_ID: $input.GITHUB_RUNNER_INSTALLATION_ID,
        GITHUB_RUNNER_PRIVATE_KEY: $input.GITHUB_RUNNER_PRIVATE_KEY,
        GHCR_USERNAME: $input.GHCR_USERNAME,
        GHCR_PULL_TOKEN: $input.GHCR_PULL_TOKEN,
        COMPOSIO_API_KEY: $input.COMPOSIO_API_KEY,
        COMPOSIO_CALLBACK_URL: ($input.APP_PUBLIC_URL + "/v1/connections/callback"),
        COMPOSIO_AUTH_CONFIGS_JSON: ($input.COMPOSIO_AUTH_CONFIGS | tojson),
        COMPOSIO_TOOLS_JSON: ($input.COMPOSIO_TOOLS | tojson),
        FIREBASE_PROJECT_ID: $input.FIREBASE_PROJECT_ID,
        FIREBASE_SERVICE_ACCOUNT_JSON_HANDLE: "env://FIREBASE_SERVICE_ACCOUNT_JSON",
        FIREBASE_SERVICE_ACCOUNT_JSON: ($input.FIREBASE_SERVICE_ACCOUNT | tojson),
        APNS_KEY_HANDLE: "env://APNS_PRIVATE_KEY",
        APNS_PRIVATE_KEY: $input.APNS_PRIVATE_KEY,
        APNS_TEAM_ID: $input.APNS_TEAM_ID,
        APNS_KEY_ID: $input.APNS_KEY_ID,
        APNS_BUNDLE_ID: $input.APNS_BUNDLE_ID,
        APNS_ENVIRONMENT: $input.APNS_ENVIRONMENT
      } + ($input.RUNTIME_OVERRIDES // {})
    '
)"

if ! jq -e 'to_entries | all(.value != null and (.value | tostring | length > 0))' <<<"$signal_payload" >/dev/null; then
  echo "Generated runtime secret contains an empty value; refusing to publish it." >&2
  exit 1
fi

aws secretsmanager put-secret-value \
  --secret-id "$signal_runtime_secret_arn" \
  --region "$signal_aws_region" \
  --secret-string file:///dev/stdin \
  >/dev/null <<<"$signal_payload"

echo "Commissioned the Signal runtime secret without writing plaintext credentials to Terraform state or disk."
