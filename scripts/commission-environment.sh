#!/usr/bin/env bash
set -euo pipefail

for signal_command in aws jq terraform; do
  if ! command -v "$signal_command" >/dev/null 2>&1; then
    echo "Missing required command: $signal_command" >&2
    exit 1
  fi
done

: "${SIGNAL_ENVIRONMENT:?Set SIGNAL_ENVIRONMENT to development, staging, or production.}"
: "${SIGNAL_TFVARS_FILE:?Set SIGNAL_TFVARS_FILE to the private environment tfvars file.}"
: "${SIGNAL_BACKEND_CONFIG:?Set SIGNAL_BACKEND_CONFIG to the private S3 backend config.}"

if [[ ! "$SIGNAL_ENVIRONMENT" =~ ^(development|staging|production)$ ]]; then
  echo "SIGNAL_ENVIRONMENT must be development, staging, or production." >&2
  exit 1
fi
if [[ ! -r "$SIGNAL_TFVARS_FILE" || ! -r "$SIGNAL_BACKEND_CONFIG" ]]; then
  echo "The tfvars and backend config files must both be readable." >&2
  exit 1
fi

signal_repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
signal_terraform_dir="${SIGNAL_TERRAFORM_DIR:-${signal_repo_root}/infra/terraform/aws}"
signal_temp_dir="$(mktemp -d "${TMPDIR:-/tmp}/signal-commission.XXXXXX")"
trap 'rm -rf "$signal_temp_dir"' EXIT

signal_account_id="$(aws sts get-caller-identity --query Account --output text)"
terraform -chdir="$signal_terraform_dir" init -reconfigure -backend-config="$SIGNAL_BACKEND_CONFIG"
terraform -chdir="$signal_terraform_dir" validate
terraform -chdir="$signal_terraform_dir" plan \
  -var-file="$SIGNAL_TFVARS_FILE" \
  -out="$signal_temp_dir/plan.tfplan"
terraform -chdir="$signal_terraform_dir" show -json "$signal_temp_dir/plan.tfplan" > "$signal_temp_dir/plan.json"

signal_planned_environment="$(jq -er '.variables.environment.value' "$signal_temp_dir/plan.json")"
if [[ "$signal_planned_environment" != "$SIGNAL_ENVIRONMENT" ]]; then
  echo "The plan environment (${signal_planned_environment}) does not match SIGNAL_ENVIRONMENT (${SIGNAL_ENVIRONMENT})." >&2
  exit 1
fi

if [[ "${SIGNAL_APPLY:-false}" != "true" ]]; then
  echo "Plan completed without applying. Set SIGNAL_APPLY=true after review to commission ${SIGNAL_ENVIRONMENT}."
  exit 0
fi

if [[ "$SIGNAL_ENVIRONMENT" == "production" && "${SIGNAL_PRODUCTION_CONFIRM:-}" != "production:${signal_account_id}" ]]; then
  echo "Production requires SIGNAL_PRODUCTION_CONFIRM=production:${signal_account_id}." >&2
  exit 1
fi
: "${SIGNAL_RUNTIME_INPUT_FILE:?Set SIGNAL_RUNTIME_INPUT_FILE to the private provider and identity input JSON before applying.}"

terraform -chdir="$signal_terraform_dir" apply "$signal_temp_dir/plan.tfplan"

SIGNAL_TERRAFORM_DIR="$signal_terraform_dir" \
SIGNAL_RUNTIME_INPUT_FILE="$SIGNAL_RUNTIME_INPUT_FILE" \
  "$signal_repo_root/scripts/commission-runtime-secret.sh"

SIGNAL_CLUSTER_NAME="$(terraform -chdir="$signal_terraform_dir" output -raw cluster_name)"
SIGNAL_AWS_REGION="$(terraform -chdir="$signal_terraform_dir" output -raw aws_region)"
SIGNAL_VPC_ID="$(terraform -chdir="$signal_terraform_dir" output -raw vpc_id)"
SIGNAL_RUNTIME_SECRET_ARN="$(terraform -chdir="$signal_terraform_dir" output -raw runtime_secret_arn)"
SIGNAL_RUNTIME_K8S_SECRET="signal-${SIGNAL_ENVIRONMENT}-runtime"
SIGNAL_KUBERNETES_NAMESPACE="$(terraform -chdir="$signal_terraform_dir" output -raw kubernetes_namespace)"
SIGNAL_ROUTE53_ZONE_ID="$(terraform -chdir="$signal_terraform_dir" output -raw route53_zone_id)"
SIGNAL_FARGATE_LOG_GROUP="$(terraform -chdir="$signal_terraform_dir" output -raw fargate_log_group)"
export SIGNAL_CLUSTER_NAME SIGNAL_AWS_REGION SIGNAL_VPC_ID SIGNAL_RUNTIME_SECRET_ARN
export SIGNAL_RUNTIME_K8S_SECRET SIGNAL_KUBERNETES_NAMESPACE SIGNAL_ROUTE53_ZONE_ID
export SIGNAL_FARGATE_LOG_GROUP SIGNAL_ENVIRONMENT

"$signal_repo_root/scripts/commission-eks-addons.sh"

terraform -chdir="$signal_terraform_dir" output
echo "Signal ${SIGNAL_ENVIRONMENT} infrastructure, runtime secret, and EKS add-ons are commissioned."
