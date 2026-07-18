import {
  canonicalArtifactSchema,
  type Artifact,
  type ArtifactEditOperation,
  type CanonicalArtifact,
} from "@signal/contracts";

export type GeneratedArtifact = {
  fileName: string;
  mimeType: string;
  checksum: string;
  bytes: Uint8Array;
  warnings: string[];
};

export type ArtifactProcessor = {
  process(
    artifact: Artifact,
    bytes: Uint8Array,
  ): Promise<CanonicalArtifact & { preview?: Uint8Array }>;
  edit(
    artifact: Artifact,
    bytes: Uint8Array,
    outputFileName: string,
    operations: readonly ArtifactEditOperation[],
  ): Promise<GeneratedArtifact>;
};

type RawBlock = {
  kind: "text" | "table" | "image" | "formula" | "archive_entry" | "media";
  text: string;
  location: {
    page: number | null;
    slide: number | null;
    sheet: string | null;
    range: string | null;
    paragraph: number | null;
    timestamp_seconds: number | null;
  };
  metadata: Record<string, unknown>;
};

type RawCanonicalArtifact = {
  artifact_id: string;
  original_checksum: string;
  detected_format: string;
  processor_version: string;
  blocks: RawBlock[];
  warnings: string[];
  preview_base64: string | null;
};

type RawGeneratedArtifact = {
  file_name: string;
  mime_type: string;
  checksum: string;
  bytes_base64: string;
  warnings: string[];
};

function operationBody(operation: ArtifactEditOperation): Record<string, unknown> {
  if (operation.type === "replace_text") {
    return {
      type: operation.type,
      find: operation.find,
      replacement: operation.replacement,
      replace_all: operation.replaceAll,
    };
  }
  return operation;
}

export class HttpDocumentProcessor implements ArtifactProcessor {
  public constructor(
    private readonly baseUrl: string,
    private readonly fetcher: typeof fetch = fetch,
  ) {}

  public async process(
    artifact: Artifact,
    bytes: Uint8Array,
  ): Promise<CanonicalArtifact & { preview?: Uint8Array }> {
    const payload = await this.request<RawCanonicalArtifact>("/v1/process", {
      artifact_id: artifact.id,
      file_name: artifact.originalName,
      mime_type: artifact.mimeType,
      checksum: artifact.checksum,
      scan_state: "CLEAN",
      bytes_base64: Buffer.from(bytes).toString("base64"),
    });
    const canonical = canonicalArtifactSchema.parse({
      artifactId: payload.artifact_id,
      originalChecksum: payload.original_checksum,
      detectedFormat: payload.detected_format,
      processorVersion: payload.processor_version,
      blocks: payload.blocks.map((block) => ({
        kind: block.kind,
        text: block.text,
        location: {
          page: block.location.page,
          slide: block.location.slide,
          sheet: block.location.sheet,
          range: block.location.range,
          paragraph: block.location.paragraph,
          timestampSeconds: block.location.timestamp_seconds,
        },
        metadata: block.metadata,
      })),
      warnings: payload.warnings,
      previewStorageKey: null,
      processedAt: new Date().toISOString(),
    });
    return {
      ...canonical,
      ...(payload.preview_base64 === null
        ? {}
        : { preview: Uint8Array.from(Buffer.from(payload.preview_base64, "base64")) }),
    };
  }

  public async edit(
    artifact: Artifact,
    bytes: Uint8Array,
    outputFileName: string,
    operations: readonly ArtifactEditOperation[],
  ): Promise<GeneratedArtifact> {
    const payload = await this.request<RawGeneratedArtifact>("/v1/edit", {
      artifact_id: artifact.id,
      file_name: artifact.originalName,
      mime_type: artifact.mimeType,
      checksum: artifact.checksum,
      bytes_base64: Buffer.from(bytes).toString("base64"),
      output_file_name: outputFileName,
      operations: operations.map(operationBody),
    });
    return {
      fileName: payload.file_name,
      mimeType: payload.mime_type,
      checksum: payload.checksum,
      bytes: Uint8Array.from(Buffer.from(payload.bytes_base64, "base64")),
      warnings: payload.warnings,
    };
  }

  private async request<T>(path: string, body: Record<string, unknown>): Promise<T> {
    const response = await this.fetcher(`${this.baseUrl.replace(/\/$/, "")}${path}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(180_000),
    });
    if (!response.ok) {
      const detail = await response.text();
      throw new Error(
        `Document processing failed with HTTP ${response.status}: ${detail.slice(0, 500)}`,
      );
    }
    return (await response.json()) as T;
  }
}
