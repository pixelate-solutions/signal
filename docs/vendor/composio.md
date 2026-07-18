# Composio integration and commissioning

Verified against the current Composio API shape on 2026-07-18.

Signal creates sessions with the stable Signal user ID and uses Hosted Authentication connect links. The production path:

- creates a connect request with the configured auth config and Signal callback;
- binds signed one-use state to tenant, user, originating task, toolkit/scopes, replacement connection, and return deep link;
- stores only the connected-account identifier and normalized metadata in PostgreSQL;
- stores the opaque account reference inside a KMS-envelope-encrypted credential handle;
- monitors account status and marks broken authorization `ACTION_REQUIRED`;
- pins every registered tool slug and version;
- requires independent verification metadata for every side-effecting tool;
- revokes superseded accounts during reauthentication and durably retries failed cleanup;
- disables or deletes the upstream account when the user disables or revokes the Signal connection.

The retired managed-OAuth `initiate()` path is not used.

## Operator setup

1. Create separate staging and production Composio projects.
2. Create an auth config for each provider/toolkit using Pixelate-owned OAuth applications where branding, scope control, or provider review requires it.
3. Put provider/toolkit-to-auth-config IDs in `COMPOSIO_AUTH_CONFIGS` in the private runtime JSON.
4. Add only reviewed tools to `COMPOSIO_TOOLS`. Pin `toolSlug` and `toolVersion`; `latest` is rejected. Declare exact JSON input schema, provider, scopes, risk, side effect, and read-after-write verification tool/argument mapping for writes.
5. Set `COMPOSIO_API_KEY`. The commissioning script derives `COMPOSIO_CALLBACK_URL` as `APP_PUBLIC_URL + /v1/connections/callback`.
6. Link staging accounts, exercise every registered tool and verifier, then set `SIGNAL_STAGING_EXPECTED_PROVIDERS` so release promotion fails when health is not green.

References: [How Composio works](https://docs.composio.dev/docs/how-composio-works) and [authenticating tools](https://docs.composio.dev/docs/tools-direct/authenticating-tools).
