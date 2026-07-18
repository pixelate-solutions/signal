import { createHash, randomBytes, randomUUID, timingSafeEqual } from "node:crypto";
import { extname } from "node:path";

import type { Principal } from "@signal/auth-sdk";
import { requireTenant } from "@signal/auth-sdk";
import {
  completeUploadSchema,
  createUploadSchema,
  editArtifactSchema,
  type Artifact,
  type CanonicalArtifact,
} from "@signal/contracts";
import {
  InMemoryObjectStore,
  InMemoryTenantRecordStore,
  type ObjectStore,
  type TenantRecordStore,
  type TenantRecordTransaction,
} from "@signal/persistence";

import { DeterministicMalwareScanner, type MalwareScanner } from "./malware.js";
import type { ArtifactProcessor } from "./processor.js";

export * from "./malware.js";
export * from "./processor.js";

const ARTIFACT_NAMESPACE = "artifact.metadata";
const UPLOAD_NAMESPACE = "artifact.uploads";
const VERSION_NAMESPACE = "artifact.versions";
const REPRESENTATION_NAMESPACE = "artifact.representations";
const PROCESSING_NAMESPACE = "artifact.processing";

type UploadSessionRecord = {
  id: string;
  artifactId: string;
  tenantId: string;
  tokenHash: string;
  expiresAt: string;
  temporaryStorageKey: string;
  etag: string | null;
  completedArtifact: Artifact | null;
};

export type UploadSession = {
  uploadId: string;
  artifactId: string;
  partSizeBytes: number;
  partUrls: string[];
  expiresAt: string;
};

export type IngestArtifactInput = {
  fileName: string;
  mimeType: string;
  bytes: Uint8Array;
  sensitivity?: Artifact["sensitivity"];
  warnings?: string[];
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

function tokenDigest(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

function tenantFromToken(token: string): string {
  const separator = token.indexOf(".");
  const tenantId = separator < 0 ? "" : token.slice(0, separator);
  if (!/^ten_[a-zA-Z0-9_-]+$/.test(tenantId)) {
    throw new ArtifactError("The upload URL is invalid or expired.", "FORBIDDEN");
  }
  return tenantId;
}

function safeDigestEqual(left: string, right: string): boolean {
  const leftBytes = Buffer.from(left);
  const rightBytes = Buffer.from(right);
  return leftBytes.byteLength === rightBytes.byteLength && timingSafeEqual(leftBytes, rightBytes);
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
  public constructor(
    private readonly publicBaseUrl: string,
    private readonly now: () => Date = () => new Date(),
    private readonly malwareScanner: MalwareScanner = new DeterministicMalwareScanner(),
    private readonly records: TenantRecordStore = new InMemoryTenantRecordStore(),
    private readonly objects: ObjectStore = new InMemoryObjectStore(),
    private readonly processor?: ArtifactProcessor,
  ) {}

  public async createUpload(principal: Principal, rawInput: unknown): Promise<UploadSession> {
    const input = createUploadSchema.parse(rawInput);
    const id = `art_${randomUUID().replaceAll("-", "")}`;
    const uploadId = `upl_${randomUUID().replaceAll("-", "")}`;
    const token = `${principal.tenantId}.${randomBytes(32).toString("base64url")}`;
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
    const temporaryStorageKey = `tenants/${principal.tenantId}/uploads/${uploadId}/part-1`;
    await this.records.runExclusive(principal.tenantId, async (transaction) => {
      await transaction.put(ARTIFACT_NAMESPACE, id, artifact);
      await transaction.put(VERSION_NAMESPACE, id, [id]);
      await transaction.put(
        UPLOAD_NAMESPACE,
        uploadId,
        {
          id: uploadId,
          artifactId: id,
          tenantId: principal.tenantId,
          tokenHash: tokenDigest(token),
          expiresAt: expiresAt.toISOString(),
          temporaryStorageKey,
          etag: null,
          completedArtifact: null,
        } satisfies UploadSessionRecord,
        { expiresAt },
      );
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

  public async putPart(
    uploadId: string,
    token: string,
    partNumber: number,
    bytes: Uint8Array,
  ): Promise<string> {
    if (partNumber !== 1) {
      throw new ArtifactError("Only one upload part is currently supported.", "INVALID_FILE");
    }
    const tenantId = tenantFromToken(token);
    return this.records.runExclusive(tenantId, async (transaction) => {
      const session = await this.requireSession(transaction, uploadId);
      if (new Date(session.expiresAt) <= this.now()) {
        throw new ArtifactError("The upload session expired.", "STALE_UPLOAD");
      }
      if (!safeDigestEqual(tokenDigest(token), session.tokenHash)) {
        throw new ArtifactError("The upload URL is invalid or expired.", "FORBIDDEN");
      }
      const artifact = await this.requireArtifact(transaction, session.artifactId);
      if (bytes.byteLength !== artifact.sizeBytes) {
        throw new ArtifactError(
          "Uploaded bytes do not match the declared file size.",
          "INVALID_FILE",
        );
      }
      const etag = checksum(bytes);
      await this.objects.put(session.temporaryStorageKey, bytes, artifact.mimeType);
      await transaction.put(
        UPLOAD_NAMESPACE,
        uploadId,
        { ...session, etag },
        {
          expiresAt: new Date(session.expiresAt),
        },
      );
      await transaction.put(ARTIFACT_NAMESPACE, artifact.id, {
        ...artifact,
        scanState: "QUARANTINED",
      } satisfies Artifact);
      return etag;
    });
  }

  public async completeUpload(
    principal: Principal,
    uploadId: string,
    rawInput: unknown,
  ): Promise<Artifact> {
    const input = completeUploadSchema.parse(rawInput);
    const clean = await this.records.runExclusive(principal.tenantId, async (transaction) => {
      const session = await this.requireSession(transaction, uploadId);
      requireTenant(principal, session.tenantId);
      if (session.completedArtifact !== null) {
        if (session.completedArtifact.checksum !== input.checksum) {
          throw new ArtifactError(
            "The completed upload has different material bytes.",
            "STALE_UPLOAD",
          );
        }
        return session.completedArtifact;
      }
      if (session.etag === null) {
        throw new ArtifactError("The upload part has not arrived.", "STALE_UPLOAD");
      }
      const stored = await this.objects.get(session.temporaryStorageKey);
      if (stored === undefined) {
        throw new ArtifactError("The upload part is unavailable.", "STALE_UPLOAD");
      }
      const actualChecksum = checksum(stored.body);
      const artifact = await this.requireArtifact(transaction, session.artifactId);
      if (actualChecksum !== artifact.checksum || actualChecksum !== input.checksum) {
        throw new ArtifactError("The uploaded file checksum did not match.", "CHECKSUM_MISMATCH");
      }
      const part = input.parts.find((candidate) => candidate.partNumber === 1);
      if (part === undefined || (part.etag !== session.etag && part.etag !== actualChecksum)) {
        throw new ArtifactError("The upload part receipt did not match.", "STALE_UPLOAD");
      }
      let scan;
      try {
        scan = await this.malwareScanner.scan(stored.body);
      } catch {
        throw new ArtifactError(
          "Malware scanning is unavailable; the upload remains quarantined.",
          "SCAN_UNAVAILABLE",
        );
      }
      if (!scan.clean) {
        await transaction.put(ARTIFACT_NAMESPACE, artifact.id, {
          ...artifact,
          scanState: "REJECTED",
        } satisfies Artifact);
        throw new ArtifactError("The file failed malware scanning.", "MALWARE_DETECTED");
      }
      const sniffed = sniffMime(stored.body);
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
      const storageKey = this.storageKey(clean);
      await this.objects.put(storageKey, stored.body, clean.mimeType);
      await this.objects.remove(session.temporaryStorageKey);
      await transaction.put(ARTIFACT_NAMESPACE, artifact.id, clean);
      await transaction.put(
        UPLOAD_NAMESPACE,
        uploadId,
        { ...session, completedArtifact: clean },
        { expiresAt: new Date(session.expiresAt) },
      );
      return clean;
    });
    return this.processor === undefined ? clean : this.process(principal, clean.id);
  }

  public async process(principal: Principal, artifactId: string): Promise<Artifact> {
    if (this.processor === undefined) return this.get(principal, artifactId);
    const artifact = await this.get(principal, artifactId);
    if (artifact.scanState === "READY") return artifact;
    if (!["CLEAN", "PROCESSING", "FAILED"].includes(artifact.scanState)) {
      throw new ArtifactError("The artifact is not cleared for processing.", "FORBIDDEN");
    }
    await this.records.runExclusive(principal.tenantId, async (transaction) => {
      await transaction.put(ARTIFACT_NAMESPACE, artifact.id, {
        ...artifact,
        scanState: "PROCESSING",
      } satisfies Artifact);
      await transaction.put(PROCESSING_NAMESPACE, artifact.id, {
        artifactId: artifact.id,
        state: "PROCESSING",
        startedAt: this.now().toISOString(),
      });
    });
    try {
      const stored = await this.objects.get(this.storageKey(artifact));
      if (stored === undefined) {
        throw new ArtifactError("Artifact bytes are unavailable.", "NOT_FOUND");
      }
      const representation = await this.processor.process(artifact, stored.body);
      const previewStorageKey =
        representation.preview === undefined
          ? null
          : `tenants/${artifact.tenantId}/artifacts/${artifact.id}/v${artifact.version}/preview.jpg`;
      if (previewStorageKey !== null && representation.preview !== undefined) {
        await this.objects.put(previewStorageKey, representation.preview, "image/jpeg");
      }
      const durableRepresentation: CanonicalArtifact = {
        ...representation,
        previewStorageKey,
      };
      return await this.records.runExclusive(principal.tenantId, async (transaction) => {
        const latest = await this.requireArtifact(transaction, artifact.id);
        const ready: Artifact = {
          ...latest,
          scanState: "READY",
          warnings: [...new Set([...latest.warnings, ...representation.warnings])],
        };
        await transaction.put(REPRESENTATION_NAMESPACE, artifact.id, durableRepresentation);
        await transaction.put(ARTIFACT_NAMESPACE, artifact.id, ready);
        await transaction.put(PROCESSING_NAMESPACE, artifact.id, {
          artifactId: artifact.id,
          state: "READY",
          processorVersion: representation.processorVersion,
          completedAt: this.now().toISOString(),
        });
        return ready;
      });
    } catch (error) {
      return this.records.runExclusive(principal.tenantId, async (transaction) => {
        const latest = await this.requireArtifact(transaction, artifact.id);
        const failed: Artifact = {
          ...latest,
          scanState: "FAILED",
          warnings: [
            ...latest.warnings,
            error instanceof Error ? error.message : "Document processing failed.",
          ],
        };
        await transaction.put(ARTIFACT_NAMESPACE, artifact.id, failed);
        await transaction.put(PROCESSING_NAMESPACE, artifact.id, {
          artifactId: artifact.id,
          state: "FAILED",
          failedAt: this.now().toISOString(),
          reason: error instanceof Error ? error.message : "Document processing failed.",
        });
        return failed;
      });
    }
  }

  public async representation(
    principal: Principal,
    artifactId: string,
  ): Promise<CanonicalArtifact> {
    const artifact = await this.get(principal, artifactId);
    requireTenant(principal, artifact.tenantId);
    return this.records.runExclusive(principal.tenantId, async (transaction) => {
      const representation = await transaction.get<CanonicalArtifact>(
        REPRESENTATION_NAMESPACE,
        artifactId,
      );
      if (representation === undefined) {
        throw new ArtifactError("Artifact representation is not ready.", "NOT_FOUND");
      }
      return representation;
    });
  }

  public async preview(principal: Principal, artifactId: string): Promise<Uint8Array> {
    const representation = await this.representation(principal, artifactId);
    if (representation.previewStorageKey === null) {
      throw new ArtifactError("Artifact preview is unavailable.", "NOT_FOUND");
    }
    const stored = await this.objects.get(representation.previewStorageKey);
    if (stored === undefined)
      throw new ArtifactError("Artifact preview is unavailable.", "NOT_FOUND");
    return Uint8Array.from(stored.body);
  }

  public async createVersion(
    principal: Principal,
    artifactId: string,
    rawInput: unknown,
  ): Promise<Artifact> {
    if (this.processor === undefined) {
      throw new ArtifactError("Document editing is unavailable.", "FORBIDDEN");
    }
    const input = editArtifactSchema.parse(rawInput);
    const parent = await this.get(principal, artifactId);
    const parentBytes = await this.bytes(principal, artifactId);
    const generated = await this.processor.edit(
      parent,
      parentBytes,
      input.fileName ?? parent.originalName,
      input.operations,
    );
    if (checksum(generated.bytes) !== generated.checksum) {
      throw new ArtifactError("Edited artifact checksum did not match.", "CHECKSUM_MISMATCH");
    }
    const scan = await this.malwareScanner.scan(generated.bytes);
    if (!scan.clean) {
      throw new ArtifactError("The edited file failed malware scanning.", "MALWARE_DETECTED");
    }
    const rootId = parent.parentArtifactId ?? parent.id;
    const next = await this.records.runExclusive(principal.tenantId, async (transaction) => {
      const ids = (await transaction.get<string[]>(VERSION_NAMESPACE, rootId)) ?? [rootId];
      const versionId = `art_${randomUUID().replaceAll("-", "")}`;
      const artifact: Artifact = {
        id: versionId,
        tenantId: parent.tenantId,
        ownerUserId: principal.userId,
        originalName: generated.fileName,
        mimeType: generated.mimeType,
        sizeBytes: generated.bytes.byteLength,
        checksum: generated.checksum,
        version: ids.length + 1,
        parentArtifactId: rootId,
        sensitivity: parent.sensitivity,
        scanState: "CLEAN",
        warnings: generated.warnings,
        createdAt: this.now().toISOString(),
        deletedAt: null,
      };
      await transaction.put(ARTIFACT_NAMESPACE, artifact.id, artifact);
      await transaction.put(VERSION_NAMESPACE, rootId, [...ids, artifact.id]);
      return artifact;
    });
    await this.objects.put(this.storageKey(next), generated.bytes, generated.mimeType);
    return this.process(principal, next.id);
  }

  public async ingest(principal: Principal, input: IngestArtifactInput): Promise<Artifact> {
    if (input.bytes.byteLength === 0 || input.bytes.byteLength > 5_000_000_000) {
      throw new ArtifactError("Generated artifact size is invalid.", "INVALID_FILE");
    }
    const scan = await this.malwareScanner.scan(input.bytes);
    if (!scan.clean) {
      throw new ArtifactError("The generated file failed malware scanning.", "MALWARE_DETECTED");
    }
    const artifact: Artifact = {
      id: `art_${randomUUID().replaceAll("-", "")}`,
      tenantId: principal.tenantId,
      ownerUserId: principal.userId,
      originalName: input.fileName,
      mimeType: input.mimeType,
      sizeBytes: input.bytes.byteLength,
      checksum: checksum(input.bytes),
      version: 1,
      parentArtifactId: null,
      sensitivity: input.sensitivity ?? "internal",
      scanState: "CLEAN",
      warnings: input.warnings ?? [],
      createdAt: this.now().toISOString(),
      deletedAt: null,
    };
    await this.objects.put(this.storageKey(artifact), input.bytes, artifact.mimeType);
    await this.records.runExclusive(principal.tenantId, async (transaction) => {
      await transaction.put(ARTIFACT_NAMESPACE, artifact.id, artifact);
      await transaction.put(VERSION_NAMESPACE, artifact.id, [artifact.id]);
    });
    return this.process(principal, artifact.id);
  }

  public async get(principal: Principal, artifactId: string): Promise<Artifact> {
    return this.records.runExclusive(principal.tenantId, async (transaction) => {
      const artifact = await this.requireArtifact(transaction, artifactId);
      requireTenant(principal, artifact.tenantId);
      return artifact;
    });
  }

  public async versions(principal: Principal, artifactId: string): Promise<Artifact[]> {
    return this.records.runExclusive(principal.tenantId, async (transaction) => {
      const artifact = await this.requireArtifact(transaction, artifactId);
      requireTenant(principal, artifact.tenantId);
      const rootId = artifact.parentArtifactId ?? artifact.id;
      const ids = (await transaction.get<string[]>(VERSION_NAMESPACE, rootId)) ?? [artifact.id];
      return Promise.all(ids.map((id) => this.requireArtifact(transaction, id)));
    });
  }

  public async bytes(principal: Principal, artifactId: string): Promise<Uint8Array> {
    const artifact = await this.get(principal, artifactId);
    if (artifact.scanState !== "CLEAN" && artifact.scanState !== "READY") {
      throw new ArtifactError("The artifact is not cleared for download.", "FORBIDDEN");
    }
    const stored = await this.objects.get(this.storageKey(artifact));
    if (stored === undefined)
      throw new ArtifactError("Artifact bytes are unavailable.", "NOT_FOUND");
    return Uint8Array.from(stored.body);
  }

  private storageKey(artifact: Artifact): string {
    return `tenants/${artifact.tenantId}/artifacts/${artifact.id}/v${artifact.version}/original`;
  }

  private async requireSession(
    transaction: TenantRecordTransaction,
    uploadId: string,
  ): Promise<UploadSessionRecord> {
    const session = await transaction.get<UploadSessionRecord>(UPLOAD_NAMESPACE, uploadId);
    if (session === undefined) throw new ArtifactError("Upload session not found.", "NOT_FOUND");
    return session;
  }

  private async requireArtifact(
    transaction: TenantRecordTransaction,
    artifactId: string,
  ): Promise<Artifact> {
    const artifact = await transaction.get<Artifact>(ARTIFACT_NAMESPACE, artifactId);
    if (artifact === undefined) throw new ArtifactError("Artifact not found.", "NOT_FOUND");
    return artifact;
  }
}
