#!/usr/bin/env bash
set -euo pipefail

namespace="${SIGNAL_NAMESPACE:-signal}"
job_name="signal-database-migrate"
runtime_secret="${SIGNAL_RUNTIME_SECRET:?SIGNAL_RUNTIME_SECRET is required}"
image="${SIGNAL_API_IMAGE:?SIGNAL_API_IMAGE is required}"

kubectl create namespace "$namespace" --dry-run=client --output=yaml | kubectl apply --filename=-
kubectl --namespace "$namespace" get secret "$runtime_secret" >/dev/null
kubectl --namespace "$namespace" create serviceaccount signal-restricted \
  --dry-run=client \
  --output=yaml | kubectl apply --filename=-
kubectl --namespace "$namespace" delete job "$job_name" --ignore-not-found --wait=true
manifest="$({
  kubectl --namespace "$namespace" create job "$job_name" \
    --image "$image" \
    --dry-run=client \
    --output=json \
    -- node node_modules/@signal/database/dist/migrate.js
})"
patched="$(jq --arg secret "$runtime_secret" '
  .spec.backoffLimit = 1 |
  .spec.ttlSecondsAfterFinished = 86400 |
  .metadata.labels["app.kubernetes.io/part-of"] = "signal" |
  .metadata.labels["app.kubernetes.io/component"] = "migration" |
  .spec.template.metadata.labels["app.kubernetes.io/part-of"] = "signal" |
  .spec.template.metadata.labels["app.kubernetes.io/component"] = "migration" |
  .spec.template.spec.serviceAccountName = "signal-restricted" |
  .spec.template.spec.automountServiceAccountToken = false |
  .spec.template.spec.nodeSelector = {"signal.pixelate.dev/pool":"core"} |
  .spec.template.spec.securityContext = {runAsNonRoot:true,runAsUser:10001,runAsGroup:10001,seccompProfile:{type:"RuntimeDefault"}} |
  .spec.template.spec.containers[0].env = [{name:"DATABASE_URL",valueFrom:{secretKeyRef:{name:$secret,key:"DATABASE_URL"}}}] |
  .spec.template.spec.containers[0].resources = {requests:{cpu:"100m",memory:"128Mi"},limits:{cpu:"1",memory:"512Mi"}} |
  .spec.template.spec.containers[0].securityContext = {allowPrivilegeEscalation:false,readOnlyRootFilesystem:true,capabilities:{drop:["ALL"]}} |
  .spec.template.spec.containers[0].volumeMounts = [{name:"tmp",mountPath:"/tmp"}] |
  .spec.template.spec.volumes = [{name:"tmp",emptyDir:{sizeLimit:"256Mi"}}]
' <<<"$manifest")"
kubectl apply --filename=- <<<"$patched"
if ! kubectl --namespace "$namespace" wait --for=condition=complete "job/$job_name" --timeout=10m; then
  kubectl --namespace "$namespace" logs "job/$job_name" --all-containers=true
  exit 1
fi
kubectl --namespace "$namespace" logs "job/$job_name" --all-containers=true
