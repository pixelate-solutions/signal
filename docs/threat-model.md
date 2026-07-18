# Signal STRIDE threat model

## Assets

Identity/session claims, tenant data, task authority, OAuth grants, credential handles, browser state, artifacts, memories, policy bundles, device keys, audit/evidence records, generated adapter artifacts, deployment/signing identities, and provider accounts.

## Trust boundaries

1. Mobile/device ↔ public API.
2. Public API ↔ internal workload identities.
3. Agent/model ↔ deterministic tool and policy gateway.
4. Gateway ↔ credential broker and external providers.
5. Control plane ↔ isolated browser/document/code workers.
6. Tenant ↔ tenant at every data access path.
7. Generated capability pipeline ↔ protected kernel/deployment identity.
8. Operator ↔ just-in-time user-content access.

## Threats and controls

| STRIDE                 | Representative threat                                                                    | Required controls                                                                                                                         | Verification                                 |
| ---------------------- | ---------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------- |
| Spoofing               | Stolen session, OAuth callback substitution, forged device command                       | OIDC validation, PKCE/state/nonce, exact redirects, recent auth, signed short-lived commands, nonce replay store                          | Callback and command forgery tests           |
| Tampering              | Changed approval terms, event/evidence modification, poisoned adapter                    | SHA-256 material digest, append-only events, evidence hashes, signed packages/images, protected paths                                     | Digest mismatch and chain verification tests |
| Repudiation            | User/provider/operator disputes an action                                                | Immutable decisions, principal/delegate IDs, policy/tool versions, provider request IDs, JIT support audit                                | Machine-readable receipt replay              |
| Information disclosure | Token in prompt/log, cross-tenant vector result, browser-state theft                     | Opaque handles, central redaction, RLS + service auth, envelope encryption, isolated browser identities, DLP                              | Secret fixtures and cross-tenant suites      |
| Denial of service      | Task loop, queue flood, archive bomb, provider storm                                     | Per-tenant quotas, bounded agent loop, backpressure, circuit breakers, archive limits, durable timers                                     | Load, budget, and malicious archive tests    |
| Elevation of privilege | Prompt injection grants tools, broad OAuth overrides policy, generated code edits kernel | Content/instruction separation, deterministic policy, least-privilege leases, egress controls, protected mounts and deployment identities | Web/PDF/email/MCP adversarial suites         |

## High-risk abuse cases

- A provider timeout after a write is classified `unknown`; the workflow performs state verification before any retry.
- A malicious page asks to reveal secrets; page text is labeled untrusted and cannot create authority.
- A support operator requests content; access requires reason, expiry, user/incident scope, and a tamper-evident audit event.
- Emergency stop revokes new leases first, then attempts in-flight cancellation and reports non-reversible actions.

Residual risks include provider compromise, unavoidable external irreversibility, mobile device compromise, and public-preview model/API changes. Runbooks define containment and recovery.
