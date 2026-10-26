# Signal

Signal is a chat-first, persistent cloud operator. A user states an objective; the backend keeps working after the phone closes, pauses at authority boundaries, and marks work complete only after verification.

The product has two consumer destinations:

- **Chat** — objectives, structured execution events, approvals, artifacts, and verified receipts.
- **Settings** — connections, memory, policy, devices, privacy, and security.

## Quick start

Prerequisites: Node 24, pnpm 10, Docker Desktop, and at least 12 GB of available memory.

```bash
cp .env.example .env
pnpm install
docker compose up --build --detach --wait
```

The Compose startup migrates and seeds PostgreSQL before the API becomes healthy. It starts deterministic local providers, so no external account or credential is needed for the reference workflow.

Open:

- Mobile web build: `http://localhost:8082`
- API and OpenAPI: `http://localhost:3000/docs`
- Operator console: `http://localhost:4173`
- Temporal UI: `http://localhost:8233`
- MinIO console: `http://localhost:9001`
- Keycloak: `http://localhost:8080`
- Mailpit: `http://localhost:8025`
- Grafana: `http://localhost:3001`

Stop the stack without deleting durable local volumes:

```bash
docker compose down
```

Use `docker compose down --volumes` only when you intentionally want to erase the local database, object store, and observability data.

## Verification

Run the complete source, Python, policy, Compose, Helm, and Terraform gate:

```bash
pnpm test:all
```

Focused commands are available when iterating:

```bash
pnpm format:check
pnpm lint
pnpm typecheck
pnpm test
pnpm build
pnpm security:scan
```

The local environment defaults to deterministic providers. These providers operate only on a test state store, emit evidence, and never masquerade as external provider success. Missing production credentials return `CONNECTION_REQUIRED`.

To exercise real providers, configure the model and provider variables in `.env`, then start the
explicit live-provider overlay:

```bash
pnpm compose:live --detach --wait
```

Live mode disables the deterministic tool registry. External writes still pause for connection and
policy approval, and completion requires provider read-back evidence.

## Repository map

- `apps/mobile`: Expo prebuild React Native app with exactly Chat and Settings tabs.
- `apps/ops-console`: isolated internal operations console.
- `services/api`: NestJS/Fastify public API and SSE edge.
- `services/task-service`: authoritative task/event/action domain.
- `services/workflow-worker`: Temporal workflow and activities.
- `services/agent-worker`: bounded agent loop and context compiler.
- `services/tool-gateway`: the only privileged tool execution edge.
- `services/connection-service`: Composio/native OAuth and opaque credential handles.
- `services/memory-service`: governed memory write/retrieval.
- `services/artifact-service`: upload, scan, version, and evidence metadata.
- `services/notification-service`: durable push dispatch.
- `services/browser-worker`: isolated Playwright operator.
- `services/sandbox-controller`: generated-adapter sandbox orchestration.
- `services/document-worker`: Python 3.12 multimodal processor.
- `packages/*`: versioned contracts and protected shared libraries.

Read [the implementation status](IMPLEMENTATION_STATUS.md) for the production V1 closure matrix. The [production commissioning runbook](docs/runbooks/production-commissioning.md) covers operator-owned cloud/provider launch work, including exact [Google OAuth](docs/oauth/google.md), [GitHub](docs/oauth/github.md), and [mobile release](docs/runbooks/mobile-release.md) setup. The [acceptance scenario matrix](docs/acceptance-scenarios.md) maps every mandatory scenario to executable evidence.
