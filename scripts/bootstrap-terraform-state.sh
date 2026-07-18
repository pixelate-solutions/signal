#!/usr/bin/env bash
set -euo pipefail

for signal_command in aws terraform; do
  if ! command -v "$signal_command" >/dev/null 2>&1; then
    echo "Missing required command: $signal_command" >&2
    exit 1
  fi
done

if [[ "${SIGNAL_BOOTSTRAP_APPLY:-false}" != "true" ]]; then
  echo "Set SIGNAL_BOOTSTRAP_APPLY=true to create or reconcile the protected state backend." >&2
  exit 1
fi

signal_repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
signal_bootstrap_dir="${SIGNAL_BOOTSTRAP_TERRAFORM_DIR:-${signal_repo_root}/infra/terraform/bootstrap}"
signal_state_region="${SIGNAL_STATE_REGION:-us-east-2}"
signal_state_project="${SIGNAL_STATE_PROJECT:-signal}"
signal_account_id="$(aws sts get-caller-identity --query Account --output text)"
signal_state_bucket="${SIGNAL_STATE_BUCKET:-${signal_state_project}-terraform-state-${signal_account_id}-${signal_state_region}}"
signal_state_key="bootstrap/terraform.tfstate"
signal_kms_alias="alias/${signal_state_project}-terraform-state"

if aws s3api head-bucket --bucket "$signal_state_bucket" >/dev/null 2>&1; then
  terraform -chdir="$signal_bootstrap_dir" init -reconfigure \
    -backend-config="bucket=${signal_state_bucket}" \
    -backend-config="key=${signal_state_key}" \
    -backend-config="region=${signal_state_region}" \
    -backend-config="kms_key_id=${signal_kms_alias}"
  terraform -chdir="$signal_bootstrap_dir" apply \
    -var="aws_region=${signal_state_region}" \
    -var="project=${signal_state_project}" \
    -var="state_bucket_name=${signal_state_bucket}"
else
  terraform -chdir="$signal_bootstrap_dir" init -backend=false
  terraform -chdir="$signal_bootstrap_dir" apply \
    -var="aws_region=${signal_state_region}" \
    -var="project=${signal_state_project}" \
    -var="state_bucket_name=${signal_state_bucket}"
  terraform -chdir="$signal_bootstrap_dir" init -migrate-state -force-copy \
    -backend-config="bucket=${signal_state_bucket}" \
    -backend-config="key=${signal_state_key}" \
    -backend-config="region=${signal_state_region}" \
    -backend-config="kms_key_id=${signal_kms_alias}"
fi

terraform -chdir="$signal_bootstrap_dir" output
echo "Signal Terraform state backend is commissioned in AWS account ${signal_account_id}."
