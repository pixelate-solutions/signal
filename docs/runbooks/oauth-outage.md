# Runbook: OAuth or connection outage

1. Confirm provider status and callback reachability without exposing callback query secrets.
2. Disable new connection attempts for the affected provider; keep existing unrelated connections active.
3. Move blocked tasks to `WAITING_USER` only when user action can help; otherwise `WAITING_EXTERNAL`.
4. Never request a password in Chat. Show the normalized connection health and retry window.
5. After recovery, revalidate state/scopes, resume by workflow signal, and audit all credential-lease attempts.
