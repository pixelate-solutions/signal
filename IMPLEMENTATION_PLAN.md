# Signal implementation plan

## Delivery rules

1. Build vertical slices that are runnable before broadening the surface.
2. Keep authority, credentials, policy, audit, browser, and sandbox boundaries separate.
3. Treat every external response as an observation; completion requires typed verification.
4. Production adapters fail closed when credentials or provider state are unavailable.
5. Update `IMPLEMENTATION_STATUS.md` after every phase and keep `main` buildable.

## Phase 0 — Repository and architecture

Dependencies: none.

- Initialize pnpm/Turborepo, TypeScript 7 strict configs, Python 3.12 worker metadata, linting, testing, CI, and secret scanning.
- Preserve the FRD and master build contract in `docs/`.
- Define ADRs, trust boundaries, STRIDE threat model, runbooks, configuration, and local infrastructure.
- Define versioned contracts and the PostgreSQL schema with tenant isolation.

Acceptance gate:

- `pnpm install`, formatting, lint, strict typecheck, unit tests, and builds pass.
- Docker Compose is syntactically valid.
- Protected-boundary import test passes.

## Phase 1 — Durable chat vertical slice

Dependencies: Phase 0 contracts, database, auth principal.

- Implement conversation/message/task APIs and a monotonic append-only event store.
- Implement deterministic task state transitions, snapshots, idempotency, SSE replay, action requests, pause/resume/cancel, and emergency stop.
- Implement Temporal `TaskWorkflow` plus an in-process deterministic harness for fast tests.
- Build the two-tab mobile shell and event-card renderer.
- Exercise a verified local scenario: research observation → approval → side effect in a test state store → independent read-after-write → receipt.

Acceptance gate:

- Crash/replay and duplicate-side-effect tests pass.
- A reconnecting client receives ordered events after its last sequence.
- Digest-bound approval rejects changed material terms.
- The local scenario ends only after independent verification.

## Phase 2 — Model, policy, tools, and connections

Dependencies: durable workflow and event store.

- Implement provider-neutral model gateway, Meta Model API adapter, deterministic provider, budget/cancellation, and request metadata.
- Implement deterministic policy evaluator plus OPA client and R0–R4 defaults.
- Implement Tool SDK, gateway, route ranking, scoped execution leases, normalized outcomes, and evidence.
- Implement Composio sessions/Connect Link and native OAuth PKCE behind a normalized connection provider.
- Implement credential-handle boundary and encrypted-material provider interface.

Acceptance gate:

- Common contract tests pass for fake and Meta providers.
- Missing external credentials emit `CONNECTION_REQUIRED`.
- No raw secret reaches events, logs, memory, or model requests.
- Unknown side-effect state triggers provider-state verification before any retry.

## Phase 3 — Memory and artifacts

Dependencies: event provenance and policy.

- Implement governed semantic/procedural/episodic memory, conflicts, temporal validity, scope, and deletion.
- Implement the canonical work-call URL scenario across conversations.
- Implement multipart upload contracts, quarantine, checksums, versions, citations, and the document worker.
- Add format processors and honest unsupported-element warnings.

Acceptance gate:

- Memory scope, supersession, secret rejection, expiry, and deletion tests pass.
- Core document corpus processors emit location-aware representations.
- Artifact evidence is immutable and tenant-scoped.

## Phase 4 — Browser and notifications

Dependencies: artifact, policy, action requests.

- Implement isolated Playwright sessions, egress validation, DOM-first operations, takeover states, final-action approval, and evidence.
- Implement development push sink and Firebase provider boundary with deep links, deduplication, quiet hours, and expiry.

Acceptance gate:

- Prompt-injection fixtures cannot grant authority or access credentials.
- Material browser actions cannot submit without a valid current digest.
- Action remains durable when push delivery fails.

## Phase 5 — Safe self-extension

Dependencies: sandbox, tool registry, policy, evidence.

- Implement capability-gap schema, official-document provenance, generated adapter template, protected paths, gates, signing interface, canary, rollback, and resume.
- Add a sandbox OpenAPI fixture that fails, is repaired, retested, canaried, and rolled back on forced failure.

Acceptance gate:

- Generated code has no control-plane credentials or host socket.
- Mandatory gates and protected-path checks fail closed.
- Original task resumes only with the approved pinned version.

## Phase 6 — Device executor and enterprise boundary

Dependencies: policy, mobile secure storage, action requests.

- Implement signed/replay-protected device command envelopes and results.
- Add safe platform capability handlers and explicit unsupported responses.
- Separate consumer and managed-enterprise capability manifests.

Acceptance gate:

- Modified, expired, duplicated, or wrong-device commands are rejected.
- Silent arbitrary iOS/Android app control is never represented as supported.

## Phase 7 — Production hardening

Dependencies: all vertical slices.

- Complete operator console, OpenTelemetry, SLOs, audit export, deletion, backups, Helm, Terraform, network policies, and CI/CD gates.
- Run lint, type, unit, integration, contract, browser, document, mobile, boundary, secret, and build checks.
- Produce launch checklist and exact external credential/certificate list.

Acceptance gate:

- `pnpm test:all` passes.
- Container and infrastructure validation pass.
- `IMPLEMENTATION_STATUS.md` truthfully maps implementation to FRD IDs and launch prerequisites.
