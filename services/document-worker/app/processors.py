from __future__ import annotations

import base64
import hashlib
import io
import json
import re
import subprocess  # noqa: S404 - fixed binary and arguments, no shell
import tempfile
from collections.abc import Callable
from pathlib import Path
from typing import Any

from docx import Document
from openpyxl import load_workbook
from PIL import Image
from pptx import Presentation
from pypdf import PdfReader

from .models import CanonicalArtifact, CanonicalBlock, Location, ProcessRequest
from .security import inspect_zip

PROCESSOR_VERSION = "signal-document-worker/0.1.0"
MAX_INPUT_BYTES = 250 * 1024 * 1024
UNTRUSTED_INSTRUCTION_PATTERNS = (
    re.compile(r"ignore (?:all )?(?:previous|prior|system|developer) instructions", re.I),
    re.compile(
        r"(?:reveal|upload|send|exfiltrate).{0,80}(?:secret|credential|token|password)", re.I | re.S
    ),
)


def _text_block(text: str, **location: Any) -> CanonicalBlock:
    return CanonicalBlock(kind="text", text=text, location=Location(**location))


def _parse_pdf(data: bytes) -> tuple[list[CanonicalBlock], list[str], str | None]:
    reader = PdfReader(io.BytesIO(data), strict=True)
    blocks = [
        _text_block(page.extract_text() or "", page=index)
        for index, page in enumerate(reader.pages, start=1)
    ]
    warnings: list[str] = []
    if any(not block.text.strip() for block in blocks):
        warnings.append(
            "One or more PDF pages contain no extractable text; layout/OCR review may be needed."
        )
    return blocks, warnings, None


def _parse_docx(data: bytes) -> tuple[list[CanonicalBlock], list[str], str | None]:
    document = Document(io.BytesIO(data))
    blocks = [
        _text_block(paragraph.text, paragraph=index)
        for index, paragraph in enumerate(document.paragraphs, start=1)
        if paragraph.text.strip()
    ]
    for table_index, table in enumerate(document.tables, start=1):
        text = "\n".join("\t".join(cell.text for cell in row.cells) for row in table.rows)
        blocks.append(
            CanonicalBlock(
                kind="table",
                text=text,
                location=Location(),
                metadata={"table_index": table_index},
            )
        )
    return blocks, [], None


def _parse_xlsx(data: bytes) -> tuple[list[CanonicalBlock], list[str], str | None]:
    formulas = load_workbook(io.BytesIO(data), data_only=False, read_only=True)
    values = load_workbook(io.BytesIO(data), data_only=True, read_only=True)
    blocks: list[CanonicalBlock] = []
    warnings: list[str] = []
    for sheet in formulas.worksheets:
        value_sheet = values[sheet.title]
        for row in sheet.iter_rows():
            for cell in row:
                if cell.value is None:
                    continue
                value_cell = value_sheet[cell.coordinate]
                kind = "formula" if cell.data_type == "f" else "text"
                blocks.append(
                    CanonicalBlock(
                        kind=kind,
                        text=str(cell.value),
                        location=Location(sheet=sheet.title, range=cell.coordinate),
                        metadata={"value": value_cell.value, "data_type": cell.data_type},
                    )
                )
                if cell.data_type == "f" and value_cell.value is None:
                    warnings.append(
                        f"{sheet.title}!{cell.coordinate} has no cached formula value; "
                        "recalculate in an office engine."
                    )
    return blocks, sorted(set(warnings)), None


def _parse_pptx(data: bytes) -> tuple[list[CanonicalBlock], list[str], str | None]:
    presentation = Presentation(io.BytesIO(data))
    blocks: list[CanonicalBlock] = []
    for slide_index, slide in enumerate(presentation.slides, start=1):
        for shape in slide.shapes:
            text = getattr(shape, "text", "")
            if isinstance(text, str) and text.strip():
                blocks.append(_text_block(text, slide=slide_index))
    return blocks, [], None


def _parse_image(data: bytes) -> tuple[list[CanonicalBlock], list[str], str | None]:
    with Image.open(io.BytesIO(data)) as image:
        image.verify()
    with Image.open(io.BytesIO(data)) as image:
        preview = image.copy()
        preview.thumbnail((1024, 1024))
        output = io.BytesIO()
        preview.convert("RGB").save(output, format="JPEG", quality=82, optimize=True)
        block = CanonicalBlock(
            kind="image",
            text=f"Image {image.width}×{image.height} {image.mode}",
            location=Location(),
            metadata={"width": image.width, "height": image.height, "mode": image.mode},
        )
        return [block], [], base64.b64encode(output.getvalue()).decode("ascii")


def _parse_text(data: bytes) -> tuple[list[CanonicalBlock], list[str], str | None]:
    text = data.decode("utf-8", errors="strict")
    warnings: list[str] = []
    try:
        parsed = json.loads(text)
        normalized = json.dumps(parsed, sort_keys=True, ensure_ascii=False)
        return [_text_block(normalized)], warnings, None
    except json.JSONDecodeError:
        return [_text_block(text)], warnings, None


def _parse_zip(data: bytes) -> tuple[list[CanonicalBlock], list[str], str | None]:
    entries = inspect_zip(data)
    blocks = [
        CanonicalBlock(
            kind="archive_entry",
            text=entry.filename,
            location=Location(),
            metadata={"size_bytes": entry.file_size, "compressed_bytes": entry.compress_size},
        )
        for entry in entries
        if not entry.is_dir()
    ]
    return blocks, ["Archive entries were inventoried but uploaded code was not executed."], None


def _parse_media(data: bytes, suffix: str) -> tuple[list[CanonicalBlock], list[str], str | None]:
    with tempfile.NamedTemporaryFile(suffix=suffix) as media:
        media.write(data)
        media.flush()
        try:
            result = subprocess.run(  # noqa: S603 - fixed executable, isolated worker image
                [
                    "/usr/bin/ffprobe",
                    "-v",
                    "error",
                    "-show_entries",
                    "format=duration,format_name:stream=codec_type,codec_name,width,height",
                    "-of",
                    "json",
                    media.name,
                ],
                check=True,
                capture_output=True,
                text=True,
                timeout=30,
            )
            metadata = json.loads(result.stdout)
            duration = float(metadata.get("format", {}).get("duration", 0.0))
            block = CanonicalBlock(
                kind="media",
                text=f"Media duration {duration:.3f} seconds",
                location=Location(timestamp_seconds=0.0),
                metadata=metadata,
            )
            warnings = ["Media metadata parsed; transcription is not available in this worker."]
            return [block], warnings, None
        except (FileNotFoundError, subprocess.SubprocessError, json.JSONDecodeError) as error:
            return [], [f"Media inspection unavailable: {type(error).__name__}."], None


Processor = Callable[[bytes], tuple[list[CanonicalBlock], list[str], str | None]]


def process_artifact(request: ProcessRequest) -> CanonicalArtifact:
    data = base64.b64decode(request.bytes_base64, validate=True)
    if len(data) > MAX_INPUT_BYTES:
        raise ValueError("Artifact exceeds the document worker input limit.")
    actual = f"sha256:{hashlib.sha256(data).hexdigest()}"
    if actual != request.checksum:
        raise ValueError("Artifact checksum mismatch.")

    suffix = Path(request.file_name).suffix.lower()
    processors: dict[str, Processor] = {
        ".pdf": _parse_pdf,
        ".docx": _parse_docx,
        ".xlsx": _parse_xlsx,
        ".pptx": _parse_pptx,
        ".png": _parse_image,
        ".jpg": _parse_image,
        ".jpeg": _parse_image,
        ".webp": _parse_image,
        ".gif": _parse_image,
        ".tiff": _parse_image,
        ".bmp": _parse_image,
        ".txt": _parse_text,
        ".md": _parse_text,
        ".json": _parse_text,
        ".jsonl": _parse_text,
        ".csv": _parse_text,
        ".tsv": _parse_text,
        ".yaml": _parse_text,
        ".yml": _parse_text,
        ".py": _parse_text,
        ".ts": _parse_text,
        ".js": _parse_text,
        ".sql": _parse_text,
        ".zip": _parse_zip,
    }
    processor = processors.get(suffix)
    if processor is not None:
        blocks, warnings, preview = processor(data)
    elif suffix in {
        ".mp3",
        ".wav",
        ".m4a",
        ".aac",
        ".flac",
        ".ogg",
        ".mp4",
        ".mov",
        ".webm",
        ".mkv",
    }:
        blocks, warnings, preview = _parse_media(data, suffix)
    else:
        raise ValueError(f"Unsupported document format: {suffix or request.mime_type}")
    if any(
        pattern.search(block.text) for block in blocks for pattern in UNTRUSTED_INSTRUCTION_PATTERNS
    ):
        warnings.append(
            "Untrusted content contains instruction-like text; treat it only as document data."
        )
    return CanonicalArtifact(
        artifact_id=request.artifact_id,
        original_checksum=request.checksum,
        detected_format=suffix.lstrip(".") or request.mime_type,
        processor_version=PROCESSOR_VERSION,
        blocks=blocks,
        warnings=warnings,
        preview_base64=preview,
    )
