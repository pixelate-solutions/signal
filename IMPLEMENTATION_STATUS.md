# Signal implementation status

Last verified: 2026-07-18

## Delivery status

The Signal V1 reference implementation is complete and runnable locally. It includes the two-destination mobile experience, an isolated operations console, tenant-scoped durable task state, append-only execution events, digest-bound approvals, independent verification, governed tools/connections/memory/artifacts, isolated browser and sandbox workers, document processing, policy, observability, and deployment assets.

The local stack is an acceptance and development baseline, not a claim that operator-owned production integrations have been commissioned. Production rollout still requires the credentials, managed services, provider reviews, and staging evidence listed below.

## Architecture summary

Signal separates the mobile cockpit, public API, task service, durable workflow, agent runtime, tool gateway, credential/connection service, browser worker, sandbox controller, and document worker. PostgreSQL stores tenant-scoped task runtime state; Temporal is provisioned for durable workflows; Redis is nonauthoritative fan-out. Deterministic code owns authorization, execution, and verification. User-visible progress is rendered from monotonic, digest-chained events.

## Verified gates

The following completed successfully on the repository state dated above:

| Gate                                                           | Result                                                                                 |
| -------------------------------------------------------------- | -------------------------------------------------------------------------------------- |
| Prettier, ESLint, protected-boundary checks                    | Passed                                                                                 |
| TypeScript strict typecheck                                    | Passed across all workspace targets                                                    |
| TypeScript unit, contract, failure, tenant, and scenario tests | Passed                                                                                 |
| Production builds, including Expo web and operations console   | Passed                                                                                 |
| Python Ruff formatting/lint, mypy, and document corpus tests   | Passed                                                                                 |
| PostgreSQL migration, seed, guarded rollback, reapply          | Passed on an isolated database                                                         |
| PostgreSQL task-store restart and concurrency integration      | Passed against the live Compose database                                               |
| ClamAV clean-file and EICAR integration                        | Passed against the live Compose scanner                                                |
| OPA policy tests                                               | Passed                                                                                 |
| Docker Compose validation and full-stack health                | Passed                                                                                 |
| Package-scoped production container builds                     | Passed; development workspace and toolchain excluded from Node runtime images          |
| Helm lint/template and Terraform format/init/validate          | Passed                                                                                 |
| Secret scan and production dependency audit                    | Passed                                                                                 |
| Live UI/API restart exercise                                   | Passed: approval resumed after API replacement and completed with independent evidence |

Reproduce the aggregate portable gate with:

```bash
cp .env.example .env
pnpm install
pnpm test:all
docker compose up --build --detach --wait
```

## Phase status

| Phase                                 | Reference deliverable                                                                                                        | Status                                                          |
| ------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------- |
| 0 — Repository and architecture       | Strict monorepo, contracts, RLS schema, threat model, ADRs, runbooks, CI, local infrastructure                               | Complete                                                        |
| 1 — Durable chat vertical slice       | Chat/Settings, PostgreSQL task state, ordered event replay, approval, restart recovery, read/write/verify receipt            | Complete                                                        |
| 2 — Model, policy, tools, connections | Provider-neutral model contract, Meta adapter, OPA policy, leases, idempotency, OAuth/Composio boundaries                    | Complete locally; production credentials required               |
| 3 — Memory and artifacts              | Provenance, scope, correction/deletion, quarantined upload, ClamAV, multimodal document worker, versioned evidence           | Complete locally                                                |
| 4 — Browser and notifications         | Isolated browser policy, takeover states, digest-bound final submit, deep-linked durable development push                    | Complete against local fixtures                                 |
| 5 — Safe self-extension               | Generated-only boundary, failed-test repair, full gates, signed release workflow, canary and rollback contract               | Complete; external canary executor required for release         |
| 6 — Device executor                   | Signed, expiring, replay-protected commands and honest unsupported capability results                                        | Complete                                                        |
| 7 — Production hardening              | Ops metadata view, OpenTelemetry, SLO rules, scoped runtime images, Compose, Helm, AWS Terraform, backup/DR, CI/CD, runbooks | Deployment baseline complete; environment commissioning remains |

The detailed evidence mapping for mandatory scenarios A–J is in [`docs/acceptance-scenarios.md`](docs/acceptance-scenarios.md).

## Production qualifications

The following boundaries are deliberate and must be replaced or commissioned before a public production launch:

- The local demonstration is driven by a deterministic in-process runtime. The Temporal workflow and worker are built and deployed, but production task submission must be wired to the Temporal client rather than the demo runtime.
- Task state is durable in PostgreSQL. Connection, memory, and artifact service repositories use local in-process adapters; production needs PostgreSQL-backed repositories and S3/MinIO-backed object bytes before horizontal scaling.
- The browser scenario is verified against an isolated local fixture. Production needs an interactive takeover channel, per-tenant encrypted browser-profile storage, approved egress policy, and staging-provider evidence.
- Generated-capability CI packages and attests candidates, but promotion intentionally fails closed until an operator supplies the isolated canary endpoint and environment approvals.
- Local identity, email, push, model, OAuth, and provider fixtures are deterministic. They do not represent a successful real provider action.
- Terraform and Helm are validated reference deployments. A production plan/apply, regional recovery drill, load test, mobile store signing/review, and provider policy review remain environment-specific release gates.

## External launch inputs

Production Meta Model API, OIDC, Composio, Google OAuth, APNs/FCM, KMS, DNS/TLS, workload identity, Temporal, cloud, Apple, and Google Play credentials are operator-owned inputs. The staging generated-capability canary URL/token and protected GitHub environments are also required. Local deterministic providers remain available without them and never report external success.
