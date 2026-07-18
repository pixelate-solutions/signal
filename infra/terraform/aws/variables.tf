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

variable "tags" {
  type    = map(string)
  default = {}
}
