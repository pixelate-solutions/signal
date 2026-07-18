output "cluster_name" {
  value = aws_eks_cluster.this.name
}

output "environment" {
  value = var.environment
}

output "aws_region" {
  value = var.aws_region
}

output "vpc_id" {
  value = aws_vpc.this.id
}

output "kubernetes_namespace" {
  value = var.kubernetes_namespace
}

output "domain_name" {
  value = var.domain_name
}

output "route53_zone_id" {
  value = var.route53_zone_id
}

output "cluster_endpoint" {
  value     = aws_eks_cluster.this.endpoint
  sensitive = true
}

output "artifact_bucket" {
  value = aws_s3_bucket.artifacts.id
}

output "artifact_recovery_bucket" {
  value = try(aws_s3_bucket.artifacts_dr[0].id, null)
}

output "database_endpoint" {
  value     = aws_db_instance.postgres.endpoint
  sensitive = true
}

output "database_master_secret_arn" {
  value     = try(aws_db_instance.postgres.master_user_secret[0].secret_arn, null)
  sensitive = true
}

output "redis_primary_endpoint" {
  value     = aws_elasticache_replication_group.redis.primary_endpoint_address
  sensitive = true
}

output "kms_key_arn" {
  value = aws_kms_key.data.arn
}

output "adapter_signing_kms_key_arn" {
  value = aws_kms_key.adapter_signing.arn
}

output "runtime_secret_arn" {
  value     = aws_secretsmanager_secret.runtime.arn
  sensitive = true
}

output "core_workload_role_arn" {
  value = aws_iam_role.core_workload.arn
}

output "github_deploy_role_arn" {
  value = try(aws_iam_role.github_deploy[0].arn, null)
}

output "api_certificate_arn" {
  value = try(aws_acm_certificate_validation.api[0].certificate_arn, null)
}

output "external_dns_role_arn" {
  value = try(aws_iam_role.external_dns[0].arn, null)
}

output "load_balancer_controller_role_arn" {
  value = aws_iam_role.load_balancer_controller.arn
}

output "cluster_autoscaler_role_arn" {
  value = aws_iam_role.cluster_autoscaler.arn
}

output "external_secrets_role_arn" {
  value = aws_iam_role.external_secrets.arn
}

output "ebs_csi_role_arn" {
  value = aws_iam_role.ebs_csi.arn
}

output "observability_role_arn" {
  value = aws_iam_role.observability.arn
}

output "sandbox_fargate_profile_arn" {
  value = aws_eks_fargate_profile.sandbox_runner.arn
}

output "sandbox_fargate_log_group" {
  value = aws_cloudwatch_log_group.fargate.name
}

output "fargate_log_group" {
  value = aws_cloudwatch_log_group.fargate.name
}

output "deploy_runner_fargate_profile_arn" {
  value = aws_eks_fargate_profile.deploy_runners.arn
}

output "ecr_repository_urls" {
  value = { for name, repository in aws_ecr_repository.service : name => repository.repository_url }
}

output "waf_acl_arn" {
  value = aws_wafv2_web_acl.edge.arn
}

output "recovery_vault_arn" {
  value = aws_backup_vault.dr.arn
}

output "database_restore_testing_plan_arn" {
  value = try(aws_backup_restore_testing_plan.database[0].arn, null)
}
