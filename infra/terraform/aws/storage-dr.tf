resource "aws_s3_bucket_ownership_controls" "artifacts" {
  bucket = aws_s3_bucket.artifacts.id
  rule { object_ownership = "BucketOwnerEnforced" }
}

data "aws_iam_policy_document" "artifact_bucket" {
  statement {
    sid    = "DenyInsecureTransport"
    effect = "Deny"
    principals {
      type        = "*"
      identifiers = ["*"]
    }
    actions   = ["s3:*"]
    resources = [aws_s3_bucket.artifacts.arn, "${aws_s3_bucket.artifacts.arn}/*"]
    condition {
      test     = "Bool"
      variable = "aws:SecureTransport"
      values   = ["false"]
    }
  }
}

resource "aws_s3_bucket_policy" "artifacts" {
  bucket = aws_s3_bucket.artifacts.id
  policy = data.aws_iam_policy_document.artifact_bucket.json
}

resource "aws_s3_bucket" "artifacts_dr" {
  count    = var.environment == "production" ? 1 : 0
  provider = aws.dr

  bucket = "${local.name}-artifacts-dr-${data.aws_caller_identity.current.account_id}"
}

resource "aws_s3_bucket_public_access_block" "artifacts_dr" {
  count    = var.environment == "production" ? 1 : 0
  provider = aws.dr

  bucket                  = aws_s3_bucket.artifacts_dr[0].id
  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

resource "aws_s3_bucket_ownership_controls" "artifacts_dr" {
  count    = var.environment == "production" ? 1 : 0
  provider = aws.dr

  bucket = aws_s3_bucket.artifacts_dr[0].id
  rule { object_ownership = "BucketOwnerEnforced" }
}

resource "aws_s3_bucket_versioning" "artifacts_dr" {
  count    = var.environment == "production" ? 1 : 0
  provider = aws.dr

  bucket = aws_s3_bucket.artifacts_dr[0].id
  versioning_configuration { status = "Enabled" }
}

resource "aws_s3_bucket_server_side_encryption_configuration" "artifacts_dr" {
  count    = var.environment == "production" ? 1 : 0
  provider = aws.dr

  bucket = aws_s3_bucket.artifacts_dr[0].id
  rule {
    bucket_key_enabled = true
    apply_server_side_encryption_by_default {
      sse_algorithm     = "aws:kms"
      kms_master_key_id = aws_kms_key.backup_dr.arn
    }
  }
}

data "aws_iam_policy_document" "s3_replication_assume" {
  statement {
    actions = ["sts:AssumeRole"]
    principals {
      type        = "Service"
      identifiers = ["s3.amazonaws.com"]
    }
  }
}

resource "aws_iam_role" "s3_replication" {
  count = var.environment == "production" ? 1 : 0

  name               = "${local.name}-s3-replication"
  assume_role_policy = data.aws_iam_policy_document.s3_replication_assume.json
}

resource "aws_iam_role_policy" "s3_replication" {
  count = var.environment == "production" ? 1 : 0

  name = "artifact-replication"
  role = aws_iam_role.s3_replication[0].id
  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Effect = "Allow"
        Action = [
          "s3:GetReplicationConfiguration",
          "s3:ListBucket"
        ]
        Resource = aws_s3_bucket.artifacts.arn
      },
      {
        Effect = "Allow"
        Action = [
          "s3:GetObjectVersionForReplication",
          "s3:GetObjectVersionAcl",
          "s3:GetObjectVersionTagging"
        ]
        Resource = "${aws_s3_bucket.artifacts.arn}/*"
      },
      {
        Effect = "Allow"
        Action = [
          "s3:ReplicateObject",
          "s3:ReplicateDelete",
          "s3:ReplicateTags"
        ]
        Resource = "${aws_s3_bucket.artifacts_dr[0].arn}/*"
      },
      {
        Effect   = "Allow"
        Action   = ["kms:Decrypt"]
        Resource = aws_kms_key.data.arn
      },
      {
        Effect   = "Allow"
        Action   = ["kms:Encrypt", "kms:GenerateDataKey"]
        Resource = aws_kms_key.backup_dr.arn
      }
    ]
  })
}

resource "aws_s3_bucket_replication_configuration" "artifacts" {
  count = var.environment == "production" ? 1 : 0

  bucket = aws_s3_bucket.artifacts.id
  role   = aws_iam_role.s3_replication[0].arn

  rule {
    id       = "cross-region-recovery"
    status   = "Enabled"
    priority = 1
    filter {}
    delete_marker_replication { status = "Enabled" }
    source_selection_criteria {
      sse_kms_encrypted_objects { status = "Enabled" }
    }
    destination {
      bucket        = aws_s3_bucket.artifacts_dr[0].arn
      storage_class = "STANDARD_IA"
      encryption_configuration {
        replica_kms_key_id = aws_kms_key.backup_dr.arn
      }
    }
  }

  depends_on = [
    aws_s3_bucket_versioning.artifacts,
    aws_s3_bucket_versioning.artifacts_dr,
    aws_iam_role_policy.s3_replication
  ]
}

resource "aws_backup_restore_testing_plan" "database" {
  count = var.environment == "production" ? 1 : 0

  name                = "${replace(local.name, "-", "_")}_quarterly"
  schedule_expression = "cron(0 8 1 1,4,7,10 ? *)"
  start_window_hours  = 24

  recovery_point_selection {
    algorithm             = "LATEST_WITHIN_WINDOW"
    include_vaults        = [aws_backup_vault.this.arn]
    recovery_point_types  = ["SNAPSHOT"]
    selection_window_days = 35
  }
}

resource "aws_backup_restore_testing_selection" "database" {
  count = var.environment == "production" ? 1 : 0

  name                      = "signal_database"
  restore_testing_plan_name = aws_backup_restore_testing_plan.database[0].name
  protected_resource_type   = "RDS"
  protected_resource_arns   = [aws_db_instance.postgres.arn]
  iam_role_arn              = aws_iam_role.backup.arn
  validation_window_hours   = 24

  restore_metadata_overrides = {
    DBInstanceClass     = "db.t4g.medium"
    DBSubnetGroupName   = aws_db_subnet_group.this.name
    MultiAZ             = "false"
    PubliclyAccessible  = "false"
    VpcSecurityGroupIds = jsonencode([aws_security_group.database.id])
  }

  depends_on = [aws_iam_role_policy_attachment.backup_restore]
}

data "archive_file" "restore_validator" {
  type        = "zip"
  source_file = "${path.module}/lambda/restore_validator.py"
  output_path = "${path.module}/.terraform/restore-validator.zip"
}

data "aws_iam_policy_document" "lambda_assume" {
  statement {
    actions = ["sts:AssumeRole"]
    principals {
      type        = "Service"
      identifiers = ["lambda.amazonaws.com"]
    }
  }
}

resource "aws_iam_role" "restore_validator" {
  count = var.environment == "production" ? 1 : 0

  name               = "${local.name}-restore-validator"
  assume_role_policy = data.aws_iam_policy_document.lambda_assume.json
}

data "aws_iam_policy_document" "restore_validator" {
  count = var.environment == "production" ? 1 : 0

  statement {
    sid       = "DescribeRestore"
    actions   = ["backup:DescribeRestoreJob", "backup:PutRestoreValidationResult"]
    resources = ["*"]
  }

  statement {
    sid       = "DescribeRestoredDatabase"
    actions   = ["rds:DescribeDBInstances", "rds:ListTagsForResource"]
    resources = ["*"]
  }

  statement {
    sid       = "WriteFunctionLogs"
    actions   = ["logs:CreateLogStream", "logs:PutLogEvents"]
    resources = ["${aws_cloudwatch_log_group.restore_validator[0].arn}:*"]
  }
}

resource "aws_iam_role_policy" "restore_validator" {
  count = var.environment == "production" ? 1 : 0

  name   = "validate-backup-restore"
  role   = aws_iam_role.restore_validator[0].id
  policy = data.aws_iam_policy_document.restore_validator[0].json
}

resource "aws_cloudwatch_log_group" "restore_validator" {
  count = var.environment == "production" ? 1 : 0

  name              = "/aws/lambda/${local.name}-restore-validator"
  retention_in_days = 365
}

resource "aws_lambda_function" "restore_validator" {
  count = var.environment == "production" ? 1 : 0

  function_name    = "${local.name}-restore-validator"
  role             = aws_iam_role.restore_validator[0].arn
  handler          = "restore_validator.handler"
  runtime          = "python3.13"
  architectures    = ["arm64"]
  filename         = data.archive_file.restore_validator.output_path
  source_code_hash = data.archive_file.restore_validator.output_base64sha256
  timeout          = 60
  memory_size      = 256

  depends_on = [aws_iam_role_policy.restore_validator, aws_cloudwatch_log_group.restore_validator]
}

resource "aws_cloudwatch_event_rule" "restore_validator" {
  count = var.environment == "production" ? 1 : 0

  name        = "${local.name}-restore-completed"
  description = "Validate successful Signal RDS restore tests before AWS Backup cleanup."
  event_pattern = jsonencode({
    source      = ["aws.backup"]
    detail-type = ["Restore Job State Change"]
    detail = {
      status                = ["COMPLETED"]
      resourceType          = ["RDS"]
      restoreTestingPlanArn = [aws_backup_restore_testing_plan.database[0].arn]
    }
  })
}

resource "aws_cloudwatch_event_target" "restore_validator" {
  count = var.environment == "production" ? 1 : 0

  rule = aws_cloudwatch_event_rule.restore_validator[0].name
  arn  = aws_lambda_function.restore_validator[0].arn
}

resource "aws_lambda_permission" "restore_validator" {
  count = var.environment == "production" ? 1 : 0

  statement_id  = "AllowEventBridgeRestoreValidation"
  action        = "lambda:InvokeFunction"
  function_name = aws_lambda_function.restore_validator[0].function_name
  principal     = "events.amazonaws.com"
  source_arn    = aws_cloudwatch_event_rule.restore_validator[0].arn
}
