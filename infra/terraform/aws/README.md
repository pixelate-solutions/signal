# AWS reference deployment

This Terraform stack provisions a three-AZ VPC, private EKS cluster, isolated node pools, encrypted multi-AZ PostgreSQL and Redis, versioned KMS-backed artifact storage, immutable ECR repositories, VPC flow logs, WAF policy, alarms, and AWS Backup. It intentionally does not put provider credentials in Terraform state.

Use an encrypted remote state backend with state locking. Run separate state and AWS accounts for development, staging, and production. Temporal Cloud, OIDC, egress proxy, DNS/certificates, and workload identity bindings remain environment integrations because their account identifiers and trust policies are operator-owned.

```bash
terraform -chdir=infra/terraform/aws init -backend=false
terraform -chdir=infra/terraform/aws fmt -check -recursive
terraform -chdir=infra/terraform/aws validate
terraform -chdir=infra/terraform/aws plan -var-file=terraform.tfvars
```

The generated-capability runner uses a separate Kubernetes service account and image repository. Its release workflow must require signed artifacts, policy approval, and tenant canary evidence; it must never share the core deployment role.
