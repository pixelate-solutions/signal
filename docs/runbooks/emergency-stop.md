# Runbook: emergency stop

1. Persist the stop scope and audit event before best-effort notifications.
2. Block new privileged leases within five seconds.
3. Signal active workflows, cancel safe activities, terminate browser/sandbox sessions, and revoke scoped credentials.
4. Identify in-flight or irreversible provider operations and verify their actual state.
5. Present a receipt listing stopped work, confirmed side effects, uncertain actions, and recovery choices.
