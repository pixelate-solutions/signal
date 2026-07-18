from __future__ import annotations

from typing import Annotated, Any, Literal

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


class ReplaceTextOperation(StrictModel):
    type: Literal["replace_text"]
    find: str = Field(min_length=1, max_length=100_000)
    replacement: str = Field(max_length=100_000)
    replace_all: bool = True


class AppendParagraphOperation(StrictModel):
    type: Literal["append_paragraph"]
    text: str = Field(min_length=1, max_length=100_000)


class SetCellOperation(StrictModel):
    type: Literal["set_cell"]
    sheet: str = Field(min_length=1, max_length=255)
    cell: str = Field(pattern=r"^[A-Z]{1,3}[1-9][0-9]{0,6}$")
    value: str | int | float | bool | None


class AppendRowOperation(StrictModel):
    type: Literal["append_row"]
    sheet: str = Field(min_length=1, max_length=255)
    values: list[str | int | float | bool | None] = Field(max_length=16_384)


class AddSlideOperation(StrictModel):
    type: Literal["add_slide"]
    title: str = Field(min_length=1, max_length=300)
    body: str = Field(max_length=100_000)


EditOperation = Annotated[
    ReplaceTextOperation
    | AppendParagraphOperation
    | SetCellOperation
    | AppendRowOperation
    | AddSlideOperation,
    Field(discriminator="type"),
]


class EditRequest(StrictModel):
    artifact_id: str = Field(min_length=8, max_length=96)
    file_name: str = Field(min_length=1, max_length=1024)
    mime_type: str = Field(min_length=1, max_length=255)
    checksum: str = Field(pattern=r"^sha256:[a-f0-9]{64}$")
    bytes_base64: str = Field(min_length=1)
    output_file_name: str = Field(min_length=1, max_length=1024)
    operations: list[EditOperation] = Field(min_length=1, max_length=1_000)
