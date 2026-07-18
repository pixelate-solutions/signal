# Runbook: Meta model outage

1. Mark the exact provider/model/API version unhealthy and stop new calls.
2. Preserve task continuation outside model context; active tasks enter a durable external wait.
3. Do not silently select another model. An approved configured fallback must be disclosed in task metadata.
4. Probe health with non-user synthetic input; canary before restoring traffic.
5. Reconcile usage/request IDs and resume within task budgets.
