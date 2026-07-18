resource "aws_acm_certificate" "api" {
  count = var.domain_name == "" ? 0 : 1

  domain_name       = var.domain_name
  validation_method = "DNS"
  lifecycle { create_before_destroy = true }
  tags = { Name = "${local.name}-api" }
}

resource "aws_route53_record" "certificate_validation" {
  for_each = var.domain_name == "" ? {} : {
    for option in aws_acm_certificate.api[0].domain_validation_options : option.domain_name => {
      name   = option.resource_record_name
      record = option.resource_record_value
      type   = option.resource_record_type
    }
  }

  zone_id = var.route53_zone_id
  name    = each.value.name
  type    = each.value.type
  records = [each.value.record]
  ttl     = 60
}

resource "aws_acm_certificate_validation" "api" {
  count = var.domain_name == "" ? 0 : 1

  certificate_arn         = aws_acm_certificate.api[0].arn
  validation_record_fqdns = [for record in aws_route53_record.certificate_validation : record.fqdn]
}

resource "aws_iam_role" "external_dns" {
  count = var.route53_zone_id == "" ? 0 : 1

  name               = "${local.name}-external-dns"
  assume_role_policy = data.aws_iam_policy_document.pod_identity_assume.json
}

resource "aws_iam_role_policy" "external_dns" {
  count = var.route53_zone_id == "" ? 0 : 1

  name = "route53-records"
  role = aws_iam_role.external_dns[0].id
  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Effect   = "Allow"
        Action   = ["route53:ChangeResourceRecordSets"]
        Resource = "arn:aws:route53:::hostedzone/${var.route53_zone_id}"
      },
      {
        Effect   = "Allow"
        Action   = ["route53:ListHostedZones", "route53:ListResourceRecordSets", "route53:ListTagsForResource"]
        Resource = "*"
      }
    ]
  })
}

resource "aws_eks_pod_identity_association" "external_dns" {
  count = var.route53_zone_id == "" ? 0 : 1

  cluster_name    = aws_eks_cluster.this.name
  namespace       = var.external_dns_namespace
  service_account = var.external_dns_service_account_name
  role_arn        = aws_iam_role.external_dns[0].arn

  depends_on = [aws_eks_addon.core]
}

resource "aws_cloudwatch_log_group" "waf" {
  name              = "aws-waf-logs-${local.name}"
  retention_in_days = var.environment == "production" ? 365 : 30
}

resource "aws_wafv2_web_acl_logging_configuration" "edge" {
  resource_arn            = aws_wafv2_web_acl.edge.arn
  log_destination_configs = [aws_cloudwatch_log_group.waf.arn]

  redacted_fields {
    single_header { name = "authorization" }
  }
  redacted_fields {
    single_header { name = "cookie" }
  }
}
