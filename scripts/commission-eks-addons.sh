#!/usr/bin/env bash
set -euo pipefail

for signal_command in aws kubectl helm; do
  if ! command -v "$signal_command" >/dev/null 2>&1; then
    echo "Missing required command: $signal_command" >&2
    exit 1
  fi
done

: "${SIGNAL_CLUSTER_NAME:?Set SIGNAL_CLUSTER_NAME to the Terraform cluster_name output.}"
: "${SIGNAL_AWS_REGION:?Set SIGNAL_AWS_REGION to the cluster AWS region.}"
: "${SIGNAL_VPC_ID:?Set SIGNAL_VPC_ID to the Terraform VPC id.}"
: "${SIGNAL_RUNTIME_SECRET_ARN:?Set SIGNAL_RUNTIME_SECRET_ARN to the Terraform runtime_secret_arn output.}"
: "${SIGNAL_RUNTIME_K8S_SECRET:?Set SIGNAL_RUNTIME_K8S_SECRET to the Helm existingSecret value.}"
: "${SIGNAL_FARGATE_LOG_GROUP:?Set SIGNAL_FARGATE_LOG_GROUP to the Terraform fargate_log_group output.}"
: "${SIGNAL_ENVIRONMENT:?Set SIGNAL_ENVIRONMENT to development, staging, or production.}"

if [[ ! "$SIGNAL_ENVIRONMENT" =~ ^(development|staging|production)$ ]]; then
  echo "SIGNAL_ENVIRONMENT must be development, staging, or production." >&2
  exit 1
fi
signal_github_repository_url="${SIGNAL_GITHUB_REPOSITORY_URL:-https://github.com/pixelate-solutions/signal}"
if [[ ! "$signal_github_repository_url" =~ ^https://github\.com/[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+$ ]]; then
  echo "SIGNAL_GITHUB_REPOSITORY_URL must identify one GitHub repository over HTTPS." >&2
  exit 1
fi

signal_lbc_chart_version="1.14.0"
signal_external_dns_chart_version="1.20.0"
signal_autoscaler_chart_version="9.58.0"
signal_autoscaler_image_version="v1.33.5"
signal_external_secrets_chart_version="2.7.0"
signal_arc_chart_version="0.14.0"
signal_arc_controller_sha256="c8c22e5db71baa3b29c72a4b489d65d18288e093a4bb622db21ea6cfd2b74101"
signal_arc_runner_sha256="26fd1085c70eba7d9f68ca2f7ffddb4fe082b9fc5d96aa309ec30481badc1412"
signal_app_namespace="${SIGNAL_KUBERNETES_NAMESPACE:-signal}"
signal_arc_controller_namespace="arc-systems"
signal_arc_runner_namespace="arc-runners"
signal_arc_runner_name="signal-deploy-${SIGNAL_ENVIRONMENT}"
signal_repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
signal_arc_temp_dir="$(mktemp -d "${TMPDIR:-/tmp}/signal-arc.XXXXXX")"
trap 'rm -rf "$signal_arc_temp_dir"' EXIT

signal_verify_sha256() {
  local signal_expected="$1"
  local signal_file="$2"
  local signal_actual
  if command -v sha256sum >/dev/null 2>&1; then
    signal_actual="$(sha256sum "$signal_file" | awk '{print $1}')"
  elif command -v shasum >/dev/null 2>&1; then
    signal_actual="$(shasum -a 256 "$signal_file" | awk '{print $1}')"
  else
    echo "A SHA-256 utility (sha256sum or shasum) is required." >&2
    exit 1
  fi
  if [[ "$signal_actual" != "$signal_expected" ]]; then
    echo "Checksum mismatch for ${signal_file}." >&2
    exit 1
  fi
}

aws eks update-kubeconfig --name "$SIGNAL_CLUSTER_NAME" --region "$SIGNAL_AWS_REGION"
kubectl wait --for=condition=Ready nodes --all --timeout=15m

for signal_service_account in aws-load-balancer-controller cluster-autoscaler; do
  kubectl create serviceaccount "$signal_service_account" \
    --namespace kube-system \
    --dry-run=client \
    --output yaml | kubectl apply -f -
done

helm repo add --force-update eks https://aws.github.io/eks-charts
helm repo add --force-update autoscaler https://kubernetes.github.io/autoscaler
helm repo add --force-update external-secrets https://charts.external-secrets.io
helm repo update eks autoscaler external-secrets

helm show crds eks/aws-load-balancer-controller \
  --version "$signal_lbc_chart_version" | kubectl apply -f -

helm upgrade --install aws-load-balancer-controller eks/aws-load-balancer-controller \
  --namespace kube-system \
  --version "$signal_lbc_chart_version" \
  --set clusterName="$SIGNAL_CLUSTER_NAME" \
  --set region="$SIGNAL_AWS_REGION" \
  --set vpcId="$SIGNAL_VPC_ID" \
  --set serviceAccount.create=false \
  --set serviceAccount.name=aws-load-balancer-controller \
  --set nodeSelector.signal\.pixelate\.dev/pool=core \
  --atomic \
  --timeout 15m

helm upgrade --install cluster-autoscaler autoscaler/cluster-autoscaler \
  --namespace kube-system \
  --version "$signal_autoscaler_chart_version" \
  --set autoDiscovery.clusterName="$SIGNAL_CLUSTER_NAME" \
  --set awsRegion="$SIGNAL_AWS_REGION" \
  --set image.tag="$signal_autoscaler_image_version" \
  --set rbac.serviceAccount.create=false \
  --set rbac.serviceAccount.name=cluster-autoscaler \
  --set extraArgs.balance-similar-node-groups=true \
  --set extraArgs.skip-nodes-with-system-pods=false \
  --set extraArgs.expander=least-waste \
  --set nodeSelector.signal\.pixelate\.dev/pool=core \
  --atomic \
  --timeout 15m

helm upgrade --install external-secrets external-secrets/external-secrets \
  --namespace external-secrets \
  --create-namespace \
  --version "$signal_external_secrets_chart_version" \
  --set installCRDs=true \
  --set leaderElect=true \
  --set replicaCount=2 \
  --set serviceAccount.create=true \
  --set serviceAccount.name=external-secrets \
  --set nodeSelector.signal\.pixelate\.dev/pool=core \
  --set webhook.nodeSelector.signal\.pixelate\.dev/pool=core \
  --set certController.nodeSelector.signal\.pixelate\.dev/pool=core \
  --atomic \
  --timeout 15m

kubectl apply -f - <<SIGNAL_FARGATE_LOGGING
apiVersion: v1
kind: Namespace
metadata:
  name: aws-observability
  labels:
    aws-observability: enabled
---
apiVersion: v1
kind: ConfigMap
metadata:
  name: aws-logging
  namespace: aws-observability
data:
  output.conf: |
    [OUTPUT]
        Name cloudwatch_logs
        Match *
        region ${SIGNAL_AWS_REGION}
        log_group_name ${SIGNAL_FARGATE_LOG_GROUP}
        log_stream_prefix fargate-
        auto_create_group false
  filters.conf: |
    [FILTER]
        Name kubernetes
        Match kube.*
        Merge_Log On
        Keep_Log Off
        K8S-Logging.Parser On
        K8S-Logging.Exclude On
  parsers.conf: |
    [PARSER]
        Name json
        Format json
        Time_Key time
        Time_Format %d/%b/%Y:%H:%M:%S %z
SIGNAL_FARGATE_LOGGING

kubectl create namespace "$signal_app_namespace" --dry-run=client --output yaml | kubectl apply -f -
kubectl apply -f - <<SIGNAL_EXTERNAL_SECRET
apiVersion: external-secrets.io/v1
kind: SecretStore
metadata:
  name: signal-runtime
  namespace: ${signal_app_namespace}
spec:
  provider:
    aws:
      service: SecretsManager
      region: ${SIGNAL_AWS_REGION}
---
apiVersion: external-secrets.io/v1
kind: ExternalSecret
metadata:
  name: signal-runtime
  namespace: ${signal_app_namespace}
spec:
  refreshInterval: 5m
  secretStoreRef:
    name: signal-runtime
    kind: SecretStore
  target:
    name: ${SIGNAL_RUNTIME_K8S_SECRET}
    creationPolicy: Owner
    deletionPolicy: Retain
  dataFrom:
    - extract:
        key: ${SIGNAL_RUNTIME_SECRET_ARN}
---
apiVersion: external-secrets.io/v1
kind: ExternalSecret
metadata:
  name: signal-ghcr-pull
  namespace: ${signal_app_namespace}
spec:
  refreshInterval: 5m
  secretStoreRef:
    name: signal-runtime
    kind: SecretStore
  target:
    name: signal-ghcr-pull
    creationPolicy: Owner
    deletionPolicy: Retain
    template:
      engineVersion: v2
      type: kubernetes.io/dockerconfigjson
      data:
        .dockerconfigjson: '{"auths":{"ghcr.io":{"username":"{{ .username }}","password":"{{ .token }}","auth":"{{ printf "%s:%s" .username .token | b64enc }}"}}}'
  data:
    - secretKey: username
      remoteRef:
        key: ${SIGNAL_RUNTIME_SECRET_ARN}
        property: GHCR_USERNAME
    - secretKey: token
      remoteRef:
        key: ${SIGNAL_RUNTIME_SECRET_ARN}
        property: GHCR_PULL_TOKEN
SIGNAL_EXTERNAL_SECRET

if [[ -n "${SIGNAL_ROUTE53_ZONE_ID:-}" ]]; then
  kubectl create serviceaccount external-dns \
    --namespace kube-system \
    --dry-run=client \
    --output yaml | kubectl apply -f -

  helm repo add --force-update external-dns https://kubernetes-sigs.github.io/external-dns/
  helm repo update external-dns
  helm upgrade --install external-dns external-dns/external-dns \
    --namespace kube-system \
    --version "$signal_external_dns_chart_version" \
    --set provider.name=aws \
    --set policy=upsert-only \
    --set registry=txt \
    --set txtOwnerId="$SIGNAL_CLUSTER_NAME" \
    --set serviceAccount.create=false \
    --set serviceAccount.name=external-dns \
    --set sources[0]=ingress \
    --set-string "extraArgs[0]=--zone-id-filter=${SIGNAL_ROUTE53_ZONE_ID}" \
    --set nodeSelector.signal\.pixelate\.dev/pool=core \
    --atomic \
    --timeout 15m
fi

kubectl rollout status deployment/aws-load-balancer-controller --namespace kube-system --timeout=10m
kubectl rollout status deployment/cluster-autoscaler-aws-cluster-autoscaler --namespace kube-system --timeout=10m
kubectl rollout status deployment/external-secrets --namespace external-secrets --timeout=10m
kubectl wait externalsecret/signal-runtime \
  --namespace "$signal_app_namespace" \
  --for=condition=Ready \
  --timeout=10m
kubectl wait externalsecret/signal-ghcr-pull \
  --namespace "$signal_app_namespace" \
  --for=condition=Ready \
  --timeout=10m

kubectl create namespace "$signal_arc_controller_namespace" --dry-run=client --output yaml | kubectl apply -f -
kubectl create namespace "$signal_arc_runner_namespace" --dry-run=client --output yaml | kubectl apply -f -
kubectl apply -f - <<SIGNAL_ARC_SECRET
apiVersion: external-secrets.io/v1
kind: SecretStore
metadata:
  name: signal-runtime
  namespace: ${signal_arc_runner_namespace}
spec:
  provider:
    aws:
      service: SecretsManager
      region: ${SIGNAL_AWS_REGION}
---
apiVersion: external-secrets.io/v1
kind: ExternalSecret
metadata:
  name: signal-github-runner-app
  namespace: ${signal_arc_runner_namespace}
spec:
  refreshInterval: 5m
  secretStoreRef:
    name: signal-runtime
    kind: SecretStore
  target:
    name: signal-github-runner-app
    creationPolicy: Owner
    deletionPolicy: Retain
  data:
    - secretKey: github_app_id
      remoteRef:
        key: ${SIGNAL_RUNTIME_SECRET_ARN}
        property: GITHUB_RUNNER_APP_ID
    - secretKey: github_app_installation_id
      remoteRef:
        key: ${SIGNAL_RUNTIME_SECRET_ARN}
        property: GITHUB_RUNNER_INSTALLATION_ID
    - secretKey: github_app_private_key
      remoteRef:
        key: ${SIGNAL_RUNTIME_SECRET_ARN}
        property: GITHUB_RUNNER_PRIVATE_KEY
SIGNAL_ARC_SECRET
kubectl wait externalsecret/signal-github-runner-app \
  --namespace "$signal_arc_runner_namespace" \
  --for=condition=Ready \
  --timeout=10m

helm pull oci://ghcr.io/actions/actions-runner-controller-charts/gha-runner-scale-set-controller \
  --version "$signal_arc_chart_version" \
  --destination "$signal_arc_temp_dir"
helm pull oci://ghcr.io/actions/actions-runner-controller-charts/gha-runner-scale-set \
  --version "$signal_arc_chart_version" \
  --destination "$signal_arc_temp_dir"
signal_verify_sha256 \
  "$signal_arc_controller_sha256" \
  "$signal_arc_temp_dir/gha-runner-scale-set-controller-${signal_arc_chart_version}.tgz"
signal_verify_sha256 \
  "$signal_arc_runner_sha256" \
  "$signal_arc_temp_dir/gha-runner-scale-set-${signal_arc_chart_version}.tgz"

helm upgrade --install arc \
  "$signal_arc_temp_dir/gha-runner-scale-set-controller-${signal_arc_chart_version}.tgz" \
  --namespace "$signal_arc_controller_namespace" \
  --values "$signal_repo_root/infra/helm/arc-controller-values.yaml" \
  --atomic \
  --timeout 15m
helm upgrade --install "$signal_arc_runner_name" \
  "$signal_arc_temp_dir/gha-runner-scale-set-${signal_arc_chart_version}.tgz" \
  --namespace "$signal_arc_runner_namespace" \
  --values "$signal_repo_root/infra/helm/arc-runner-values.yaml" \
  --set-string githubConfigUrl="$signal_github_repository_url" \
  --set-string githubConfigSecret=signal-github-runner-app \
  --set-string runnerScaleSetName="$signal_arc_runner_name" \
  --atomic \
  --timeout 15m

kubectl --namespace "$signal_arc_controller_namespace" rollout status deployment \
  --selector app.kubernetes.io/instance=arc \
  --timeout=10m
kubectl --namespace "$signal_arc_runner_namespace" get autoscalingrunnerset "$signal_arc_runner_name"
if [[ -n "${SIGNAL_ROUTE53_ZONE_ID:-}" ]]; then
  kubectl rollout status deployment/external-dns --namespace kube-system --timeout=10m
fi
kubectl top nodes

echo "EKS add-ons commissioned successfully for ${SIGNAL_CLUSTER_NAME}."
