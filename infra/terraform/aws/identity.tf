resource "aws_kms_key" "adapter_signing" {
  description              = "Signal generated-adapter signing identity"
  key_usage                = "SIGN_VERIFY"
  customer_master_key_spec = "RSA_3072"
  deletion_window_in_days  = 30
  tags                     = { Name = "${local.name}-adapter-signing" }
}

resource "aws_kms_alias" "adapter_signing" {
  name          = "alias/${local.name}-adapter-signing"
  target_key_id = aws_kms_key.adapter_signing.key_id
}

resource "aws_secretsmanager_secret" "runtime" {
  name                    = "${local.name}/runtime"
  description             = "Commissioned Signal runtime secrets; values are populated out of band."
  kms_key_id              = aws_kms_key.data.arn
  recovery_window_in_days = var.environment == "production" ? 30 : 7
}

data "aws_iam_policy_document" "pod_identity_assume" {
  statement {
    actions = ["sts:AssumeRole", "sts:TagSession"]
    principals {
      type        = "Service"
      identifiers = ["pods.eks.amazonaws.com"]
    }
  }
}

resource "aws_iam_role" "core_workload" {
  name               = "${local.name}-core-workload"
  assume_role_policy = data.aws_iam_policy_document.pod_identity_assume.json
}

data "aws_iam_policy_document" "core_workload" {
  statement {
    sid       = "ArtifactBucketMetadata"
    actions   = ["s3:ListBucket", "s3:GetBucketLocation"]
    resources = [aws_s3_bucket.artifacts.arn]
  }

  statement {
    sid = "ArtifactObjects"
    actions = [
      "s3:GetObject",
      "s3:GetObjectVersion",
      "s3:PutObject",
      "s3:DeleteObject",
      "s3:DeleteObjectVersion"
    ]
    resources = ["${aws_s3_bucket.artifacts.arn}/*"]
  }

  statement {
    sid = "EnvelopeEncryption"
    actions = [
      "kms:Decrypt",
      "kms:Encrypt",
      "kms:GenerateDataKey",
      "kms:DescribeKey"
    ]
    resources = [aws_kms_key.data.arn]
  }

  statement {
    sid       = "AdapterSigning"
    actions   = ["kms:Sign", "kms:Verify", "kms:GetPublicKey", "kms:DescribeKey"]
    resources = [aws_kms_key.adapter_signing.arn]
  }

  statement {
    sid       = "RuntimeSecretRead"
    actions   = ["secretsmanager:GetSecretValue", "secretsmanager:DescribeSecret"]
    resources = [aws_secretsmanager_secret.runtime.arn]
  }

  statement {
    sid       = "InvitationDelivery"
    actions   = ["ses:SendEmail", "ses:SendRawEmail"]
    resources = ["*"]
  }
}

resource "aws_iam_role_policy" "core_workload" {
  name   = "signal-runtime"
  role   = aws_iam_role.core_workload.id
  policy = data.aws_iam_policy_document.core_workload.json
}

resource "aws_eks_pod_identity_association" "core" {
  cluster_name    = aws_eks_cluster.this.name
  namespace       = var.kubernetes_namespace
  service_account = var.core_service_account_name
  role_arn        = aws_iam_role.core_workload.arn

  depends_on = [aws_eks_addon.core]
}

resource "aws_iam_role" "external_secrets" {
  name               = "${local.name}-external-secrets"
  assume_role_policy = data.aws_iam_policy_document.pod_identity_assume.json
}

data "aws_iam_policy_document" "external_secrets" {
  statement {
    sid = "ReadSignalRuntimeSecret"
    actions = [
      "secretsmanager:DescribeSecret",
      "secretsmanager:GetResourcePolicy",
      "secretsmanager:GetSecretValue",
      "secretsmanager:ListSecretVersionIds"
    ]
    resources = [aws_secretsmanager_secret.runtime.arn]
  }

  statement {
    sid       = "DecryptSignalRuntimeSecret"
    actions   = ["kms:Decrypt"]
    resources = [aws_kms_key.data.arn]
    condition {
      test     = "StringEquals"
      variable = "kms:ViaService"
      values   = ["secretsmanager.${var.aws_region}.amazonaws.com"]
    }
  }
}

resource "aws_iam_role_policy" "external_secrets" {
  name   = "read-signal-runtime-secret"
  role   = aws_iam_role.external_secrets.id
  policy = data.aws_iam_policy_document.external_secrets.json
}

resource "aws_eks_pod_identity_association" "external_secrets" {
  cluster_name    = aws_eks_cluster.this.name
  namespace       = var.external_secrets_namespace
  service_account = var.external_secrets_service_account_name
  role_arn        = aws_iam_role.external_secrets.arn

  depends_on = [aws_eks_addon.core, aws_iam_role_policy.external_secrets]
}

data "aws_iam_policy_document" "github_deploy_assume" {
  count = var.github_oidc_provider_arn == "" ? 0 : 1

  statement {
    actions = ["sts:AssumeRoleWithWebIdentity"]
    principals {
      type        = "Federated"
      identifiers = [var.github_oidc_provider_arn]
    }
    condition {
      test     = "StringEquals"
      variable = "token.actions.githubusercontent.com:aud"
      values   = ["sts.amazonaws.com"]
    }
    condition {
      test     = "StringLike"
      variable = "token.actions.githubusercontent.com:sub"
      values = [
        "repo:${var.github_repository}:environment:staging-core",
        "repo:${var.github_repository}:environment:production-core"
      ]
    }
  }
}

resource "aws_iam_role" "github_deploy" {
  count = var.github_oidc_provider_arn == "" ? 0 : 1

  name               = "${local.name}-github-deploy"
  assume_role_policy = data.aws_iam_policy_document.github_deploy_assume[0].json
}

resource "aws_iam_role_policy" "github_deploy" {
  count = var.github_oidc_provider_arn == "" ? 0 : 1

  name = "eks-deploy"
  role = aws_iam_role.github_deploy[0].id
  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect   = "Allow"
      Action   = ["eks:DescribeCluster"]
      Resource = aws_eks_cluster.this.arn
    }]
  })
}

resource "aws_eks_access_entry" "github_deploy" {
  count = var.github_oidc_provider_arn == "" ? 0 : 1

  cluster_name  = aws_eks_cluster.this.name
  principal_arn = aws_iam_role.github_deploy[0].arn
  type          = "STANDARD"
}

resource "aws_eks_access_policy_association" "github_deploy" {
  count = var.github_oidc_provider_arn == "" ? 0 : 1

  cluster_name  = aws_eks_cluster.this.name
  principal_arn = aws_iam_role.github_deploy[0].arn
  policy_arn    = "arn:aws:eks::aws:cluster-access-policy/AmazonEKSAdminPolicy"
  access_scope { type = "cluster" }

  depends_on = [aws_eks_access_entry.github_deploy]
}

resource "aws_eks_access_entry" "platform_admin" {
  for_each = var.platform_admin_role_arns

  cluster_name  = aws_eks_cluster.this.name
  principal_arn = each.value
  type          = "STANDARD"
}

resource "aws_eks_access_policy_association" "platform_admin" {
  for_each = var.platform_admin_role_arns

  cluster_name  = aws_eks_cluster.this.name
  principal_arn = each.value
  policy_arn    = "arn:aws:eks::aws:cluster-access-policy/AmazonEKSClusterAdminPolicy"
  access_scope { type = "cluster" }

  depends_on = [aws_eks_access_entry.platform_admin]
}
