FROM python:3.12.11-slim-bookworm

ENV PYTHONUNBUFFERED=1
ENV PIP_DISABLE_PIP_VERSION_CHECK=1
# This image pins Python for reproducibility, so refresh the base OS security
# packages before adding FFmpeg. DL3005 and DL3008 are deliberate here.
# hadolint ignore=DL3005,DL3008
RUN apt-get update \
  && apt-get upgrade --yes \
  && apt-get install --no-install-recommends --yes \
    ffmpeg \
    libreoffice-calc \
    libreoffice-impress \
    libreoffice-writer \
    tesseract-ocr \
  && rm -rf /var/lib/apt/lists/* \
  && groupadd --gid 10001 signal \
  && useradd --uid 10001 --gid signal --create-home signal
WORKDIR /app
COPY services/document-worker/pyproject.toml ./
COPY services/document-worker/app ./app
RUN python -m pip install --no-cache-dir .
USER signal
EXPOSE 3400
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "3400", "--no-access-log"]
