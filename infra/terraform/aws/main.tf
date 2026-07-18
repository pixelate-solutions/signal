data "aws_availability_zones" "available" {
  state = "available"
}

data "aws_caller_identity" "current" {}

check "distinct_recovery_region" {
  assert {
    condition     = var.dr_region != var.aws_region
    error_message = "dr_region must differ from aws_region."
  }
}

locals {
  name = "${var.project}-${var.environment}"
  azs  = slice(data.aws_availability_zones.available.names, 0, 3)
  tags = merge({
    Application        = "Signal"
    Environment        = var.environment
    ManagedBy          = "Terraform"
    DataClassification = "confidential"
  }, var.tags)

  node_pools = {
    core = {
      instance_types = ["m7i.large"]
      min_size       = 3
      desired_size   = 3
      max_size       = 20
      labels         = { "signal.pixelate.dev/pool" = "core" }
      taints         = []
    }
    browser = {
      instance_types = ["m7i.xlarge"]
      min_size       = 2
      desired_size   = 2
      max_size       = 20
      labels         = { "signal.pixelate.dev/pool" = "browser" }
      taints         = [{ key = "signal.pixelate.dev/browser", value = "true", effect = "NO_SCHEDULE" }]
    }
    document = {
      instance_types = ["r7i.xlarge"]
      min_size       = 2
      desired_size   = 2
      max_size       = 20
      labels         = { "signal.pixelate.dev/pool" = "document" }
      taints         = [{ key = "signal.pixelate.dev/document", value = "true", effect = "NO_SCHEDULE" }]
    }
    sandbox = {
      instance_types = ["m7i.xlarge"]
      min_size       = 2
      desired_size   = 2
      max_size       = 30
      labels         = { "signal.pixelate.dev/pool" = "sandbox", "signal.pixelate.dev/isolation" = "required" }
      taints         = [{ key = "signal.pixelate.dev/sandbox", value = "true", effect = "NO_SCHEDULE" }]
    }
  }
}

resource "aws_vpc" "this" {
  cidr_block           = var.vpc_cidr
  enable_dns_support   = true
  enable_dns_hostnames = true
  tags                 = { Name = local.name }
}

resource "aws_internet_gateway" "this" {
  vpc_id = aws_vpc.this.id
  tags   = { Name = local.name }
}

resource "aws_subnet" "public" {
  for_each = { for index, az in local.azs : az => index }

  vpc_id                  = aws_vpc.this.id
  availability_zone       = each.key
  cidr_block              = cidrsubnet(var.vpc_cidr, 4, each.value)
  map_public_ip_on_launch = false
  tags = {
    Name                     = "${local.name}-public-${each.key}"
    "kubernetes.io/role/elb" = "1"
  }
}

resource "aws_subnet" "private" {
  for_each = { for index, az in local.azs : az => index }

  vpc_id            = aws_vpc.this.id
  availability_zone = each.key
  cidr_block        = cidrsubnet(var.vpc_cidr, 4, each.value + 8)
  tags = {
    Name                              = "${local.name}-private-${each.key}"
    "kubernetes.io/role/internal-elb" = "1"
  }
}

resource "aws_eip" "nat" {
  for_each = aws_subnet.public
  domain   = "vpc"
  tags     = { Name = "${local.name}-nat-${each.key}" }

  depends_on = [aws_internet_gateway.this]
}

resource "aws_nat_gateway" "this" {
  for_each      = aws_subnet.public
  allocation_id = aws_eip.nat[each.key].id
  subnet_id     = each.value.id
  tags          = { Name = "${local.name}-${each.key}" }
}

resource "aws_route_table" "public" {
  vpc_id = aws_vpc.this.id
  route {
    cidr_block = "0.0.0.0/0"
    gateway_id = aws_internet_gateway.this.id
  }
  tags = { Name = "${local.name}-public" }
}

resource "aws_route_table_association" "public" {
  for_each       = aws_subnet.public
  subnet_id      = each.value.id
  route_table_id = aws_route_table.public.id
}

resource "aws_route_table" "private" {
  for_each = aws_subnet.private
  vpc_id   = aws_vpc.this.id
  route {
    cidr_block     = "0.0.0.0/0"
    nat_gateway_id = aws_nat_gateway.this[each.key].id
  }
  tags = { Name = "${local.name}-private-${each.key}" }
}

resource "aws_route_table_association" "private" {
  for_each       = aws_subnet.private
  subnet_id      = each.value.id
  route_table_id = aws_route_table.private[each.key].id
}

resource "aws_flow_log" "vpc" {
  iam_role_arn    = aws_iam_role.flow_logs.arn
  log_destination = aws_cloudwatch_log_group.flow_logs.arn
  traffic_type    = "ALL"
  vpc_id          = aws_vpc.this.id
}

resource "aws_cloudwatch_log_group" "flow_logs" {
  name              = "/aws/vpc/${local.name}"
  retention_in_days = var.environment == "production" ? 365 : 30
  kms_key_id        = aws_kms_key.logs.arn
}

data "aws_iam_policy_document" "flow_logs_assume" {
  statement {
    actions = ["sts:AssumeRole"]
    principals {
      type        = "Service"
      identifiers = ["vpc-flow-logs.amazonaws.com"]
    }
  }
}

resource "aws_iam_role" "flow_logs" {
  name               = "${local.name}-flow-logs"
  assume_role_policy = data.aws_iam_policy_document.flow_logs_assume.json
}

resource "aws_iam_role_policy" "flow_logs" {
  role = aws_iam_role.flow_logs.id
  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect   = "Allow"
      Action   = ["logs:CreateLogStream", "logs:PutLogEvents", "logs:DescribeLogGroups", "logs:DescribeLogStreams"]
      Resource = "${aws_cloudwatch_log_group.flow_logs.arn}:*"
    }]
  })
}

resource "aws_kms_key" "data" {
  description             = "Signal application data encryption"
  deletion_window_in_days = 30
  enable_key_rotation     = true
  multi_region            = var.environment == "production"
  tags                    = { Name = "${local.name}-data" }
}

resource "aws_kms_alias" "data" {
  name          = "alias/${local.name}-data"
  target_key_id = aws_kms_key.data.key_id
}

resource "aws_kms_key" "logs" {
  description             = "Signal log encryption"
  deletion_window_in_days = 30
  enable_key_rotation     = true
  tags                    = { Name = "${local.name}-logs" }
}

resource "aws_ebs_encryption_by_default" "this" {
  enabled = true
}

resource "aws_ebs_default_kms_key" "this" {
  key_arn = aws_kms_key.data.arn
}

data "aws_iam_policy_document" "eks_cluster_assume" {
  statement {
    actions = ["sts:AssumeRole"]
    principals {
      type        = "Service"
      identifiers = ["eks.amazonaws.com"]
    }
  }
}

resource "aws_iam_role" "eks_cluster" {
  name               = "${local.name}-eks-cluster"
  assume_role_policy = data.aws_iam_policy_document.eks_cluster_assume.json
}

resource "aws_iam_role_policy_attachment" "eks_cluster" {
  role       = aws_iam_role.eks_cluster.name
  policy_arn = "arn:aws:iam::aws:policy/AmazonEKSClusterPolicy"
}

resource "aws_cloudwatch_log_group" "eks" {
  name              = "/aws/eks/${local.name}/cluster"
  retention_in_days = var.environment == "production" ? 365 : 30
  kms_key_id        = aws_kms_key.logs.arn
}

resource "aws_eks_cluster" "this" {
  name     = local.name
  role_arn = aws_iam_role.eks_cluster.arn
  version  = var.eks_version

  access_config {
    authentication_mode                         = "API_AND_CONFIG_MAP"
    bootstrap_cluster_creator_admin_permissions = false
  }

  encryption_config {
    provider { key_arn = aws_kms_key.data.arn }
    resources = ["secrets"]
  }

  enabled_cluster_log_types = ["api", "audit", "authenticator", "controllerManager", "scheduler"]

  vpc_config {
    subnet_ids              = values(aws_subnet.private)[*].id
    endpoint_private_access = true
    endpoint_public_access  = length(var.cluster_public_access_cidrs) > 0
    public_access_cidrs     = length(var.cluster_public_access_cidrs) > 0 ? var.cluster_public_access_cidrs : ["127.0.0.1/32"]
  }

  depends_on = [aws_iam_role_policy_attachment.eks_cluster, aws_cloudwatch_log_group.eks]
}

data "aws_iam_policy_document" "eks_nodes_assume" {
  statement {
    actions = ["sts:AssumeRole"]
    principals {
      type        = "Service"
      identifiers = ["ec2.amazonaws.com"]
    }
  }
}

resource "aws_iam_role" "eks_nodes" {
  name               = "${local.name}-eks-nodes"
  assume_role_policy = data.aws_iam_policy_document.eks_nodes_assume.json
}

resource "aws_iam_role_policy_attachment" "eks_nodes" {
  for_each = toset([
    "arn:aws:iam::aws:policy/AmazonEKSWorkerNodePolicy",
    "arn:aws:iam::aws:policy/AmazonEC2ContainerRegistryReadOnly",
    "arn:aws:iam::aws:policy/AmazonEKS_CNI_Policy"
  ])
  role       = aws_iam_role.eks_nodes.name
  policy_arn = each.value
}

resource "aws_eks_node_group" "pool" {
  for_each = local.node_pools

  cluster_name    = aws_eks_cluster.this.name
  node_group_name = each.key
  node_role_arn   = aws_iam_role.eks_nodes.arn
  subnet_ids      = values(aws_subnet.private)[*].id
  instance_types  = each.value.instance_types
  capacity_type   = "ON_DEMAND"
  ami_type        = "BOTTLEROCKET_x86_64"
  disk_size       = 100
  labels          = each.value.labels

  scaling_config {
    min_size     = each.value.min_size
    desired_size = each.value.desired_size
    max_size     = each.value.max_size
  }

  update_config { max_unavailable_percentage = 25 }

  dynamic "taint" {
    for_each = each.value.taints
    content {
      key    = taint.value.key
      value  = taint.value.value
      effect = taint.value.effect
    }
  }

  depends_on = [aws_iam_role_policy_attachment.eks_nodes]
}

resource "aws_eks_addon" "core" {
  for_each = toset(["vpc-cni", "coredns", "kube-proxy", "aws-ebs-csi-driver", "eks-pod-identity-agent"])

  cluster_name                = aws_eks_cluster.this.name
  addon_name                  = each.value
  resolve_conflicts_on_update = "PRESERVE"
}

resource "aws_db_subnet_group" "this" {
  name       = local.name
  subnet_ids = values(aws_subnet.private)[*].id
}

resource "aws_security_group" "database" {
  name        = "${local.name}-database"
  description = "PostgreSQL from the Signal cluster only"
  vpc_id      = aws_vpc.this.id
  ingress {
    protocol        = "tcp"
    from_port       = 5432
    to_port         = 5432
    security_groups = [aws_eks_cluster.this.vpc_config[0].cluster_security_group_id]
  }
  egress {
    protocol    = "-1"
    from_port   = 0
    to_port     = 0
    cidr_blocks = ["0.0.0.0/0"]
  }
}

resource "aws_db_instance" "postgres" {
  identifier                            = local.name
  engine                                = "postgres"
  engine_version                        = var.postgres_engine_version
  instance_class                        = var.database_instance_class
  allocated_storage                     = var.database_allocated_storage_gib
  max_allocated_storage                 = var.database_allocated_storage_gib * 10
  storage_type                          = "gp3"
  storage_encrypted                     = true
  kms_key_id                            = aws_kms_key.data.arn
  db_name                               = "signal"
  username                              = "signal_admin"
  manage_master_user_password           = true
  master_user_secret_kms_key_id         = aws_kms_key.data.key_id
  db_subnet_group_name                  = aws_db_subnet_group.this.name
  vpc_security_group_ids                = [aws_security_group.database.id]
  multi_az                              = true
  publicly_accessible                   = false
  backup_retention_period               = var.environment == "production" ? 35 : 7
  copy_tags_to_snapshot                 = true
  auto_minor_version_upgrade            = true
  deletion_protection                   = var.environment == "production"
  skip_final_snapshot                   = var.environment != "production"
  final_snapshot_identifier             = var.environment == "production" ? "${local.name}-final" : null
  performance_insights_enabled          = true
  performance_insights_kms_key_id       = aws_kms_key.data.arn
  performance_insights_retention_period = 7
  monitoring_interval                   = 0
  enabled_cloudwatch_logs_exports       = ["postgresql", "upgrade"]
  apply_immediately                     = var.environment != "production"
}

resource "aws_elasticache_subnet_group" "this" {
  name       = local.name
  subnet_ids = values(aws_subnet.private)[*].id
}

resource "aws_security_group" "redis" {
  name        = "${local.name}-redis"
  description = "Redis from the Signal cluster only"
  vpc_id      = aws_vpc.this.id
  ingress {
    protocol        = "tcp"
    from_port       = 6379
    to_port         = 6379
    security_groups = [aws_eks_cluster.this.vpc_config[0].cluster_security_group_id]
  }
  egress {
    protocol    = "-1"
    from_port   = 0
    to_port     = 0
    cidr_blocks = ["0.0.0.0/0"]
  }
}

resource "aws_elasticache_replication_group" "redis" {
  replication_group_id       = local.name
  description                = "Signal non-authoritative cache and fan-out"
  engine                     = "redis"
  engine_version             = "7.1"
  node_type                  = var.redis_node_type
  num_cache_clusters         = 3
  automatic_failover_enabled = true
  multi_az_enabled           = true
  at_rest_encryption_enabled = true
  transit_encryption_enabled = true
  kms_key_id                 = aws_kms_key.data.arn
  subnet_group_name          = aws_elasticache_subnet_group.this.name
  security_group_ids         = [aws_security_group.redis.id]
  snapshot_retention_limit   = var.environment == "production" ? 14 : 3
  apply_immediately          = var.environment != "production"
}

resource "aws_s3_bucket" "artifacts" {
  bucket = "${local.name}-artifacts-${data.aws_caller_identity.current.account_id}"
}

resource "aws_s3_bucket_public_access_block" "artifacts" {
  bucket                  = aws_s3_bucket.artifacts.id
  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

resource "aws_s3_bucket_versioning" "artifacts" {
  bucket = aws_s3_bucket.artifacts.id
  versioning_configuration { status = "Enabled" }
}

resource "aws_s3_bucket_server_side_encryption_configuration" "artifacts" {
  bucket = aws_s3_bucket.artifacts.id
  rule {
    bucket_key_enabled = true
    apply_server_side_encryption_by_default {
      sse_algorithm     = "aws:kms"
      kms_master_key_id = aws_kms_key.data.arn
    }
  }
}

resource "aws_s3_bucket_lifecycle_configuration" "artifacts" {
  bucket = aws_s3_bucket.artifacts.id
  rule {
    id     = "noncurrent-retention"
    status = "Enabled"
    filter {}
    noncurrent_version_transition {
      noncurrent_days = 30
      storage_class   = "GLACIER_IR"
    }
    noncurrent_version_expiration { noncurrent_days = 365 }
    abort_incomplete_multipart_upload { days_after_initiation = 7 }
  }
}

resource "aws_ecr_repository" "service" {
  for_each             = toset(["api", "workflow-worker", "browser-worker", "sandbox-controller", "document-worker", "generated-runner"])
  name                 = "${local.name}/${each.value}"
  image_tag_mutability = "IMMUTABLE"
  encryption_configuration {
    encryption_type = "KMS"
    kms_key         = aws_kms_key.data.arn
  }
  image_scanning_configuration { scan_on_push = true }
}

resource "aws_ecr_lifecycle_policy" "service" {
  for_each   = aws_ecr_repository.service
  repository = each.value.name
  policy = jsonencode({
    rules = [{
      rulePriority = 1
      description  = "Retain the newest 50 immutable images"
      selection    = { tagStatus = "any", countType = "imageCountMoreThan", countNumber = 50 }
      action       = { type = "expire" }
    }]
  })
}

resource "aws_vpc_endpoint" "s3" {
  vpc_id            = aws_vpc.this.id
  service_name      = "com.amazonaws.${var.aws_region}.s3"
  vpc_endpoint_type = "Gateway"
  route_table_ids   = values(aws_route_table.private)[*].id
}

resource "aws_backup_vault" "this" {
  name        = local.name
  kms_key_arn = aws_kms_key.data.arn
}

resource "aws_kms_key" "backup_dr" {
  provider = aws.dr

  description             = "Signal cross-region recovery encryption"
  deletion_window_in_days = 30
  enable_key_rotation     = true
  tags                    = { Name = "${local.name}-backup-dr" }
}

resource "aws_kms_alias" "backup_dr" {
  provider = aws.dr

  name          = "alias/${local.name}-backup-dr"
  target_key_id = aws_kms_key.backup_dr.key_id
}

resource "aws_backup_vault" "dr" {
  provider = aws.dr

  name        = "${local.name}-dr"
  kms_key_arn = aws_kms_key.backup_dr.arn
}

resource "aws_backup_plan" "this" {
  name = local.name
  rule {
    rule_name         = "daily"
    target_vault_name = aws_backup_vault.this.name
    schedule          = "cron(0 5 * * ? *)"
    lifecycle {
      cold_storage_after = 30
      delete_after       = var.environment == "production" ? 365 : 120
    }
    copy_action {
      destination_vault_arn = aws_backup_vault.dr.arn
      lifecycle { delete_after = var.environment == "production" ? 365 : 120 }
    }
  }
}

data "aws_iam_policy_document" "backup_assume" {
  statement {
    actions = ["sts:AssumeRole"]
    principals {
      type        = "Service"
      identifiers = ["backup.amazonaws.com"]
    }
  }
}

resource "aws_iam_role" "backup" {
  name               = "${local.name}-backup"
  assume_role_policy = data.aws_iam_policy_document.backup_assume.json
}

resource "aws_iam_role_policy_attachment" "backup" {
  role       = aws_iam_role.backup.name
  policy_arn = "arn:aws:iam::aws:policy/service-role/AWSBackupServiceRolePolicyForBackup"
}

resource "aws_backup_selection" "database" {
  name         = "${local.name}-database"
  iam_role_arn = aws_iam_role.backup.arn
  plan_id      = aws_backup_plan.this.id
  resources    = [aws_db_instance.postgres.arn]
}

resource "aws_wafv2_web_acl" "edge" {
  name  = local.name
  scope = "REGIONAL"
  default_action {
    allow {}
  }
  visibility_config {
    cloudwatch_metrics_enabled = true
    metric_name                = local.name
    sampled_requests_enabled   = true
  }
  rule {
    name     = "AWSManagedRulesCommonRuleSet"
    priority = 1
    override_action {
      none {}
    }
    statement {
      managed_rule_group_statement {
        name        = "AWSManagedRulesCommonRuleSet"
        vendor_name = "AWS"
      }
    }
    visibility_config {
      cloudwatch_metrics_enabled = true
      metric_name                = "${local.name}-common"
      sampled_requests_enabled   = true
    }
  }
}

resource "aws_cloudwatch_metric_alarm" "database_cpu" {
  alarm_name          = "${local.name}-database-cpu"
  comparison_operator = "GreaterThanThreshold"
  evaluation_periods  = 3
  metric_name         = "CPUUtilization"
  namespace           = "AWS/RDS"
  period              = 300
  statistic           = "Average"
  threshold           = 80
  alarm_description   = "Signal PostgreSQL sustained CPU is high."
  alarm_actions       = var.alarm_topic_arn == "" ? [] : [var.alarm_topic_arn]
  dimensions          = { DBInstanceIdentifier = aws_db_instance.postgres.id }
}
