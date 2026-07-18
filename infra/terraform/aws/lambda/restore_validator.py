import logging
from typing import Any

import boto3


LOGGER = logging.getLogger()
LOGGER.setLevel(logging.INFO)

BACKUP = boto3.client("backup")
RDS = boto3.client("rds")


def _database_identifier(resource_arn: str) -> str:
    marker = ":db:"
    if marker not in resource_arn:
        raise ValueError(f"Restore resource is not an RDS database ARN: {resource_arn}")
    identifier = resource_arn.split(marker, 1)[1]
    if not identifier:
        raise ValueError("Restored RDS database identifier is empty")
    return identifier


def handler(event: dict[str, Any], _context: Any) -> dict[str, str]:
    detail = event.get("detail", {})
    restore_job_id = detail.get("restoreJobId")
    if not isinstance(restore_job_id, str) or not restore_job_id:
        raise ValueError("Event does not contain detail.restoreJobId")

    try:
        restore_job = BACKUP.describe_restore_job(RestoreJobId=restore_job_id)
        resource_arn = restore_job.get("CreatedResourceArn")
        if not isinstance(resource_arn, str):
            raise ValueError("Completed restore job has no CreatedResourceArn")

        identifier = _database_identifier(resource_arn)
        instances = RDS.describe_db_instances(DBInstanceIdentifier=identifier).get("DBInstances", [])
        if len(instances) != 1:
            raise ValueError(f"Expected one restored database, found {len(instances)}")

        database = instances[0]
        checks = {
            "available": database.get("DBInstanceStatus") == "available",
            "encrypted": database.get("StorageEncrypted") is True,
            "private": database.get("PubliclyAccessible") is False,
            "postgres": database.get("Engine") == "postgres",
            "deletion_protection_off": database.get("DeletionProtection") is False,
        }
        failed = [name for name, passed in checks.items() if not passed]
        if failed:
            raise ValueError(f"Restored database failed checks: {', '.join(failed)}")

        message = (
            f"Validated {identifier}: available, encrypted, private PostgreSQL; "
            f"engine={database.get('EngineVersion')}"
        )
        BACKUP.put_restore_validation_result(
            RestoreJobId=restore_job_id,
            ValidationStatus="SUCCESSFUL",
            ValidationStatusMessage=message,
        )
        LOGGER.info(message)
        return {"status": "SUCCESSFUL", "database": identifier}
    except Exception as error:
        message = str(error)[:1024]
        BACKUP.put_restore_validation_result(
            RestoreJobId=restore_job_id,
            ValidationStatus="FAILED",
            ValidationStatusMessage=message,
        )
        LOGGER.exception("Restore validation failed")
        raise
