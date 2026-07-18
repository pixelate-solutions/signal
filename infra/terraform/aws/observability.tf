resource "aws_cloudwatch_log_group" "application" {
  name              = "/signal/${local.name}/application"
  retention_in_days = var.environment == "production" ? 365 : 30
  kms_key_id        = aws_kms_key.logs.arn
  tags              = { Name = "${local.name}-application-telemetry" }
}

resource "aws_cloudwatch_log_group" "metrics" {
  name              = "/signal/${local.name}/metrics"
  retention_in_days = var.environment == "production" ? 365 : 30
  kms_key_id        = aws_kms_key.logs.arn
  tags              = { Name = "${local.name}-metrics" }
}

resource "aws_iam_role" "observability" {
  name               = "${local.name}-observability"
  assume_role_policy = data.aws_iam_policy_document.pod_identity_assume.json
}

resource "aws_iam_role_policy_attachment" "observability_cloudwatch" {
  role       = aws_iam_role.observability.name
  policy_arn = "arn:aws:iam::aws:policy/CloudWatchAgentServerPolicy"
}

resource "aws_iam_role_policy_attachment" "observability_xray" {
  role       = aws_iam_role.observability.name
  policy_arn = "arn:aws:iam::aws:policy/AWSXRayDaemonWriteAccess"
}

resource "aws_eks_pod_identity_association" "observability" {
  cluster_name    = aws_eks_cluster.this.name
  namespace       = var.kubernetes_namespace
  service_account = var.observability_service_account_name
  role_arn        = aws_iam_role.observability.arn

  depends_on = [
    aws_eks_addon.core,
    aws_iam_role_policy_attachment.observability_cloudwatch,
    aws_iam_role_policy_attachment.observability_xray
  ]
}
