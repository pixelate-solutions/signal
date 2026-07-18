{{- define "signal.name" -}}
{{- default .Chart.Name .Values.nameOverride | trunc 63 | trimSuffix "-" }}
{{- end }}

{{- define "signal.fullname" -}}
{{- if .Values.fullnameOverride }}
{{- .Values.fullnameOverride | trunc 63 | trimSuffix "-" }}
{{- else }}
{{- printf "%s-%s" .Release.Name (include "signal.name" .) | trunc 63 | trimSuffix "-" }}
{{- end }}
{{- end }}

{{- define "signal.labels" -}}
app.kubernetes.io/name: {{ include "signal.name" . }}
app.kubernetes.io/instance: {{ .Release.Name }}
app.kubernetes.io/version: {{ .Chart.AppVersion | quote }}
app.kubernetes.io/managed-by: {{ .Release.Service }}
app.kubernetes.io/part-of: signal
{{- end }}

{{- define "signal.serviceAccount" -}}
{{- $root := index . 0 -}}
{{- $identity := index . 1 -}}
{{- $account := index $root.Values.serviceAccounts $identity -}}
{{- if $account.name -}}
{{- $account.name -}}
{{- else -}}
{{- printf "%s-%s" (include "signal.fullname" $root) $identity -}}
{{- end -}}
{{- end }}
