# Security policy

Do not report credentials in a public issue. Contact the repository owner through the private security channel configured for the organization.

Signal treats credentials as broker-owned data. Raw secrets are prohibited from model requests, workflow history, task events, memory, analytics, traces, crash reports, and ordinary logs. Security-sensitive changes require tests for tenant isolation, redaction, replay protection, policy enforcement, and auditability.

See `docs/threat-model.md` and `docs/runbooks/secret-leakage.md`.
