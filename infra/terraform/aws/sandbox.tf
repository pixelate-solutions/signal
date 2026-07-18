data "aws_iam_policy_document" "fargate_pod_execution_assume" {
  statement {
    actions = ["sts:AssumeRole"]
    principals {
      type        = "Service"
      identifiers = ["eks-fargate-pods.amazonaws.com"]
    }
  }
}

resource "aws_iam_role" "fargate_execution" {
  name               = "${local.name}-fargate"
  assume_role_policy = data.aws_iam_policy_document.fargate_pod_execution_assume.json
}

resource "aws_iam_role_policy_attachment" "fargate_execution" {
  role       = aws_iam_role.fargate_execution.name
  policy_arn = "arn:aws:iam::aws:policy/AmazonEKSFargatePodExecutionRolePolicy"
}

resource "aws_cloudwatch_log_group" "fargate" {
  name              = "/aws/eks/${local.name}/fargate/isolated"
  retention_in_days = var.environment == "production" ? 365 : 30
  kms_key_id        = aws_kms_key.logs.arn
}

data "aws_iam_policy_document" "fargate_logs" {
  statement {
    actions   = ["logs:CreateLogStream", "logs:DescribeLogStreams", "logs:PutLogEvents"]
    resources = ["${aws_cloudwatch_log_group.fargate.arn}:*"]
  }
}

resource "aws_iam_role_policy" "fargate_logs" {
  name   = "isolated-workload-logs"
  role   = aws_iam_role.fargate_execution.id
  policy = data.aws_iam_policy_document.fargate_logs.json
}

resource "aws_eks_fargate_profile" "sandbox_runner" {
  cluster_name           = aws_eks_cluster.this.name
  fargate_profile_name   = "sandbox-runner"
  pod_execution_role_arn = aws_iam_role.fargate_execution.arn
  subnet_ids             = values(aws_subnet.private)[*].id

  selector {
    namespace = var.kubernetes_namespace
    labels = {
      "app.kubernetes.io/component" = "sandbox-runner"
    }
  }

  depends_on = [
    aws_iam_role_policy_attachment.fargate_execution,
    aws_iam_role_policy.fargate_logs
  ]
}

resource "aws_eks_fargate_profile" "deploy_runners" {
  cluster_name           = aws_eks_cluster.this.name
  fargate_profile_name   = "github-deploy-runners"
  pod_execution_role_arn = aws_iam_role.fargate_execution.arn
  subnet_ids             = values(aws_subnet.private)[*].id

  selector {
    namespace = "arc-runners"
    labels = {
      "signal.pixelate.dev/component" = "deploy-runner"
    }
  }

  depends_on = [
    aws_iam_role_policy_attachment.fargate_execution,
    aws_iam_role_policy.fargate_logs
  ]
}
