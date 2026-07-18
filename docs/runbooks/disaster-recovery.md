# Runbook: disaster recovery

1. Declare incident scope; freeze nonessential writes and provider retries.
2. Restore infrastructure from versioned Terraform/Helm, then PostgreSQL PITR, Temporal persistence, and object metadata/versioning.
3. Rotate workload/credential access exposed by the incident.
4. Reconcile committed outbox, workflow histories, and provider side effects before resuming activities.
5. Validate tenant isolation, evidence chains, notification deduplication, and emergency stop.
6. Record achieved RPO/RTO and remediate gaps. External actions are never blindly replayed.
