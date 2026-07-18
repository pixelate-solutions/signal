output "state_bucket_name" {
  value = aws_s3_bucket.state.id
}

output "state_kms_key_arn" {
  value = aws_kms_key.state.arn
}

output "state_region" {
  value = var.aws_region
}

output "aws_account_id" {
  value = data.aws_caller_identity.current.account_id
}
