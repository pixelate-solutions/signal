from __future__ import annotations

from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, Field


class StrictModel(BaseModel):
    model_config = ConfigDict(extra="forbid")


class ProcessRequest(StrictModel):
    artifact_id: str = Field(min_length=8, max_length=96)
    file_name: str = Field(min_length=1, max_length=1024)
    mime_type: str = Field(min_length=1, max_length=255)
    checksum: str = Field(pattern=r"^sha256:[a-f0-9]{64}$")
    scan_state: Literal["CLEAN"]
    bytes_base64: str = Field(min_length=1)


class Location(StrictModel):
    page: int | None = None
    slide: int | None = None
    sheet: str | None = None
    range: str | None = None
    paragraph: int | None = None
    timestamp_seconds: float | None = None


class CanonicalBlock(StrictModel):
    kind: Literal["text", "table", "image", "formula", "archive_entry", "media"]
    text: str
    location: Location
    metadata: dict[str, Any] = Field(default_factory=dict)


class CanonicalArtifact(StrictModel):
    artifact_id: str
    original_checksum: str
    detected_format: str
    processor_version: str
    blocks: list[CanonicalBlock]
    warnings: list[str]
    preview_base64: str | None = None


class GenerateRequest(StrictModel):
    format: Literal["docx", "xlsx", "pptx", "pdf", "txt"]
    title: str = Field(min_length=1, max_length=300)
    paragraphs: list[str] = Field(default_factory=list, max_length=10000)
    table: list[list[str | int | float | None]] = Field(default_factory=list, max_length=10000)


class GeneratedArtifact(StrictModel):
    file_name: str
    mime_type: str
    checksum: str
    bytes_base64: str
    preview: dict[str, Any]
    checks: list[str]
    warnings: list[str]
