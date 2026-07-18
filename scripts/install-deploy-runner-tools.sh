#!/usr/bin/env bash
set -euo pipefail

: "${RUNNER_TEMP:?RUNNER_TEMP is required.}"

if [[ "$(uname -m)" != "x86_64" ]]; then
  echo "The pinned deployment tool bundle supports x86_64 runners only." >&2
  exit 1
fi

signal_tools_root="${RUNNER_TEMP}/signal-deploy-tools"
signal_tools_bin="${signal_tools_root}/bin"
mkdir -p "$signal_tools_bin"

signal_kubectl_version="v1.33.5"
signal_kubectl_sha256="6a12d6c39e4a611a3687ee24d8c733961bb4bae1ae975f5204400c0a6930c6fc"
signal_kubectl_path="${signal_tools_bin}/kubectl"
if [[ ! -x "$signal_kubectl_path" ]]; then
  curl --fail --location --proto '=https' --tlsv1.2 \
    --output "$signal_kubectl_path" \
    "https://dl.k8s.io/release/${signal_kubectl_version}/bin/linux/amd64/kubectl"
  printf '%s  %s\n' "$signal_kubectl_sha256" "$signal_kubectl_path" | sha256sum --check --status
  chmod 0755 "$signal_kubectl_path"
fi

signal_aws_cli_version="2.27.41"
signal_aws_cli_sha256="15daae6cc803984064e3d4be9cfd07c4ae8ea703633c0a0b67acc6e321f706a3"
signal_aws_cli_archive="${signal_tools_root}/awscliv2.zip"
if [[ ! -x "${signal_tools_bin}/aws" ]]; then
  curl --fail --location --proto '=https' --tlsv1.2 \
    --output "$signal_aws_cli_archive" \
    "https://awscli.amazonaws.com/awscli-exe-linux-x86_64-${signal_aws_cli_version}.zip"
  printf '%s  %s\n' "$signal_aws_cli_sha256" "$signal_aws_cli_archive" | sha256sum --check --status
  unzip -q "$signal_aws_cli_archive" -d "$signal_tools_root"
  "${signal_tools_root}/aws/install" \
    --install-dir "${signal_tools_root}/aws-cli" \
    --bin-dir "$signal_tools_bin"
fi

if [[ -n "${GITHUB_PATH:-}" ]]; then
  printf '%s\n' "$signal_tools_bin" >> "$GITHUB_PATH"
fi
export PATH="${signal_tools_bin}:${PATH}"

aws --version
kubectl version --client=true
