variable "aws_region" {
  description = "AWS region that stores Signal Terraform state."
  type        = string
  default     = "us-east-2"
}

variable "project" {
  description = "Short project prefix used in globally unique state resources."
  type        = string
  default     = "signal"

  validation {
    condition     = can(regex("^[a-z][a-z0-9-]{1,20}$", var.project))
    error_message = "project must be a short DNS-safe name."
  }
}

variable "state_bucket_name" {
  description = "Optional explicit state bucket name. The default includes the AWS account and region."
  type        = string
  default     = ""

  validation {
    condition     = var.state_bucket_name == "" || can(regex("^[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]$", var.state_bucket_name))
    error_message = "state_bucket_name must be empty or a valid S3 bucket name."
  }
}

variable "state_noncurrent_version_retention_days" {
  description = "Days to retain superseded state object versions."
  type        = number
  default     = 365

  validation {
    condition     = var.state_noncurrent_version_retention_days >= 90
    error_message = "Terraform state versions must be retained for at least 90 days."
  }
}
