# Runbook: production commissioning

This is the operator checklist that turns the verified repository into commissioned Signal environments. Keep evidence for every gate. Never put private `.tfvars`, backend files, runtime JSON, mobile signing material, or provider keys in Git.

## 1. External accounts and reviews

Provision separate staging and production resources for:

- AWS accounts, Route 53 zones, alert topics, platform-admin roles, and GitHub OIDC providers;
- Temporal Cloud namespaces/API keys;
- an OIDC realm/tenant with API, mobile, ops, and admin clients, recovery/passkeys, email, and step-up policy;
- Meta Model API access and approved model/version;
- Google OAuth, GitHub OAuth, GitHub ARC App, GHCR pull identity, and Composio auth configs/pinned tools;
- transcription API, Firebase/FCM, APNs, Apple Developer/App Store Connect, Google Play, and EAS;
- isolated generated-capability canary accounts and endpoints.

Use the [Google](../oauth/google.md), [GitHub](../oauth/github.md), [Composio](../vendor/composio.md), and [mobile release](mobile-release.md) instructions.

## 2. Bootstrap Terraform state

Authenticate to the intended AWS account using short-lived operator credentials. Select the state region/project (and an optional explicit globally unique bucket name), then run:

```bash
SIGNAL_STATE_REGION=us-east-2 \
SIGNAL_STATE_PROJECT=signal \
SIGNAL_BOOTSTRAP_APPLY=true \
scripts/bootstrap-terraform-state.sh
```

Record the encrypted state bucket and KMS alias in private backend configs derived from `infra/terraform/environments/*.backend.hcl.example`. Use different state keys and AWS accounts for development, staging, and production.

## 3. Prepare environment inputs

Copy the environment `.tfvars` example and [`infra/runtime-secret.example.json`](../../infra/runtime-secret.example.json) to a private encrypted workspace. Replace every placeholder. The runtime commissioning script rejects placeholders, non-HTTPS production URLs, malformed provider IDs/keys, unpinned Composio versions, and missing verification definitions for side-effecting tools.

The runtime JSON is written directly to AWS Secrets Manager. Terraform state receives no provider secret. Internal service, OAuth-state, device-signing, sandbox, and canary secrets are generated on first commission and retained on normal re-runs; set `SIGNAL_ROTATE_INTERNAL_SECRETS=true` only during a planned rotation.

## 4. Plan and commission staging

First create a reviewed plan:

```bash
SIGNAL_ENVIRONMENT=staging \
SIGNAL_TFVARS_FILE=/secure/signal/staging.tfvars \
SIGNAL_BACKEND_CONFIG=/secure/signal/staging.backend.hcl \
SIGNAL_RUNTIME_INPUT_FILE=/secure/signal/staging-runtime.json \
scripts/commission-environment.sh
```

Apply the same reviewed inputs:

```bash
SIGNAL_ENVIRONMENT=staging \
SIGNAL_TFVARS_FILE=/secure/signal/staging.tfvars \
SIGNAL_BACKEND_CONFIG=/secure/signal/staging.backend.hcl \
SIGNAL_RUNTIME_INPUT_FILE=/secure/signal/staging-runtime.json \
SIGNAL_APPLY=true \
scripts/commission-environment.sh
```

This applies AWS infrastructure, commissions the runtime secret, configures EKS add-ons/workload identity/External Secrets/DNS/ARC, and creates the private GHCR pull secret. Do not deploy the app until all add-on readiness waits pass.

## 5. Configure GitHub protected environments

Create `staging-core` and `production-core`. Require reviewers for production and prevent self-review. Set these variables in both, using Terraform outputs for that environment:

- `AWS_REGION`
- `EKS_CLUSTER_NAME`
- `AWS_DEPLOY_ROLE_ARN`
- `SIGNAL_HOST`
- `SIGNAL_CERTIFICATE_ARN`
- `SIGNAL_WAF_ACL_ARN`
- `SIGNAL_VPC_CIDR`

Additionally set in staging:

- variable `SIGNAL_STAGING_EXPECTED_PROVIDERS` as a comma-separated list of connection providers, such as `google,github`;
- variable `SIGNAL_STAGING_TENANT_ID` when the token can select more than one organization;
- secret `SIGNAL_STAGING_BEARER_TOKEN` for a dedicated short-lived staging verification principal.

The `v*` release workflow builds SBOM/provenance-attested images, deploys immutable digests to staging, runs health/provider/audit gates, then waits on the protected production environment before promoting the identical digests.

## 6. Staging acceptance

Run all acceptance scenarios A–J plus:

- task start, pause/resume/cancel, API/worker restart, and Temporal replay;
- Meta health and a real bounded-agent task;
- Google/GitHub native OAuth exchange, refresh/reauthentication/revocation, native read/write with independent verification;
- at least one Composio read and approved write with pinned version and read-after-write verification;
- APNs and FCM on physical devices in foreground, background, terminated, and offline-return states;
- multi-file OCR/chart/audio/video processing and versioned document/workbook edits;
- browser observed/takeover/MFA/upload/download against approved provider staging domains;
- generated read-only and write/canary/rollback/original-task-resume paths;
- device permission denial, replay protection, expiry, and supported platform intents;
- emergency stop, multi-party approval, JIT support expiry, export/deletion/retention/legal hold;
- load, autoscaling, WAF, alert, backup, restore, and regional recovery exercises.

Run the provider gate directly when diagnosing:

```bash
SIGNAL_STAGING_BASE_URL=https://<staging-host> \
SIGNAL_STAGING_BEARER_TOKEN=<short-lived-token> \
SIGNAL_STAGING_EXPECTED_PROVIDERS=google,github \
node scripts/verify-provider-staging.mjs
```

## 7. Commission production

Repeat the plan with production inputs. Before apply, resolve the AWS account ID and set the exact confirmation guard:

```bash
SIGNAL_ENVIRONMENT=production \
SIGNAL_TFVARS_FILE=/secure/signal/production.tfvars \
SIGNAL_BACKEND_CONFIG=/secure/signal/production.backend.hcl \
SIGNAL_RUNTIME_INPUT_FILE=/secure/signal/production-runtime.json \
SIGNAL_APPLY=true \
SIGNAL_PRODUCTION_CONFIRM=production:<aws-account-id> \
scripts/commission-environment.sh
```

Approve production release only when staging evidence, data-protection review, provider approvals, mobile signing/review, on-call ownership, dashboards/alerts, restore drill, capacity test, budget alarms, and rollback plan are signed off.

## 8. Post-launch controls

Monitor SLOs, provider circuits, cost ledger, failed push/cleanup work, audit-chain validity, WAF/egress denials, and Temporal backlog. Exercise emergency stop quarterly, restore testing at the agreed cadence, regional recovery at least annually, and provider key/identity rotation according to policy. Never replay an uncertain external side effect without independent reconciliation.
