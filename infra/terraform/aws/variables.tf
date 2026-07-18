variable "aws_region" {
  description = "AWS region for the primary Signal deployment."
  type        = string
  default     = "us-east-2"
}

variable "dr_region" {
  description = "AWS region that receives cross-region production recovery copies."
  type        = string
  default     = "us-west-2"
}

variable "project" {
  type    = string
  default = "signal"
  validation {
    condition     = can(regex("^[a-z][a-z0-9-]{1,20}$", var.project))
    error_message = "project must be a short DNS-safe name."
  }
}

variable "environment" {
  type    = string
  default = "development"
  validation {
    condition     = contains(["development", "staging", "production"], var.environment)
    error_message = "environment must be development, staging, or production."
  }
}

variable "vpc_cidr" {
  type    = string
  default = "10.42.0.0/16"
}

variable "eks_version" {
  description = "Supported EKS minor version, reviewed during each environment upgrade."
  type        = string
  default     = "1.33"
}

variable "postgres_engine_version" {
  type    = string
  default = "17.6"
}

variable "database_instance_class" {
  type    = string
  default = "db.r7g.large"
}

variable "database_allocated_storage_gib" {
  type    = number
  default = 100
}

variable "redis_node_type" {
  type    = string
  default = "cache.r7g.large"
}

variable "cluster_public_access_cidrs" {
  description = "Temporary administrative CIDRs. Production should normally use private access only."
  type        = list(string)
  default     = []
}

variable "alarm_topic_arn" {
  description = "Optional SNS topic for platform alarms."
  type        = string
  default     = ""
}

variable "domain_name" {
  description = "Public API hostname. Leave empty only for non-commissioned development stacks."
  type        = string
  default     = ""
  validation {
    condition     = var.domain_name == "" || can(regex("^[a-z0-9][a-z0-9.-]+[a-z0-9]$", var.domain_name))
    error_message = "domain_name must be an empty string or a valid lowercase DNS hostname."
  }
}

variable "route53_zone_id" {
  description = "Route 53 hosted zone used for ACM DNS validation and ExternalDNS."
  type        = string
  default     = ""
}

variable "kubernetes_namespace" {
  type    = string
  default = "signal"
}

variable "core_service_account_name" {
  description = "Kubernetes service account used by Signal core workloads."
  type        = string
  default     = "signal-core"
}

variable "external_dns_service_account_name" {
  type    = string
  default = "external-dns"
}

variable "external_dns_namespace" {
  type    = string
  default = "kube-system"
}

variable "load_balancer_controller_service_account_name" {
  type    = string
  default = "aws-load-balancer-controller"
}

variable "cluster_autoscaler_service_account_name" {
  type    = string
  default = "cluster-autoscaler"
}

variable "external_secrets_service_account_name" {
  type    = string
  default = "external-secrets"
}

variable "external_secrets_namespace" {
  type    = string
  default = "external-secrets"
}

variable "observability_service_account_name" {
  description = "Kubernetes service account used by the in-cluster OpenTelemetry collector."
  type        = string
  default     = "signal-observability"
}

variable "github_oidc_provider_arn" {
  description = "Existing GitHub Actions OIDC provider ARN. When supplied, Terraform creates a least-privilege deployment role."
  type        = string
  default     = ""
}

variable "github_repository" {
  type    = string
  default = "pixelate-solutions/signal"
}

variable "platform_admin_role_arns" {
  description = "IAM role ARNs granted EKS cluster-admin access for break-glass commissioning."
  type        = set(string)
  default     = []
}

check "dns_inputs_are_paired" {
  assert {
    condition     = (var.domain_name == "") == (var.route53_zone_id == "")
    error_message = "domain_name and route53_zone_id must either both be set or both be empty."
  }
}

check "production_has_cluster_access" {
  assert {
    condition = var.environment != "production" || (
      length(var.platform_admin_role_arns) > 0 || var.github_oidc_provider_arn != ""
    )
    error_message = "Production requires a platform admin role or GitHub deployment role for EKS access."
  }
}

variable "tags" {
  type    = map(string)
  default = {}
}
