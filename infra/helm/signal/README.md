# Signal Helm chart

The chart deploys API, workflow, browser, sandbox-controller/runner/canary, document, OPA, ClamAV, and observability pools with distinct scaling, disruption, and network policies. It creates separate `core`, browser, sandbox, and generated identities; generated jobs remain unavailable until the adapter approval pipeline enables a signed tenant canary.

Create `signal-runtime` and `signal-ghcr-pull` outside Helm through the commissioning scripts. They contain database, Redis, object-store, OIDC, provider, KMS, push, Temporal, internal service, and private registry credentials. Production values require immutable image digests and a dedicated egress proxy. No workload receives a Docker socket or a default Kubernetes token.

```bash
helm lint infra/helm/signal
helm template signal infra/helm/signal --set global.existingSecret=""
```

See the [production commissioning runbook](../../../docs/runbooks/production-commissioning.md) for add-ons, External Secrets, ARC runners, migrations, release variables, and rollout evidence.
