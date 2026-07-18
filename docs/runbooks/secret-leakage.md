# Runbook: secret leakage

1. Stop the affected lease/provider/tool and restrict log/artifact access.
2. Rotate or revoke the exposed secret before investigating convenience.
3. Search permitted sinks by secret fingerprint, not raw value; quarantine affected data and derived indexes.
4. Notify required parties and preserve a tamper-evident incident record.
5. Patch the source and central redaction rules, add a regression fixture, and verify deletion/retention obligations.
