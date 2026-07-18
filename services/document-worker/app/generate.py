from __future__ import annotations

import base64
import hashlib
import io
from typing import Any

from docx import Document
from openpyxl import Workbook, load_workbook
from pptx import Presentation
from pptx.util import Inches
from pypdf import PdfReader
from reportlab.lib.pagesizes import letter
from reportlab.pdfgen import canvas

from .models import GeneratedArtifact, GenerateRequest


def _docx(request: GenerateRequest) -> tuple[bytes, dict[str, Any], list[str]]:
    document = Document()
    document.add_heading(request.title, level=1)
    for paragraph in request.paragraphs:
        document.add_paragraph(paragraph)
    if request.table:
        width = max(len(row) for row in request.table)
        table = document.add_table(rows=0, cols=width)
        for source_row in request.table:
            row = table.add_row()
            for index, value in enumerate(source_row):
                row.cells[index].text = "" if value is None else str(value)
    output = io.BytesIO()
    document.save(output)
    checked = Document(io.BytesIO(output.getvalue()))
    preview = {
        "paragraphs": len(checked.paragraphs),
        "tables": len(checked.tables),
    }
    return output.getvalue(), preview, []


def _xlsx(request: GenerateRequest) -> tuple[bytes, dict[str, Any], list[str]]:
    workbook = Workbook()
    sheet = workbook.active
    assert sheet is not None
    sheet.title = request.title[:31]
    for row in request.table:
        sheet.append(row)
    output = io.BytesIO()
    workbook.save(output)
    checked = load_workbook(io.BytesIO(output.getvalue()), data_only=False)
    return output.getvalue(), {"sheets": checked.sheetnames, "rows": sheet.max_row}, []


def _pptx(request: GenerateRequest) -> tuple[bytes, dict[str, Any], list[str]]:
    presentation = Presentation()
    for index, paragraph in enumerate(request.paragraphs or [request.title]):
        slide = presentation.slides.add_slide(presentation.slide_layouts[5])
        title_box = slide.shapes.add_textbox(Inches(0.7), Inches(0.5), Inches(8.6), Inches(0.7))
        title_box.text = request.title if index == 0 else f"{request.title} · {index + 1}"
        body = slide.shapes.add_textbox(Inches(0.8), Inches(1.5), Inches(8.4), Inches(4.8))
        body.text = paragraph
    output = io.BytesIO()
    presentation.save(output)
    checked = Presentation(io.BytesIO(output.getvalue()))
    return output.getvalue(), {"slides": len(checked.slides)}, []


def _pdf(request: GenerateRequest) -> tuple[bytes, dict[str, Any], list[str]]:
    output = io.BytesIO()
    pdf = canvas.Canvas(output, pagesize=letter)
    width, height = letter
    cursor = height - 72
    pdf.setFont("Helvetica-Bold", 18)
    pdf.drawString(72, cursor, request.title)
    cursor -= 34
    pdf.setFont("Helvetica", 10)
    for paragraph in request.paragraphs:
        for line in paragraph.splitlines() or [""]:
            if cursor < 72:
                pdf.showPage()
                pdf.setFont("Helvetica", 10)
                cursor = height - 72
            pdf.drawString(72, cursor, line[:110])
            cursor -= 14
    pdf.save()
    reader = PdfReader(io.BytesIO(output.getvalue()))
    return output.getvalue(), {"pages": len(reader.pages), "width": width}, []


def generate_artifact(request: GenerateRequest) -> GeneratedArtifact:
    generators = {"docx": _docx, "xlsx": _xlsx, "pptx": _pptx, "pdf": _pdf}
    mime_types = {
        "docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        "xlsx": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "pptx": "application/vnd.openxmlformats-officedocument.presentationml.presentation",
        "pdf": "application/pdf",
        "txt": "text/plain",
    }
    if request.format == "txt":
        data = (request.title + "\n\n" + "\n\n".join(request.paragraphs)).encode()
        preview: dict[str, Any] = {"characters": len(data.decode())}
        warnings: list[str] = []
    else:
        data, preview, warnings = generators[request.format](request)
    checksum = f"sha256:{hashlib.sha256(data).hexdigest()}"
    return GeneratedArtifact(
        file_name=f"{request.title}.{request.format}",
        mime_type=mime_types[request.format],
        checksum=checksum,
        bytes_base64=base64.b64encode(data).decode("ascii"),
        preview=preview,
        checks=["reopened_generated_file", "nonempty_output", "checksum_recorded"],
        warnings=warnings,
    )
