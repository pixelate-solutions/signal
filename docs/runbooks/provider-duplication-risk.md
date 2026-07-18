# Runbook: provider duplication risk

1. Freeze retries when a side effect is `unknown`.
2. Query provider state using idempotency key, confirmation ID, account, and expected material terms.
3. If completed, capture independent evidence and checkpoint without replay.
4. If definitely not started, retry once under the original key and current approval.
5. If unresolved, enter `WAITING_USER`, explain the ambiguity, and do not guess.
