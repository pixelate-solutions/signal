# Composio integration

Verified against current Composio documentation on 2026-07-18.

Signal uses sessions created with a stable product user UUID and Hosted Authentication (Connect Link). Current TypeScript flow:

- create/reuse a scoped session with `composio.create(userId)` / `composio.use(sessionId)`;
- generate a hosted connection using `connectedAccounts.link(userId, authConfigId, { callbackUrl })`;
- bind callback state to tenant, user, originating task, requested toolkit/scopes, and return deep link;
- persist only Composio identifiers and normalized metadata in Signal;
- reuse connected accounts on future sessions;
- require operator-owned OAuth applications for production branding/scopes where applicable.

Composio's older managed-OAuth `initiate()` path was retired in 2026; Signal does not use it.

References:

- <https://docs.composio.dev/docs/how-composio-works>
- <https://docs.composio.dev/docs/tools-direct/authenticating-tools>
