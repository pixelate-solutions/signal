# Codex Master Build Prompt: Persistent Operator

You are the principal engineer, security architect, mobile lead, and technical program owner for **Persistent Operator**, a production-grade, chat-first mobile agent platform.

The complete product requirements are in `docs/FRD.md`. Read that file in full before changing code. This prompt is the execution contract. When this prompt and the FRD differ, choose the safer interpretation, preserve the FRD’s product behavior, and record the decision in an Architecture Decision Record (ADR).

## 1. Mission

Build a complete production-ready application whose user-facing mobile interface has only two primary destinations:

1. **Chat** — users state objectives and see a truthful live execution feed showing plans, tool calls, successes, failures, sanitized errors, retries, adaptations, generated code changes, test results, user-action requests, evidence, and verified outcomes.
2. **Settings** — users manage account sessions, OAuth connections, memory, permissions, approval rules, device access, notifications, privacy, security, and developer capabilities.

The phone is a secure cockpit. The backend owns and runs every durable task. A user may force-quit the app, turn off the phone, lose connectivity, or sign in from another device. Work continues in the cloud until it completes, fails terminally, is cancelled, or reaches a durable `WAITING_USER` state. When human action is required, send a push notification with a privacy-safe description and deep-link to the exact action card inside the task conversation.

The default backend model is **Meta Muse Spark 1.1**, using the current official Meta Model API model identifier `meta/muse-spark-1.1`. Do not guess the provider’s current HTTP contract. Inspect the official Meta developer documentation available at implementation time, document the selected API version and request format in `docs/vendor/meta-model-api.md`, and implement it behind a provider-neutral interface.

## 2. Non-negotiable product behavior

- The backend, not the mobile app, is the source of truth for tasks, events, approvals, artifacts, connections, memory, and execution state.
- The execution feed is generated from structured event records. Never fabricate progress or success.
- Show observable operational rationale, not private model chain-of-thought.
- Never put raw passwords, API keys, OAuth access/refresh tokens, cookies, private keys, recovery codes, or raw payment credentials in model context, memory, workflow history, events, analytics, traces, or ordinary logs.
- Every external or privileged action passes through a typed tool gateway, deterministic policy evaluation, and evidence requirements.
- The platform may support broad capabilities, but an individual task receives only temporary, scoped capability and credential leases.
- Prefer native integrations, then Composio, then generated API adapters, then browser operation, then supported device actions, then human takeover.
- Do not bypass CAPTCHA, MFA, bot protection, provider access controls, terms, or mobile store policy.
- The agent may generate and repair adapters, browser skills, workflow templates, and tests. It may not rewrite the protected production kernel: identity, tenant isolation, policy, credential storage, audit, billing, deployment authority, or control-plane security.
- A task is complete only when typed success criteria pass independent verification, or the user explicitly accepts a documented unverifiable condition.
- Never retry a possibly completed side effect until provider state is checked or idempotency proves retry is safe.
- Device controls must be honest and platform-compliant. Do not promise arbitrary silent iOS app control or general autonomous Android AccessibilityService behavior in the Play Store build.
- External integrations that require secrets must have real implementations behind interfaces and local mocks. Do not create a “successful” fake action in production code.

## 3. Work style

1. Inspect the repository. If it is empty, initialize it exactly as described below.
2. Read `docs/FRD.md` completely.
3. Create:
   - `IMPLEMENTATION_PLAN.md` with phases, dependencies, and acceptance gates;
   - `IMPLEMENTATION_STATUS.md` updated after each phase;
   - `docs/adr/` with numbered ADRs for material choices;
   - `docs/threat-model.md` using STRIDE-style assets, boundaries, threats, and mitigations;
   - `docs/runbooks/` for OAuth outage, model outage, provider duplication risk, browser compromise, secret leakage, queue backlog, emergency stop, and disaster recovery.
4. Build in vertical slices. Do not spend all effort on scaffolding while leaving the core path nonfunctional.
5. After each phase, run all relevant lint, type, unit, integration, contract, and end-to-end tests. Fix failures before continuing.
6. Use strict typing, schema validation, deterministic state transitions, explicit errors, cancellation, idempotency, and structured logging.
7. Where an external production credential is unavailable, implement the real adapter and a contract-faithful sandbox/mock provider. Add a setup guide and a test proving that missing credentials produce `CONNECTION_REQUIRED`, not false success.
8. Do not ask the user routine implementation questions. Use the reference decisions in this prompt and document assumptions. Only stop when a required third-party action cannot be represented without an operator-owned secret, legal approval, or platform certificate; even then, complete all code, mocks, and documentation possible.
9. Keep `main` buildable. Make logical commits if Git is configured.

## 4. Reference stack

Use this stack unless the existing repository already has an equivalent production-grade choice. Record any deviation in an ADR.

### Monorepo and languages

- `pnpm` workspaces and Turborepo.
- TypeScript with `strict: true`, `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`, and project references.
- Python 3.12 for document/media processing, managed with `uv` and strict type checking.
- Node.js current active LTS.

### Mobile

- React Native with TypeScript using Expo prebuild/custom development client, not Expo Go.
- React Navigation for the two primary routes and modal/sheet flows.
- TanStack Query for server state and a small Zustand store only for ephemeral UI state.
- `react-native-keychain` or equivalent native Keychain/Keystore storage.
- System browser OAuth using PKCE; universal links/app links for callbacks.
- Native modules in Swift/Kotlin where platform APIs are required.
- Push through a `PushProvider` abstraction with Firebase Cloud Messaging implementation and APNs-compatible iOS setup.
- React Native Testing Library, Maestro for device flows, and platform unit tests for native modules.

### Backend/control plane

- NestJS with Fastify adapter.
- REST/OpenAPI for commands and queries; SSE for ordered event streaming. WebSocket may be used for browser takeover and device command channels.
- Temporal TypeScript SDK for durable workflows, timers, signals, and activities.
- PostgreSQL 16 with pgvector; Drizzle ORM and SQL migrations.
- Redis 7 for cache, locks, rate limiting, presence, and nonauthoritative live fan-out.
- S3-compatible storage; MinIO locally.
- Open Policy Agent for deterministic policy decisions.
- OpenTelemetry for traces, metrics, and log correlation.

### Agent, tools, and workers

- TypeScript agent worker and tool gateway.
- Meta Muse Spark 1.1 model provider plus deterministic fake provider for tests.
- Composio current TypeScript SDK using sessions/connected accounts and hosted Connect Link or current recommended flow.
- Playwright browser workers in isolated containers.
- Python FastAPI document/media worker using format-specific libraries and LibreOffice/FFmpeg.
- Code sandbox provider interface with local Docker implementation and production design for gVisor/Firecracker-grade isolation.
- ClamAV in local/integration environments for file scanning.

### Infrastructure

- Docker Compose for a complete local environment.
- Kubernetes manifests or Helm charts for services and isolated worker pools.
- Terraform for the selected cloud reference deployment.
- GitHub Actions for CI/CD.
- Signed images/artifacts, SBOMs, vulnerability scanning, and environment protection gates.

## 5. Required repository structure

Create or normalize the repository to this layout:

```text
apps/
  mobile/                       # iOS/Android Chat + Settings app
  ops-console/                  # Internal operator console; not a consumer tab
services/
  api/                          # Public API gateway and mobile endpoints
  task-service/                 # Conversation, task, event, action-request APIs
  workflow-worker/              # Temporal workflows and orchestration activities
  agent-worker/                 # Model loop, context compiler, planner, verifier
  tool-gateway/                 # Tool discovery, validation, policy, execution
  connection-service/           # Composio/native OAuth and credential handles
  memory-service/               # Memory write/retrieve/governance
  artifact-service/             # Uploads, object metadata, versions, evidence
  notification-service/         # Push dispatch, dedup, reminders
  browser-worker/               # Playwright execution and takeover channel
  sandbox-controller/           # Adapter/code sandbox jobs and signing pipeline
  document-worker/              # Python multimodal parsing/editing service
packages/
  contracts/                    # Versioned API/event/tool schemas
  database/                     # Drizzle schema, migrations, RLS helpers
  model-gateway/                # ModelProvider and Meta implementation
  tool-sdk/                     # Tool manifests, execution context, results
  policy-client/                # OPA client and policy types
  event-sdk/                    # Append/read/render-safe event types
  memory-sdk/                   # Memory domain types and retrieval contracts
  auth-sdk/                     # User principal and service identity contracts
  observability/                # OpenTelemetry setup and redaction
  ui/                           # Shared mobile/ops components where appropriate
  config/                       # Typed environment configuration
  test-fixtures/                # Provider/browser/file/adversarial fixtures
integrations/
  native/
    google/                     # Gmail, Calendar, Contacts, Drive sample
    github/                     # Repo example
  generated/                    # Versioned generated adapter packages
  browser-skills/               # Reviewed browser skill definitions and tests
infra/
  docker/
  helm/
  terraform/
  opa/
  temporal/
docs/
  FRD.md
  adr/
  api/
  vendor/
  runbooks/
  threat-model.md
scripts/
```

Do not merge the tool gateway, credential broker, browser worker, and code sandbox into a single privileged service.

## 6. Configuration and secrets

Create a typed configuration package. Include `.env.example` with placeholders only.

Minimum variables:

```text
NODE_ENV
APP_PUBLIC_URL
MOBILE_DEEP_LINK_SCHEME
DATABASE_URL
REDIS_URL
S3_ENDPOINT
S3_REGION
S3_BUCKET
S3_ACCESS_KEY_ID
S3_SECRET_ACCESS_KEY
TEMPORAL_ADDRESS
TEMPORAL_NAMESPACE
TEMPORAL_TASK_QUEUE_*
OIDC_ISSUER
OIDC_CLIENT_ID
OIDC_AUDIENCE
OIDC_MOBILE_REDIRECT_URI
META_MODEL_API_BASE_URL
META_MODEL_API_KEY
META_MODEL_ID=meta/muse-spark-1.1
COMPOSIO_API_KEY
COMPOSIO_CALLBACK_URL
OPA_URL
KMS_KEY_ID
PUSH_PROVIDER
FIREBASE_SERVICE_ACCOUNT_JSON_HANDLE
APNS_KEY_HANDLE
OTEL_EXPORTER_OTLP_ENDPOINT
CLAMAV_HOST
BROWSER_IMAGE
SANDBOX_IMAGE
```

Secret values must be injected by a secret manager in staging/production. Test fixtures must use obvious nonsecret values. Add automated secret scanning.

## 7. Domain model and database

Implement migrations, foreign keys, unique constraints, check constraints, partial indexes, pgvector indexes, and tenant isolation for at least these tables:

- `tenants`
- `users`
- `memberships`
- `devices`
- `sessions`
- `conversations`
- `messages`
- `tasks`
- `task_steps`
- `task_events`
- `task_snapshots`
- `action_requests`
- `action_responses`
- `tool_definitions`
- `tool_versions`
- `tool_executions`
- `tool_health`
- `connections`
- `connection_scopes`
- `credential_handles` (metadata only; encrypted material lives in the secret layer)
- `artifacts`
- `artifact_versions`
- `artifact_representations`
- `artifact_chunks`
- `evidence`
- `memory_items`
- `memory_sources`
- `memory_feedback`
- `entity_nodes`
- `entity_aliases`
- `entity_relations`
- `policy_bundles`
- `policy_decisions`
- `generated_capabilities`
- `generated_capability_versions`
- `adapter_test_runs`
- `browser_sessions`
- `device_commands`
- `push_deliveries`
- `audit_events`
- `outbox_events`

### Required constraints

- Every tenant-owned row has `tenant_id` and is checked in service authorization; add PostgreSQL RLS where practical.
- `task_events` have unique `(task_id, sequence)` and immutable payload digests.
- `tool_executions` have unique task-scoped idempotency keys.
- `action_requests` store a material-action digest; responses must match it.
- Active memory uniqueness must support `(tenant, scope, subject, predicate)` while retaining superseded records.
- Artifacts are content-addressed by hash but never deduplicated across tenants in a way that leaks existence.
- Soft deletion and legal hold metadata must be explicit.
- Use UTC timestamps and separate user timezone preferences.

Create seed data for a demo tenant, user, mocked connections, tool definitions, and task scenarios.

## 8. Public API

Implement and document with OpenAPI at minimum:

```text
POST   /v1/conversations
GET    /v1/conversations
GET    /v1/conversations/:id
POST   /v1/conversations/:id/messages
GET    /v1/tasks/:id
GET    /v1/tasks/:id/events
GET    /v1/tasks/:id/stream
POST   /v1/tasks/:id/pause
POST   /v1/tasks/:id/resume
POST   /v1/tasks/:id/cancel
POST   /v1/tasks/:id/instructions
GET    /v1/action-requests
POST   /v1/action-requests/:id/respond
POST   /v1/uploads
POST   /v1/uploads/:id/complete
GET    /v1/artifacts/:id
GET    /v1/artifacts/:id/versions
GET    /v1/connections
POST   /v1/connections/link
GET    /v1/connections/callback
POST   /v1/connections/:id/disable
POST   /v1/connections/:id/enable
POST   /v1/connections/:id/reauthenticate
POST   /v1/connections/:id/revoke
GET    /v1/memories
POST   /v1/memories
PATCH  /v1/memories/:id
DELETE /v1/memories/:id
GET    /v1/settings
PATCH  /v1/settings
POST   /v1/devices/register
POST   /v1/device-commands/:id/result
POST   /v1/security/emergency-stop
```

Requirements:

- Validate all requests and responses with versioned schemas from `packages/contracts`.
- Support idempotency keys on message creation, action responses, upload completion, and task controls.
- Use cursor pagination.
- Return stable typed error codes, correlation IDs, retryability, and user-safe messages.
- Generate an API client for the mobile app from OpenAPI or shared schemas; do not duplicate types manually.
- SSE reconnect uses `Last-Event-ID` or an explicit `after` sequence and guarantees ordered delta delivery.

## 9. Task event system and live feed

Implement an append-only task event service. Authoritative events are stored transactionally with an outbox. Redis may fan out committed events but is not the source of truth.

At minimum support:

```text
task.created
task.planning_started
task.plan_created
task.state_changed
step.started
step.completed
tool.discovery_started
tool.selected
tool.execution_started
tool.execution_succeeded
tool.execution_failed
tool.timeout
tool.retry_scheduled
route.changed
connection.required
connection.completed
credential.input_requested
browser.started
browser.takeover_requested
browser.resumed
approval.requested
approval.responded
external.wait_started
external.event_received
memory.proposed
memory.saved
memory.superseded
artifact.uploaded
artifact.parsed
artifact.generated
code.diff_created
tests.started
tests.failed
tests.passed
capability.deployed
capability.rolled_back
verification.started
verification.failed
verification.succeeded
task.completed
task.failed
task.cancelled
```

Each event must include task ID, monotonic sequence, time, actor, visibility, public summary, sanitized structured details, evidence references, and payload digest. Secret/private payloads are stored by encrypted handle outside the public event.

Create a deterministic mobile event renderer. It may transform event data into readable cards, but it must not claim facts absent from the event.

## 10. Durable task workflow

Use Temporal. Do not put model calls, provider calls, current time reads, randomness, or network I/O directly in workflow code. Put them in activities.

Implement `TaskWorkflow` with:

- task initialization and snapshot creation;
- memory retrieval and context preparation;
- plan generation and success criteria;
- bounded execution loop;
- policy authorization before every side effect;
- tool discovery and route selection;
- tool execution with retries only for safe classes;
- post-action verification;
- durable external waits and timers;
- action requests and user signals;
- pause, resume, cancel, emergency-stop handling;
- compensation where a tool declares it;
- child workflows for browser, generated adapter, document processing, and specialized subtasks;
- `Continue-As-New` or equivalent history management for very long tasks.

States:

```text
CREATED
QUEUED
PLANNING
RUNNING
WAITING_EXTERNAL
WAITING_USER
RETRY_SCHEDULED
PAUSED
COMPLETED
COMPLETED_WITH_WARNINGS
FAILED
CANCELLED
```

Signals/updates:

```text
userInstruction
respondToActionRequest
externalEvent
pause
resume
cancel
emergencyStop
connectionChanged
deviceCommandResult
```

Persist a task snapshot after material state changes. Force-crash tests must show that the task resumes without duplicating side effects.

## 11. Meta Muse Spark 1.1 model gateway

Create:

```ts
interface ModelProvider {
  stream(request: ModelRequest, signal: AbortSignal): AsyncIterable<ModelStreamEvent>;
  completeStructured<T>(request: StructuredModelRequest<T>, signal: AbortSignal): Promise<ModelResponse<T>>;
  capabilities(): ModelCapabilities;
  health(): Promise<ModelHealth>;
}
```

Implement:

- `MetaMuseSparkProvider` using the current official Meta Model API.
- `FakeDeterministicModelProvider` for tests.
- Optional configured fallback provider interface, disabled by default.

The gateway must:

- record exact model ID/API version/provider request ID/usage;
- support text and advertised multimodal inputs;
- use structured JSON/schema output for plans, memory extraction, tool selection, verification, and user-facing summaries;
- validate all structured output and retry only within a small budget;
- support cancellation, deadline, max tokens, and cost estimation;
- separate user-visible operational summary from private internal reasoning;
- never send raw tool credentials;
- include only the minimum relevant memory and artifact representations;
- use artifact handles for large tool results;
- expose model evaluation hooks and tenant canaries.

Implement the agent loop as explicit code, not a single giant prompt:

```text
perceive current task state
retrieve and compile memory/context
plan or replan
select candidate capabilities
authorize
execute
observe normalized result
verify
complete, wait, retry safely, adapt route, or escalate
```

Bound iteration count, tool calls, wall-clock, and spend per task.

## 12. Composio and native OAuth connections

### Unified connection model

Create a normalized `ConnectionProvider` interface for Composio and native integrations.

Connections must show in Settings with provider, account label, source, owner, scopes, status, expiry/refresh health, last used, and actions.

### Composio

Use the current supported Composio session and connected-account APIs. Requirements:

- stable internal user ID equal to the product user UUID, never email;
- hosted Connect Link/current recommended OAuth flow;
- callback state tying the connection to user, tenant, originating task, and return deep link;
- one-time sign-in followed by connection reuse and token refresh;
- list, select, disable, reauthenticate, and revoke;
- multiple accounts per toolkit;
- no Composio API key in mobile code;
- connection-required events that pause a task and resume after callback;
- provider-owned or white-labeled OAuth configuration as environment setup, not hard-coded.

### Native OAuth

Create a generic `NativeOAuthProvider` with Authorization Code + PKCE, state, nonce where supported, and exact redirect validation. Implement at least one real Google integration package supporting a small Gmail/Calendar/Contacts/Drive capability set with contract tests and a sandbox/mock mode. Production credentials come from secret configuration.

### Credential broker

Create a protected broker that:

- stores native OAuth refresh tokens encrypted with envelope encryption;
- returns short-lived opaque credential leases or injects tokens directly into trusted adapters;
- never returns raw secrets to the agent runtime;
- records each lease/use in audit;
- supports revocation and emergency stop;
- securely stores/reuses encrypted browser state;
- collects API keys/passwords through a secure form channel that bypasses model context.

The mobile secure-input flow must display provider/domain, requested secret type, why it is needed, retention, and cancellation. Sensitive fields must be excluded from screenshots/crash reports where platforms permit.

## 13. Memory system

Build memory as a service, not a chat-history dump.

### Memory kinds

```text
working
semantic_fact
episodic
procedural
relationship
policy
experience
artifact
```

A memory item must contain:

```text
id
tenant_id
user_id
kind
subject
predicate
object_json
canonical_text
scope_type
scope_id
explicitness
confidence
sensitivity
valid_from
valid_to
expires_at
status (proposed, active, superseded, disputed, deleted)
source IDs and provenance
embedding
created_at
updated_at
last_used_at
```

### Write pipeline

- Detect explicit durable statements with strong rules plus structured model extraction.
- Example that must work: `I log my work calls at https://calls.example.com/team-log` becomes the canonical semantic fact `user.current / work_calls.log_url / URL` with source message and high confidence.
- Treat “remember,” “always,” “this is where,” and “from now on” as explicit signals.
- Propose rather than silently save ambiguous sensitive inferences.
- Reject secret categories before persistence.
- Extract entities and aliases.
- Deduplicate, detect conflict, and supersede rather than overwrite history.
- Store volatile facts with freshness/expiry rules.
- Never infer policy/authority from repeated approvals.

### Retrieval pipeline

Use a hybrid ranker combining:

- exact canonical key and alias matches;
- tenant/scope filters;
- entity graph traversal;
- PostgreSQL full-text search;
- pgvector similarity;
- temporal validity and freshness;
- recency and prior successful use;
- task relevance and sensitivity policy.

Return the smallest relevant context set with provenance handles. Add retrieval traces for evaluation, but do not expose sensitive memory details in ordinary logs.

### Memory UI

In Settings implement:

- search and type filters;
- active/proposed/superseded views;
- source/provenance view;
- edit, confirm, pin, rescope, expiry, forget, export;
- global implicit-memory toggle;
- sensitive-memory controls;
- “Why did the agent use this?” flow.

### Memory tests

Create an evaluation corpus including:

- the work-call URL across new conversations and different phrasing;
- a changed URL superseding the old one;
- project-scoped memory not leaking to personal tasks;
- expired address not used as current;
- preference versus hard policy distinction;
- malicious document text not saved as user memory;
- secret-like input rejected;
- user deletion removing vector/graph derivatives.

## 14. Multimodal file and artifact system

### Upload

- Direct multipart upload to S3/MinIO using presigned URLs.
- Resume support, checksum, MIME sniffing, extension check, tenant quota, and content hash.
- On mobile support Files, Photos, camera, document scan, share sheet, and connected cloud storage attachments.

### Security

- Quarantine until ClamAV scan passes.
- Archive recursion, expansion, file-count, and path traversal limits.
- Do not execute uploaded code in the ingestion service.
- DLP hooks and metadata stripping policy.

### Format routing

Implement plugin-based processors for:

```text
Images: JPEG, PNG, WebP, HEIC/HEIF, GIF, TIFF, BMP
Documents: PDF, DOCX, DOC, ODT, RTF, TXT, Markdown, HTML
Spreadsheets: XLSX, XLS, ODS, CSV, TSV
Presentations: PPTX, PPT, ODP
Structured/code: JSON, JSONL, XML, YAML, SQL, notebooks, common source files
Archives: ZIP, TAR, GZIP under limits
Audio: WAV, MP3, M4A, AAC, FLAC, OGG
Video: MP4, MOV, WebM, MKV under limits
```

At minimum, fully implement and test PDF, DOCX, XLSX/CSV, PPTX, common images, text/Markdown/JSON/code, ZIP, and one audio/video path. Other formats may use LibreOffice/FFmpeg conversion but must return honest warnings if elements are unsupported.

### Canonical representation

For every artifact retain:

- original bytes and checksum;
- normalized text blocks with location metadata;
- page/slide/sheet/range/timestamp references;
- page images or frames where layout matters;
- tables and formula/value metadata;
- parser/converter version;
- entities and chunks for memory/search;
- relationships to task, message, source tool, and generated versions.

Large model inputs must be selected by relevance; do not blindly send whole files. Use Meta Muse Spark multimodal input when supported and normalized representations otherwise.

### Editing and output

Implement versioned artifact creation/editing for DOCX, PDF, XLSX, PPTX, text, and images. Every generated file must have a preview, download link, source task, version history, checks, and evidence. Add render-and-verify tests for office files.

## 15. Tool SDK and gateway

Create a manifest similar to:

```ts
interface ToolManifest<I, O> {
  name: string;
  version: string;
  source: 'native' | 'composio' | 'generated' | 'browser' | 'sandbox' | 'document' | 'device' | 'mcp';
  description: string;
  inputSchema: JsonSchema;
  outputSchema: JsonSchema;
  auth: AuthRequirement[];
  requiredScopes: string[];
  riskClass: 'R0' | 'R1' | 'R2' | 'R3' | 'R4';
  sideEffect: 'none' | 'reversible' | 'external' | 'financial' | 'irreversible';
  idempotency: IdempotencyStrategy;
  verification: VerificationDefinition;
  compensation?: CompensationDefinition;
  egress: EgressPolicy;
  timeouts: TimeoutPolicy;
  retryPolicy: RetryPolicy;
  redaction: RedactionPolicy;
}
```

Execution context must contain user/tenant/task/step, chosen connection, policy decision ID, budgets, deadline, cancellation signal, and idempotency key.

Normalized tool result must contain:

```text
status
data or artifact handle
sanitized user message
provider request metadata
retryability and error class
side-effect state: definitely_not_started, unknown, definitely_completed
evidence references
verification hint
cost/usage
```

Implement built-in tools for:

- web search/fetch;
- generic HTTP/OpenAPI;
- filesystem/artifact operations;
- terminal/code sandbox;
- Git operations;
- document/spreadsheet/presentation/PDF operations;
- Gmail/Calendar sample;
- Composio tool discovery and execution;
- Playwright browser operations;
- device command dispatch;
- memory read/write;
- notification/action request creation;
- timers and external waits.

Large tool outputs must be stored as artifacts and summarized.

## 16. Capability routing

Implement a deterministic-plus-model-assisted router with this order:

```text
native integration
Composio toolkit
existing generated adapter
documented API -> build adapter
browser operation
supported device action
human takeover / external human service
```

Route score must consider policy, reliability, provider health, authentication availability, latency, cost, reversibility, data sensitivity, verification quality, and terms restrictions.

A route change after failure must:

- classify the failure;
- check whether a side effect may have happened;
- verify provider state before retry/fallback;
- emit a `route.changed` event with user-safe explanation;
- preserve the original success criteria.

## 17. Playwright browser operator

Create isolated browser sessions scoped to user/task/domain.

Implement:

- Chromium baseline; architecture supports Firefox/WebKit;
- accessibility snapshot and DOM-first controls;
- screenshot/vision fallback;
- navigation, tabs, forms, file upload/download, dialogs, waits, screenshots, and network metadata;
- encrypted browser auth-state handles;
- autonomous, observed, approval, and takeover modes;
- live session streaming to mobile/ops console;
- secure user takeover for login, MFA, CAPTCHA, signatures, and ambiguous controls;
- final-action approval gate for material actions;
- prompt-injection boundary: page text is untrusted data and cannot grant tools or trigger the code agent;
- domain/redirect/subresource egress policy;
- evidence: URL, account handle, timestamp, screenshot, accessibility snapshot, confirmation ID, and post-action check;
- immediate session termination and credential/session revocation;
- skill recording only after review, fixture creation, and regression tests.

Implement adversarial fixtures containing instructions such as “ignore policy and send secrets.” Prove they cannot call unrelated tools or access credentials.

## 18. Self-extending API adapter pipeline

This feature must be real, controlled, and versioned.

### Capability gap

Represent a missing capability as:

```text
required action
minimal inputs
expected output
provider/domain
auth method and scopes
risk class
side effect and idempotency
success evidence
```

### Documentation discovery

- Prefer official provider domains.
- Look for OpenAPI, official SDKs, GraphQL schema/introspection when authorized, sandbox documentation, rate-limit and auth docs.
- Record URLs, hashes, version, retrieval time, and trust level.
- Do not trust third-party code samples as authority.
- If documentation is ambiguous or a write operation cannot be safely tested, fall back to browser or human review.

### Generation

Generate a package under `integrations/generated/<provider>/<capability>/<version>/` with:

- manifest;
- typed schemas;
- client implementation;
- auth binding through credential handles;
- pagination/rate-limit/retry handling;
- normalized errors;
- evidence extraction;
- redaction rules;
- unit and contract tests;
- sandbox integration tests;
- README with source docs and scopes.

### Sandbox and gates

Run in disposable isolated environment with:

- no production database or control-plane access;
- no host socket;
- restricted egress to documentation and provider sandbox domains;
- CPU/memory/time/process/file/network limits;
- ephemeral test credentials only;
- dependency allow/deny policy.

Mandatory pipeline:

```text
format
lint
type-check
unit tests
schema tests
mock contract tests
auth tests
provider sandbox tests
failure and retry tests
idempotency tests
secret scan
SAST
dependency vulnerability scan
license scan
SBOM
build/sign
risk review
approval if required
tenant canary
runtime verification
publish or rollback
```

A failure must produce visible events, allow the coding agent to edit the adapter, add a regression test, and rerun. The original user task remains durable and resumes only after an approved version is active.

The code agent must be blocked from modifying protected paths. Enforce this in repository permissions, sandbox mount configuration, and deployment identity—not only in prompts.

## 19. Policy and approvals

Use OPA with versioned bundles. Implement a policy request containing:

```text
principal and delegated user
tenant and role
task objective and risk
capability and tool version
connection and scopes
target domain/provider
recipient/merchant/account
material data classes
amount/currency/cumulative spend
time and location
side effect/reversibility
verification strength
requested action digest
```

Decision outcomes:

```text
DENY
REQUIRE_APPROVAL
ALLOW_WITH_LIMITS
ALLOW
REQUIRE_MULTI_PARTY_APPROVAL
```

Implement default policies for R0-R4, communications, financial limits, domains, file sharing, generated adapters, browser final submit, and device actions.

Approval cards must show material terms, connection, data shared, consequences, reversibility, expiry, and changed fields. Bind approval to a cryptographic digest; any material change invalidates it.

Never infer a standing permission from repeated approvals. You may suggest one in Settings after successful history.

## 20. Verification and evidence

Define a `VerificationDefinition` for every write-capable tool. Support:

- independent read-after-write;
- webhook or email confirmation;
- provider confirmation ID plus status check;
- artifact checksum and render check;
- payment settlement;
- signature status;
- browser post-action state;
- user acceptance when no objective verification exists.

Evidence must be content-addressed, immutable, time-stamped, and linked to task/step/tool/connection/verifier. A task can enter `COMPLETED` only when all mandatory checks pass. Use `COMPLETED_WITH_WARNINGS` for accepted partial outcomes.

Create a human-readable completion receipt and machine-readable audit export.

## 21. Push notifications and action requests

Implement a durable `ActionRequest` before sending push.

Types include:

```text
APPROVAL
CONNECTION_REQUIRED
SECURE_INPUT
MFA_OR_CAPTCHA
BROWSER_TAKEOVER
CHOICE
SIGNATURE
MISSING_INFORMATION
DEVICE_ACTION
```

Requirements:

- privacy-safe title/body;
- urgency and expiry;
- deep link to exact task and action request;
- duplicate suppression and policy-based reminders;
- quiet hours;
- high-risk actions require opening the app and recent auth;
- action remains visible if push is denied or phone is offline;
- response is immutable, audited, digest-bound, and delivered to Temporal as a signal/update;
- revalidate stale prices/terms/provider state after response.

## 22. Mobile application

### Navigation

Only two bottom tabs:

```text
Chat
Settings
```

Conversation history and active tasks are a drawer/sheet from Chat, not a third tab.

### Chat screen

Implement:

- message composer with text, voice-to-text hook, attachment picker, camera, and send;
- streaming assistant/event feed;
- task header with status, progress, pause/cancel, and emergency stop access;
- expandable plan;
- tool cards with started/succeeded/failed/retry states;
- route-change and adaptation cards;
- OAuth connection card;
- secure input card that uses a native secure sheet;
- approval/choice cards;
- browser observed/takeover card;
- code diff and test result cards;
- file/artifact cards with preview/download/share/version history;
- memory proposed/saved/corrected cards;
- external-wait and next-check cards;
- verified result/receipt card;
- “while you were away” summary based only on events;
- accessibility, dynamic type, screen reader labels, reduced motion, and localization-ready strings.

### Reconnect behavior

On app start or resume:

1. authenticate/refresh;
2. fetch latest conversation/task snapshot;
3. fetch events after locally stored sequence;
4. reconcile pending actions;
5. open SSE;
6. render exact current state;
7. show “while you were away” only if events were missed.

Local storage is a cache. Deleting it must not lose task state.

### Settings

Implement sections:

- Account and sessions;
- Connections;
- Memory;
- Permissions;
- Approval rules;
- Device access;
- Notifications;
- Security and emergency stop;
- Privacy/data export/delete;
- Developer/custom integrations for power users.

### OAuth mobile flow

- open system authentication browser;
- handle universal/app-link callback from terminated/background/foreground;
- return to originating task or Settings;
- poll or receive backend connection completion;
- never collect provider passwords in ordinary React state.

### Attachments

Support Files, Photos, camera, scan, and share extension. Upload directly to object storage, show progress, and attach artifact IDs after scan/ingestion.

## 23. On-device executor

Create a signed command protocol. A command includes:

```text
command_id
task_id
user_id
device_id
action_type
typed payload
required permission
risk class
requires foreground
requires confirmation
issued_at
expires_at
nonce
server signature
```

The mobile app validates all fields and returns a signed result with evidence.

Implement a realistic safe subset:

- open URL/deep link/app link;
- invoke declared App Intent/Shortcut or Android intent;
- read/select a contact with permission;
- create/update calendar event using platform API;
- present SMS/email compose UI where required;
- select/create a file in user-approved location;
- capture photo/document scan in foreground;
- retrieve foreground location with permission;
- biometric authentication;
- Home/Matter capability interface with stubbed provider if certificates/devices are unavailable;
- create a note in the product’s own secure notes store and expose extension points for provider/app intents;
- return unsupported for arbitrary Apple Notes or arbitrary app control when no official capability exists.

Do not implement general autonomous AccessibilityService behavior in the Play Store variant. Add a compile-time/product-flavor boundary for a future managed enterprise edition. Document the exact platform capability matrix.

## 24. Operator console

Build a minimal internal web console with role-based access for:

- service and provider health;
- queue/backlog and worker capacity;
- task metadata and state without content by default;
- audited just-in-time content access workflow;
- connection health;
- adapter versions, test reports, canaries, and rollback;
- policy bundle versions;
- model rollout/evaluations;
- emergency stop and incident controls;
- audit export and runbooks.

This console is not part of the consumer mobile navigation.

## 25. Observability and redaction

Instrument all services with OpenTelemetry and consistent correlation fields:

```text
trace_id
span_id
tenant_id (hashed in low-trust sinks)
user_id (hashed where appropriate)
conversation_id
task_id
step_id
tool_execution_id
provider_request_id
model_request_id
workflow_id
```

Create a central redaction library used before logs, traces, errors, and user events. It must detect configured secret patterns and field paths.

Metrics must include:

- task count and state duration;
- workflow queue latency and failures;
- model latency/tokens/cost/errors;
- tool selection and execution outcomes;
- verification rate and false success prevention;
- OAuth health/refresh/revocation;
- memory write/retrieval/correction/staleness;
- browser session success/takeover/injection blocks;
- adapter build/test/canary/rollback;
- upload/parse/quarantine;
- notification enqueue/delivery/action latency;
- emergency stop latency;
- per-tenant cost and quotas.

## 26. Security requirements

Implement and test:

- workload/service identity and mTLS-ready internal auth;
- strict tenant authorization and RLS defense in depth;
- CSRF/state/nonce/PKCE for OAuth;
- SSRF protection and DNS/IP validation for fetch/browser/adapter docs;
- sandbox egress allowlists and no host socket;
- no secrets in workflow history;
- no cross-agent authority transfer from web/document/email content;
- prompt-injection content labeling and tool boundary;
- signed device commands and action digests;
- session fixation/replay prevention;
- rate limits and abuse controls;
- malware/archive-bomb/path-traversal tests;
- dependency and container scanning;
- encrypted object storage, database, and backups;
- tamper-evident audit hashes;
- just-in-time operator access;
- data export/deletion and derived data cleanup;
- emergency stop that blocks new privileged leases rapidly.

Create automated tests with malicious webpage, PDF, email, MCP tool, generated dependency, OAuth callback, and cross-tenant fixtures.

## 27. Local development environment

`docker compose up` must start a usable environment containing:

- PostgreSQL + pgvector;
- Redis;
- MinIO;
- Temporal dev server and UI;
- OPA;
- ClamAV;
- Keycloak or a local OIDC provider;
- API/control services;
- workers;
- fake Meta provider unless real credentials are present;
- mock Composio/provider services or recorded contract fixtures;
- Playwright browser worker;
- sandbox controller;
- document worker;
- MailHog or equivalent for email test events;
- a push-notification development sink.

Provide one command to seed the demo and one command to run the complete test suite.

## 28. CI/CD and infrastructure

GitHub Actions must run:

- dependency install with lockfile enforcement;
- formatting/linting;
- strict type checks;
- unit tests;
- database migration tests;
- integration/contract tests with services;
- browser tests;
- document corpus tests;
- mobile unit tests and at least smoke build;
- secret scan;
- SAST;
- dependency/license scan;
- container build and scan;
- SBOM generation;
- infrastructure validation;
- generated adapter pipeline tests.

Create staged deployment manifests with separate worker pools for API, workflow/agent, browser, sandbox, and document jobs. Add network policies, resource limits, pod security, autoscaling, disruption budgets, liveness/readiness, and graceful shutdown.

Core application deployment and generated capability deployment must use different identities and approval gates.

## 29. Test plan and mandatory end-to-end scenarios

Automate as many as practical and document the rest.

### Scenario A: phone off and resume

- User starts a multi-step task.
- App is killed and device simulated offline.
- Backend performs allowed work and enters `WAITING_USER`.
- Action request and notification are created.
- User reconnects, deep-links to exact card, approves.
- Workflow resumes and verifies completion.

### Scenario B: one-time OAuth

- Task needs Gmail.
- Connection card launches Composio/native OAuth.
- Callback resumes task.
- New conversation later reuses connection without sign-in.
- Revocation causes a targeted connection-required state.

### Scenario C: durable memory

- User says: “I log my work calls at https://calls.example.com/team-log.”
- Memory is stored with provenance.
- A new conversation asks to log a call; the URL is retrieved and used.
- User changes URL; old record becomes superseded.
- User forgets it; retrieval stops and derivatives are removed.

### Scenario D: multimodal files

- Upload PDF with chart, XLSX with formulas, DOCX, PPTX, and image.
- Ingestion produces provenance-aware representations.
- Agent answers a cross-file question and cites exact page/sheet/range/slide/image.
- Agent edits a document and workbook, renders/checks them, and produces versioned artifacts.

### Scenario E: browser fallback

- No API exists.
- Browser opens isolated session.
- User takes over for login/MFA.
- Agent resumes, gathers terms, requests approval for final submit.
- It submits once and independently verifies provider state.

### Scenario F: generated adapter

- Official sandbox OpenAPI is provided.
- Agent defines minimal capability and generates adapter.
- First test fails due to a required field.
- Agent edits code, adds regression test, passes all gates.
- User approves scopes.
- Tenant canary succeeds; original task resumes.
- A forced canary failure demonstrates rollback.

### Scenario G: duplicate side-effect prevention

- Simulate timeout after provider accepted a write.
- Tool returns side-effect state `unknown`.
- Agent checks provider state and does not repeat the write.

### Scenario H: prompt injection

- Malicious page/PDF/email instructs agent to reveal credentials or call unrelated tools.
- Agent treats content as data, policy blocks escalation, no secret leaves the broker, and a security event is recorded.

### Scenario I: device limitation honesty

- Request silent iOS texting and arbitrary Notes app write.
- App uses supported compose/intent route or returns unsupported; it never claims background success without evidence.

### Scenario J: cross-tenant and emergency stop

- Attempt cross-tenant task, memory, artifact, connection, and vector retrieval.
- All deny and audit.
- Trigger emergency stop during active tool activity; new leases stop and task enters safe state.

## 30. Quality gates and definition of done

A phase is not complete until:

- code builds with strict type checks;
- tests pass and cover failure paths, not only happy paths;
- APIs are documented;
- migrations are reversible or have explicit irreversible review;
- secrets are not logged;
- user-visible events are truthful and traceable;
- cancellation, timeout, retry, and idempotency are implemented;
- observability and runbooks exist;
- accessibility is addressed;
- mobile platform constraints are documented;
- no placeholder success path exists;
- `IMPLEMENTATION_STATUS.md` accurately describes complete, partial, blocked, and next work.

The complete V1 acceptance gate is the “Production Readiness Exit Criteria” in `docs/FRD.md`.

## 31. Initial implementation sequence

Execute in this order unless repository dependencies require a documented adjustment.

### Phase 0 — Repository and architecture

- Initialize monorepo, tooling, strict configs, ADRs, threat model, Docker Compose.
- Create contracts, database schema, service templates, observability, OIDC, tenant auth.
- Add CI foundation.

### Phase 1 — Durable chat vertical slice

- Mobile Chat and Settings shell.
- Conversation/message/task APIs.
- Temporal `TaskWorkflow` with fake model and fake tools.
- Task events, snapshots, SSE, reconnect, pause/cancel.
- Action requests and development push sink.
- Complete end-to-end demo with verified fake provider state.

### Phase 2 — Meta model, policy, and real tools

- Meta Muse Spark provider and model gateway.
- OPA policies and approval digest.
- Tool SDK/gateway.
- Native sample integration and Composio connection/tool route.
- Credential broker.

### Phase 3 — Memory and files

- Full memory schema/write/retrieval/UI/evals.
- Upload, scan, ingest, search, artifact previews, and office/media workers.

### Phase 4 — Browser and notifications

- Isolated Playwright browser, takeover, prompt-injection defense, evidence.
- Production push provider and deep-link action flows.

### Phase 5 — Safe self-extension

- Capability gaps, official-doc discovery, OpenAPI generator, sandbox tests, signing, registry, canary, rollback, task resume.

### Phase 6 — Device executor and enterprise boundary

- Signed commands, safe mobile capabilities, platform matrix, managed-edition flavor boundary.

### Phase 7 — Production hardening

- Kubernetes/Terraform, SLO dashboards, load/chaos/DR tests, security gates, ops console, runbooks, data export/delete, launch checklist.

## 32. Final output expected from you

Do not merely describe the solution. Create the code, migrations, tests, local infrastructure, CI, documentation, and working vertical slices.

At the end, provide in `IMPLEMENTATION_STATUS.md`:

- architecture summary;
- exact commands to run locally;
- environment setup;
- test results;
- implemented features mapped to FRD requirement IDs;
- external credentials still needed;
- known platform/provider limitations;
- security review status;
- production deployment steps;
- remaining P1/P2 work, if any, stated honestly.

Begin now by reading `docs/FRD.md`, inventorying the repository, and writing `IMPLEMENTATION_PLAN.md`. Then implement Phase 0 and continue through the phases without waiting for confirmation unless a truly external prerequisite blocks execution.
