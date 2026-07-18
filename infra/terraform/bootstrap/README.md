# Terraform state bootstrap

This root creates the versioned, KMS-encrypted, non-public S3 backend used by every Signal environment. Native S3 lockfiles prevent concurrent state writers. The bootstrap script first creates the backend with local state, then immediately migrates that bootstrap state into the protected bucket.

Run this once per AWS account and state region:

```bash
SIGNAL_BOOTSTRAP_APPLY=true scripts/bootstrap-terraform-state.sh
```

The KMS key and bucket have `prevent_destroy`. Their state lives at `bootstrap/terraform.tfstate` in the same remote backend. Never put provider credentials or runtime secrets in Terraform variables.
