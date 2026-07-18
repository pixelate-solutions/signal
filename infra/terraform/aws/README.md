# AWS reference deployment

This Terraform stack provisions a three-AZ VPC, private EKS cluster, isolated node and Fargate pools, encrypted multi-AZ PostgreSQL and Redis, versioned cross-region KMS-backed artifact storage, immutable ECR repositories, workload identities, VPC flow logs, DNS/TLS, WAF policy, observability, alarms, AWS Backup, and automated database restore testing. It intentionally does not put provider credentials in Terraform state.

Use an encrypted remote state backend with state locking. Run separate state and AWS accounts for development, staging, and production. Temporal Cloud, OIDC, egress proxy, DNS/certificates, and workload identity bindings remain environment integrations because their account identifiers and trust policies are operator-owned.

```bash
terraform -chdir=infra/terraform/aws init -backend=false
terraform -chdir=infra/terraform/aws fmt -check -recursive
terraform -chdir=infra/terraform/aws validate
terraform -chdir=infra/terraform/aws plan -var-file=terraform.tfvars
```

The generated-capability runner uses a separate Kubernetes service account and image repository. Its release workflow requires signed artifacts, policy approval, and tenant canary evidence; it never shares the core deployment role. Follow the [commissioning runbook](../../../docs/runbooks/production-commissioning.md) for guarded plan/apply and environment promotion.
