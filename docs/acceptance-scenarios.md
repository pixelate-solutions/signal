# Signal acceptance scenario matrix

Last verified: 2026-07-18

This matrix maps the mandatory scenarios in `docs/CODEX_MASTER_PROMPT.md` to executable evidence. “Passed” means the scenario passed with deterministic local providers or an isolated local worker. It does not assert success against a real third-party account.

| Scenario                             | Result                                 | Primary automated evidence                                                                                                                                                                                                                                                                          | What the evidence proves                                                                                                                                                                                                            |
| ------------------------------------ | -------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| A — Phone off and resume             | Passed, including live restart         | `services/api/src/api.test.ts`, `services/task-service/src/postgres-store.integration.test.ts`, `services/workflow-worker/src/runner.test.ts`, `services/notification-service/src/notification.test.ts`                                                                                             | Backend reaches `WAITING_USER` without a client; push deep-links to the exact request; PostgreSQL survives an API replacement; approval resumes; write runs once; independent verification is required before completion.           |
| B — One-time OAuth                   | Passed locally                         | `services/connection-service/src/connection.test.ts`                                                                                                                                                                                                                                                | PKCE state and redirect validation, one-time callback, active connection reuse, atomic revocation, opaque credential handles, and tenant isolation.                                                                                 |
| C — Durable memory                   | Passed locally                         | `services/memory-service/src/memory-service.test.ts`, `packages/memory-sdk/src/memory.test.ts`                                                                                                                                                                                                      | Canonical URL provenance, later retrieval, supersession, forgetting and derivative removal, expiry, scope, secret rejection, and cross-tenant denial.                                                                               |
| D — Multimodal files                 | Passed, including live worker requests | `services/document-worker/tests/test_worker.py`, `services/artifact-service/src/artifact.test.ts`, `services/artifact-service/src/malware.integration.test.ts`                                                                                                                                      | PDF page, XLSX range/formula, DOCX paragraph, PPTX slide, image metadata, checksum/provenance, generated-file reopen checks, artifact versions, quarantine, clean release, and malware rejection.                                   |
| E — Browser fallback                 | Passed against isolated fixtures       | `services/browser-worker/src/browser.test.ts`, `services/local-fixtures/src/index.test.ts`                                                                                                                                                                                                          | Allowlisted navigation, untrusted-content treatment, takeover state, exact approval digest, single final submission, and independent provider-state verification.                                                                   |
| F — Generated adapter                | Passed locally                         | `services/sandbox-controller/src/pipeline.test.ts`, `integrations/generated/example/status/1.0.0/src/client.test.ts`, `.github/workflows/generated-capability.yml`                                                                                                                                  | Protected paths fail closed; a required-field test fails then passes after repair; scopes/version are pinned; successful canary resumes; forced canary failure rolls back; release candidates are packaged and attested separately. |
| G — Duplicate side-effect prevention | Passed                                 | `services/tool-gateway/src/gateway.test.ts`, `services/agent-worker/src/agent.test.ts`, `services/workflow-worker/src/runner.test.ts`, `integrations/native/signal-test-state/src/integration.test.ts`                                                                                              | Provider-accepted timeout becomes `unknown`; provider state is read before retry; a checkpoint restart does not repeat the write; stable idempotency produces one side effect.                                                      |
| H — Prompt injection                 | Passed locally                         | `services/browser-worker/src/browser.test.ts`, `services/document-worker/tests/test_worker.py`, `packages/policy-client/src/policy.test.ts`, `packages/observability/src/redaction.test.ts`                                                                                                         | Malicious page/PDF text remains untrusted data; it cannot grant scopes or reveal credentials; unrelated tool escalation is denied; sensitive fields and bearer values are redacted.                                                 |
| I — Device limitation honesty        | Passed                                 | `packages/auth-sdk/src/device-commands.test.ts`, `packages/contracts/src/contracts.test.ts`, `docs/mobile-capability-matrix.md`                                                                                                                                                                     | Modified, expired, duplicate, or wrong-device commands fail; unsupported silent messaging returns an explicit unsupported result and never claims success.                                                                          |
| J — Cross-tenant and emergency stop  | Passed                                 | `services/task-service/src/task-service.test.ts`, `services/memory-service/src/memory-service.test.ts`, `services/artifact-service/src/artifact.test.ts`, `services/connection-service/src/connection.test.ts`, `services/tool-gateway/src/gateway.test.ts`, `packages/database/src/schema.test.ts` | Cross-tenant task, memory, artifact, connection, credential, and vector paths deny; RLS is present; emergency stop cancels active tasks and prevents new privileged leases.                                                         |

## Reproduction

Run all portable gates:

```bash
pnpm test:all
```

Run integrations that need the live local dependencies:

```bash
docker compose up --build --detach --wait
DATABASE_URL=postgresql://signal:signal-local-only@localhost:5432/signal \
  pnpm --filter @signal/task-service test
CLAMAV_HOST=127.0.0.1 pnpm --filter @signal/artifact-service test
```

The PostgreSQL migration reversal check must use a disposable database because rollback is intentionally guarded:

```bash
ALLOW_DESTRUCTIVE_MIGRATION=true \
DATABASE_URL=postgresql://signal:signal-local-only@localhost:5432/signal_migration_test \
  pnpm --filter @signal/database db:rollback:ephemeral
```

Production-provider acceptance is a staging release gate. It requires the operator-owned credentials and services listed in `IMPLEMENTATION_STATUS.md`; deterministic providers never masquerade as external success.
