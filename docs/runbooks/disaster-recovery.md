# Runbook: disaster recovery

## Declare and contain

1. Declare severity, incident commander, affected tenants/regions/providers, and recovery objectives.
2. Trigger the narrowest emergency stop that prevents new side effects. Freeze nonessential writes and provider retries; preserve logs, workflow histories, audit records, WAF/flow logs, and object versions.
3. Rotate or revoke any workload, provider, signing, support, or operator identity exposed by the incident.

## Restore

1. Recreate the target environment from reviewed Terraform and Helm using the encrypted remote-state backend. Never restore a compromised mutable node or container image.
2. Restore PostgreSQL to the chosen point-in-time or use the latest successful AWS Backup restore-test recovery point. Restore Temporal persistence/namespace access and verify workflow histories before starting workers.
3. Restore S3 object versions and, for regional loss, promote/copy from the recovery-region bucket. Reconcile object metadata with PostgreSQL before exposing downloads.
4. Restore/rotate KMS grants, Secrets Manager values, workload identity, OIDC, provider credentials, APNs/FCM, and deploy-runner trust. Reissue mobile/API tokens when required.
5. Deploy the last known signed immutable image digests. Keep generated adapters disabled until signatures, registry state, and tenant activation records are reconciled.

## Reconcile before resume

1. Verify tenant isolation/RLS, migration version, audit hash chains, evidence/object digests, browser-profile encryption, notification deduplication, device command expiry/replay state, and emergency stop.
2. Reconcile the transactional outbox, Temporal workflow histories, tool idempotency records, pending OAuth/cleanup work, browser sessions, push deliveries, and provider side effects.
3. Treat every interrupted external write with unknown side-effect state as a manual reconciliation item. Read provider state or confirmation identifiers; never blindly replay it.
4. Run acceptance scenarios A–J and targeted provider health from a recovery tenant before lifting write freezes.

## Return and learn

Resume tenants in controlled cohorts, watch error/cost/backlog/circuit metrics, and retain rollback authority. Record actual RPO/RTO, data/provider discrepancies, key rotations, tenant communications, and remediation owners. Attach Terraform plan, restore-test evidence, database/object checks, audit-chain verification, and incident timeline to the postmortem.
