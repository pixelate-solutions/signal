import { createHash, randomBytes, randomUUID, timingSafeEqual } from "node:crypto";
import { extname } from "node:path";

import type { Principal } from "@signal/auth-sdk";
import { requireTenant } from "@signal/auth-sdk";
import { completeUploadSchema, createUploadSchema, type Artifact } from "@signal/contracts";

import { DeterministicMalwareScanner, type MalwareScanner } from "./malware.js";

export * from "./malware.js";

type UploadSessionRecord = {
  id: string;
  artifactId: string;
  tenantId: string;
  tokenHash: Uint8Array;
  expiresAt: Date;
  bytes?: Uint8Array;
  etag?: string;
  completedArtifact?: Artifact;
};

export type UploadSession = {
  uploadId: string;
  artifactId: string;
  partSizeBytes: number;
  partUrls: string[];
  expiresAt: string;
};

export class ArtifactError extends Error {
  public constructor(
    message: string,
    public readonly code:
      | "NOT_FOUND"
      | "FORBIDDEN"
      | "STALE_UPLOAD"
      | "CHECKSUM_MISMATCH"
      | "MALWARE_DETECTED"
      | "SCAN_UNAVAILABLE"
      | "INVALID_FILE",
  ) {
    super(message);
    this.name = "ArtifactError";
  }
}

function checksum(bytes: Uint8Array): string {
  return `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
}

function tokenDigest(token: string): Uint8Array {
  return createHash("sha256").update(token).digest();
}

function sniffMime(bytes: Uint8Array): string | undefined {
  const header = Buffer.from(bytes.subarray(0, 16));
  if (header.subarray(0, 5).toString() === "%PDF-") return "application/pdf";
  if (header.subarray(0, 4).equals(Buffer.from([0x50, 0x4b, 0x03, 0x04]))) {
    return "application/zip";
  }
  if (header.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) {
    return "image/png";
  }
  if (header[0] === 0xff && header[1] === 0xd8 && header[2] === 0xff) return "image/jpeg";
  if (header.subarray(0, 4).toString() === "RIFF" && header.subarray(8, 12).toString() === "WEBP") {
    return "image/webp";
  }
  const sample = Buffer.from(bytes.subarray(0, Math.min(bytes.byteLength, 4_096))).toString("utf8");
  if (!sample.includes("\u0000")) return "text/plain";
  return undefined;
}

function expectedExtensions(mime: string): readonly string[] {
  const map: Record<string, readonly string[]> = {
    "application/pdf": [".pdf"],
    "application/zip": [".zip", ".docx", ".xlsx", ".pptx"],
    "image/png": [".png"],
    "image/jpeg": [".jpg", ".jpeg"],
    "image/webp": [".webp"],
    "text/plain": [".txt", ".md", ".csv", ".tsv", ".json", ".yaml", ".yml"],
  };
  return map[mime] ?? [];
}

export class ArtifactService {
  readonly #artifacts = new Map<string, Artifact>();
  readonly #sessions = new Map<string, UploadSessionRecord>();
  readonly #objects = new Map<string, Uint8Array>();
  readonly #versions = new Map<string, string[]>();

  public constructor(
    private readonly publicBaseUrl: string,
    private readonly now: () => Date = () => new Date(),
    private readonly malwareScanner: MalwareScanner = new DeterministicMalwareScanner(),
  ) {}

  public createUpload(principal: Principal, rawInput: unknown): UploadSession {
    const input = createUploadSchema.parse(rawInput);
    const id = `art_${randomUUID().replaceAll("-", "")}`;
    const uploadId = `upl_${randomUUID().replaceAll("-", "")}`;
    const token = randomBytes(32).toString("base64url");
    const expiresAt = new Date(this.now().getTime() + 15 * 60 * 1_000);
    const createdAt = this.now().toISOString();
    const artifact: Artifact = {
      id,
      tenantId: principal.tenantId,
      ownerUserId: principal.userId,
      originalName: input.fileName,
      mimeType: input.declaredMimeType,
      sizeBytes: input.sizeBytes,
      checksum: input.checksum,
      version: 1,
      parentArtifactId: null,
      sensitivity: input.sensitivity,
      scanState: "UPLOADING",
      warnings: [],
      createdAt,
      deletedAt: null,
    };
    this.#artifacts.set(id, artifact);
    this.#versions.set(id, [id]);
    this.#sessions.set(uploadId, {
      id: uploadId,
      artifactId: id,
      tenantId: principal.tenantId,
      tokenHash: tokenDigest(token),
      expiresAt,
    });
    return {
      uploadId,
      artifactId: id,
      partSizeBytes: 16 * 1024 * 1024,
      partUrls: [
        `${this.publicBaseUrl.replace(/\/$/, "")}/v1/uploads/${uploadId}/parts/1?token=${encodeURIComponent(token)}`,
      ],
      expiresAt: expiresAt.toISOString(),
    };
  }

  public putPart(uploadId: string, token: string, partNumber: number, bytes: Uint8Array): string {
    const session = this.requireSession(uploadId);
    if (partNumber !== 1)
      throw new ArtifactError("Only one local upload part is supported.", "INVALID_FILE");
    if (session.expiresAt <= this.now())
      throw new ArtifactError("The upload session expired.", "STALE_UPLOAD");
    const actualToken = tokenDigest(token);
    if (
      actualToken.byteLength !== session.tokenHash.byteLength ||
      !timingSafeEqual(actualToken, session.tokenHash)
    ) {
      throw new ArtifactError("The upload URL is invalid or expired.", "FORBIDDEN");
    }
    const artifact = this.requireArtifact(session.artifactId);
    if (bytes.byteLength !== artifact.sizeBytes) {
      throw new ArtifactError(
        "Uploaded bytes do not match the declared file size.",
        "INVALID_FILE",
      );
    }
    session.bytes = Uint8Array.from(bytes);
    session.etag = checksum(bytes);
    this.#artifacts.set(artifact.id, { ...artifact, scanState: "QUARANTINED" });
    return session.etag;
  }

  public async completeUpload(
    principal: Principal,
    uploadId: string,
    rawInput: unknown,
  ): Promise<Artifact> {
    const input = completeUploadSchema.parse(rawInput);
    const session = this.requireSession(uploadId);
    requireTenant(principal, session.tenantId);
    if (session.completedArtifact !== undefined) {
      if (session.completedArtifact.checksum !== input.checksum) {
        throw new ArtifactError(
          "The completed upload has different material bytes.",
          "STALE_UPLOAD",
        );
      }
      return session.completedArtifact;
    }
    if (session.bytes === undefined || session.etag === undefined) {
      throw new ArtifactError("The upload part has not arrived.", "STALE_UPLOAD");
    }
    const actualChecksum = checksum(session.bytes);
    const artifact = this.requireArtifact(session.artifactId);
    if (actualChecksum !== artifact.checksum || actualChecksum !== input.checksum) {
      throw new ArtifactError("The uploaded file checksum did not match.", "CHECKSUM_MISMATCH");
    }
    const part = input.parts.find((candidate) => candidate.partNumber === 1);
    if (part === undefined || (part.etag !== session.etag && part.etag !== actualChecksum)) {
      throw new ArtifactError("The upload part receipt did not match.", "STALE_UPLOAD");
    }
    let scan;
    try {
      scan = await this.malwareScanner.scan(session.bytes);
    } catch {
      throw new ArtifactError(
        "Malware scanning is unavailable; the upload remains quarantined.",
        "SCAN_UNAVAILABLE",
      );
    }
    if (!scan.clean) {
      const rejected = { ...artifact, scanState: "REJECTED" as const };
      this.#artifacts.set(artifact.id, rejected);
      throw new ArtifactError("The file failed malware scanning.", "MALWARE_DETECTED");
    }
    const sniffed = sniffMime(session.bytes);
    const warnings = [...artifact.warnings];
    if (sniffed === undefined) warnings.push("The file signature could not be identified.");
    if (sniffed !== undefined && sniffed !== artifact.mimeType && sniffed !== "application/zip") {
      warnings.push(`Declared MIME ${artifact.mimeType} differs from detected ${sniffed}.`);
    }
    const extension = extname(artifact.originalName).toLowerCase();
    if (sniffed !== undefined && !expectedExtensions(sniffed).includes(extension)) {
      warnings.push("The filename extension does not match the detected file signature.");
    }
    const clean: Artifact = {
      ...artifact,
      mimeType:
        sniffed === undefined || sniffed === "application/zip" ? artifact.mimeType : sniffed,
      scanState: "CLEAN",
      warnings,
    };
    this.#objects.set(artifact.id, session.bytes);
    this.#artifacts.set(artifact.id, clean);
    session.completedArtifact = clean;
    return clean;
  }

  public get(principal: Principal, artifactId: string): Artifact {
    const artifact = this.requireArtifact(artifactId);
    requireTenant(principal, artifact.tenantId);
    return artifact;
  }

  public versions(principal: Principal, artifactId: string): Artifact[] {
    const artifact = this.get(principal, artifactId);
    const rootId = artifact.parentArtifactId ?? artifact.id;
    return (this.#versions.get(rootId) ?? [artifact.id]).map((id) => this.requireArtifact(id));
  }

  public bytes(principal: Principal, artifactId: string): Uint8Array {
    const artifact = this.get(principal, artifactId);
    if (artifact.scanState !== "CLEAN" && artifact.scanState !== "READY") {
      throw new ArtifactError("The artifact is not cleared for download.", "FORBIDDEN");
    }
    const bytes = this.#objects.get(artifactId);
    if (bytes === undefined)
      throw new ArtifactError("Artifact bytes are unavailable.", "NOT_FOUND");
    return Uint8Array.from(bytes);
  }

  private requireSession(uploadId: string): UploadSessionRecord {
    const session = this.#sessions.get(uploadId);
    if (session === undefined) throw new ArtifactError("Upload session not found.", "NOT_FOUND");
    return session;
  }

  private requireArtifact(artifactId: string): Artifact {
    const artifact = this.#artifacts.get(artifactId);
    if (artifact === undefined) throw new ArtifactError("Artifact not found.", "NOT_FOUND");
    return artifact;
  }
}
