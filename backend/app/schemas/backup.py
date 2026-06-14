from datetime import datetime
from uuid import UUID

from pydantic import BaseModel, Field


class BackupJobCreate(BaseModel):
    name: str = Field(min_length=1, max_length=255)
    backup_type: str = Field(description="container | pot")
    pot_id: UUID
    container: str | None = Field(default=None, description="Required when backup_type is container")
    export_tar: bool = Field(default=True, description="Also docker save to a portable tar on the pot")


class BackupArtifactOut(BaseModel):
    id: UUID
    job_id: UUID
    container: str | None
    image_reference: str | None
    artifact_format: str
    storage_location: str
    agent_path: str | None
    server_path: str | None
    external_uri: str | None
    size_bytes: int | None
    sha256: str | None
    transfer_sha256: str | None
    transfer_verified_at: datetime | None
    created_at: datetime

    model_config = {"from_attributes": True}


class BackupJobOut(BaseModel):
    id: UUID
    name: str
    backup_type: str
    pot_id: UUID
    container: str | None
    status: str
    command_id: UUID | None
    ingest_command_id: UUID | None = None
    schedule_id: UUID | None
    storage_location: str = "agent"
    artifact_path: str | None
    artifact_size: int | None
    artifact_format: str | None = None
    artifact_sha256: str | None = None
    server_artifact_path: str | None = None
    ingest_status: str | None = None
    image_reference: str | None
    image_id: str | None
    detail_json: str | None
    error: str | None
    requested_by_user_id: UUID | None
    created_at: datetime
    completed_at: datetime | None
    pot_name: str | None = None
    artifacts: list[BackupArtifactOut] | None = None

    model_config = {"from_attributes": True}


class BackupScheduleCreate(BaseModel):
    name: str = Field(min_length=1, max_length=255)
    backup_type: str = Field(description="container | pot")
    pot_id: UUID
    container: str | None = None
    interval_hours: int = Field(default=24, ge=1, le=24 * 30)
    enabled: bool = True
    retention_count: int = Field(default=5, ge=1, le=100)
    export_tar: bool = True


class BackupScheduleUpdate(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=255)
    interval_hours: int | None = Field(default=None, ge=1, le=24 * 30)
    enabled: bool | None = None
    retention_count: int | None = Field(default=None, ge=1, le=100)
    export_tar: bool | None = None


class BackupScheduleOut(BaseModel):
    id: UUID
    name: str
    backup_type: str
    pot_id: UUID
    container: str | None
    interval_hours: int
    enabled: bool
    retention_count: int
    last_run_at: datetime | None
    next_run_at: datetime | None
    created_by_user_id: UUID | None
    created_at: datetime
    pot_name: str | None = None

    model_config = {"from_attributes": True}
