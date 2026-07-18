# Example status generated adapter

This versioned fixture demonstrates Signal's generated-adapter package boundary. Its source of authority is the recorded official sandbox OpenAPI URL and digest in `manifest.json`. It requests only `status:read`, receives credentials through an injected callback, normalizes provider failures, validates every response, and never stores tokens.

Production publication requires every stage in `@signal/sandbox-controller`, a tenant canary, runtime verification, and a signature from the capability-deployment identity.
