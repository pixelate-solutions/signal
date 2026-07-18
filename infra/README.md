# Signal infrastructure

The production baseline targets separate AWS accounts for development, staging, and production. It includes encrypted remote Terraform state, three-AZ networking, private EKS, RDS PostgreSQL, Redis, versioned cross-region S3, KMS, WAF, ACM/Route 53, workload identity, isolated Fargate workloads, observability/alerts, AWS Backup restore testing, External Secrets, ARC deploy runners, and digest-pinned Helm releases.

Start with the [production commissioning runbook](../docs/runbooks/production-commissioning.md). Key entry points:

- [`infra/terraform/bootstrap`](terraform/bootstrap): protected remote state.
- [`infra/terraform/aws`](terraform/aws): per-environment AWS stack.
- [`infra/terraform/environments`](terraform/environments): non-secret input templates.
- [`infra/runtime-secret.example.json`](runtime-secret.example.json): private provider/identity input schema.
- [`infra/helm/signal`](helm/signal): runtime chart and policies.
- [`scripts/commission-environment.sh`](../scripts/commission-environment.sh): guarded plan/apply, secret, and add-on commissioning.

Terraform never accepts provider credentials. Runtime input is validated and sent directly to Secrets Manager; Kubernetes receives it through External Secrets and workload identity.
