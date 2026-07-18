# Signal Helm chart

The chart deploys API, workflow, browser, sandbox-controller, and document pools with distinct scaling and disruption policies. It creates separate `core` and `generated` service accounts; generated jobs are disabled until the adapter approval pipeline enables a signed image and tenant canary.

Create `signal-runtime` outside Helm with database, Redis, object-store, OIDC, provider, KMS, push, Temporal, and internal service credentials. Production values must use immutable image digests and a dedicated egress proxy. No workload receives a Docker socket or a default Kubernetes token.

```bash
helm lint infra/helm/signal
helm template signal infra/helm/signal --set global.existingSecret=""
```
