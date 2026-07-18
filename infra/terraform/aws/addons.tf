locals {
  load_balancer_controller_policy_path   = "${path.module}/policies/aws-load-balancer-controller-v2.14.1.json"
  load_balancer_controller_policy_sha256 = "6203c2b12b9cfad35b441b1d4d9cb70b50153fa2e402ac58cf636c7311480a56"
}

resource "aws_iam_role" "ebs_csi" {
  name               = "${local.name}-ebs-csi"
  assume_role_policy = data.aws_iam_policy_document.pod_identity_assume.json
}

resource "aws_iam_role_policy_attachment" "ebs_csi" {
  role       = aws_iam_role.ebs_csi.name
  policy_arn = "arn:aws:iam::aws:policy/service-role/AmazonEBSCSIDriverPolicy"
}

resource "aws_eks_pod_identity_association" "ebs_csi" {
  cluster_name    = aws_eks_cluster.this.name
  namespace       = "kube-system"
  service_account = "ebs-csi-controller-sa"
  role_arn        = aws_iam_role.ebs_csi.arn

  depends_on = [aws_eks_addon.core, aws_iam_role_policy_attachment.ebs_csi]
}

check "load_balancer_controller_policy_is_pinned" {
  assert {
    condition     = sha256(jsonencode(jsondecode(file(local.load_balancer_controller_policy_path)))) == local.load_balancer_controller_policy_sha256
    error_message = "The vendored AWS Load Balancer Controller IAM policy differs from the reviewed v2.14.1 policy. Review upstream changes and update the pinned checksum deliberately."
  }
}

resource "aws_iam_policy" "load_balancer_controller" {
  name        = "${local.name}-load-balancer-controller"
  description = "Reviewed upstream permissions for AWS Load Balancer Controller v2.14.1"
  policy      = file(local.load_balancer_controller_policy_path)
}

resource "aws_iam_role" "load_balancer_controller" {
  name               = "${local.name}-load-balancer-controller"
  assume_role_policy = data.aws_iam_policy_document.pod_identity_assume.json
}

resource "aws_iam_role_policy_attachment" "load_balancer_controller" {
  role       = aws_iam_role.load_balancer_controller.name
  policy_arn = aws_iam_policy.load_balancer_controller.arn
}

resource "aws_eks_pod_identity_association" "load_balancer_controller" {
  cluster_name    = aws_eks_cluster.this.name
  namespace       = "kube-system"
  service_account = var.load_balancer_controller_service_account_name
  role_arn        = aws_iam_role.load_balancer_controller.arn

  depends_on = [aws_eks_addon.core, aws_iam_role_policy_attachment.load_balancer_controller]
}

resource "aws_iam_role" "cluster_autoscaler" {
  name               = "${local.name}-cluster-autoscaler"
  assume_role_policy = data.aws_iam_policy_document.pod_identity_assume.json
}

data "aws_iam_policy_document" "cluster_autoscaler" {
  statement {
    sid = "ReadScalingState"
    actions = [
      "autoscaling:DescribeAutoScalingGroups",
      "autoscaling:DescribeAutoScalingInstances",
      "autoscaling:DescribeLaunchConfigurations",
      "autoscaling:DescribeScalingActivities",
      "autoscaling:DescribeTags",
      "ec2:DescribeImages",
      "ec2:DescribeInstanceTypes",
      "ec2:DescribeLaunchTemplateVersions",
      "ec2:GetInstanceTypesFromInstanceRequirements",
      "eks:DescribeNodegroup"
    ]
    resources = ["*"]
  }

  statement {
    sid = "ScaleTaggedSignalNodeGroups"
    actions = [
      "autoscaling:SetDesiredCapacity",
      "autoscaling:TerminateInstanceInAutoScalingGroup"
    ]
    resources = ["*"]
    condition {
      test     = "StringEquals"
      variable = "aws:ResourceTag/k8s.io/cluster-autoscaler/enabled"
      values   = ["true"]
    }
    condition {
      test     = "StringEquals"
      variable = "aws:ResourceTag/k8s.io/cluster-autoscaler/${local.name}"
      values   = ["owned"]
    }
  }
}

resource "aws_iam_role_policy" "cluster_autoscaler" {
  name   = "scale-signal-node-groups"
  role   = aws_iam_role.cluster_autoscaler.id
  policy = data.aws_iam_policy_document.cluster_autoscaler.json
}

resource "aws_eks_pod_identity_association" "cluster_autoscaler" {
  cluster_name    = aws_eks_cluster.this.name
  namespace       = "kube-system"
  service_account = var.cluster_autoscaler_service_account_name
  role_arn        = aws_iam_role.cluster_autoscaler.arn

  depends_on = [aws_eks_addon.core, aws_iam_role_policy.cluster_autoscaler]
}
