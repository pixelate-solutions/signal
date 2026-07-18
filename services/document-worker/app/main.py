from fastapi import FastAPI, HTTPException

from .edit import edit_artifact
from .generate import generate_artifact
from .models import (
    CanonicalArtifact,
    EditRequest,
    GeneratedArtifact,
    GenerateRequest,
    ProcessRequest,
)
from .processors import process_artifact
from .security import UnsafeArchiveError

app = FastAPI(title="Signal Document Worker", version="1.1.0")


@app.get("/health")
def health() -> dict[str, str]:
    return {"status": "ok", "service": "document-worker"}


@app.post("/v1/process", response_model=CanonicalArtifact)
def process(request: ProcessRequest) -> CanonicalArtifact:
    try:
        return process_artifact(request)
    except (ValueError, UnsafeArchiveError) as error:
        raise HTTPException(status_code=422, detail=str(error)) from error


@app.post("/v1/generate", response_model=GeneratedArtifact)
def generate(request: GenerateRequest) -> GeneratedArtifact:
    try:
        return generate_artifact(request)
    except ValueError as error:
        raise HTTPException(status_code=422, detail=str(error)) from error


@app.post("/v1/edit", response_model=GeneratedArtifact)
def edit(request: EditRequest) -> GeneratedArtifact:
    try:
        return edit_artifact(request)
    except ValueError as error:
        raise HTTPException(status_code=422, detail=str(error)) from error
