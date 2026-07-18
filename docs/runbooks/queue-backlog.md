# Runbook: queue backlog

1. Measure queue age by task class, tenant, and worker build; protect security and user-action queues first.
2. Apply tenant concurrency limits and stop low-priority polling/model work.
3. Scale the isolated worker pool; do not merge browser, sandbox, or document privileges to add capacity.
4. Update expected-delay events without fabricating progress.
5. Drain, verify duplicate protections, and perform root-cause/capacity review.
