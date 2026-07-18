import { z } from "zod";

import { dataClassificationSchema, sha256DigestSchema, utcTimestampSchema } from "./common.js";
import { artifactIdSchema, tenantIdSchema, userIdSchema } from "./ids.js";

export const artifactScanStateSchema = z.enum([
  "UPLOADING",
  "QUARANTINED",
  "SCANNING",
  "CLEAN",
  "REJECTED",
  "PROCESSING",
  "READY",
  "FAILED",
  "DELETED",
]);

export const artifactSchema = z
  .object({
    id: artifactIdSchema,
    tenantId: tenantIdSchema,
    ownerUserId: userIdSchema,
    originalName: z.string().min(1).max(1_024),
    mimeType: z.string().min(1).max(255),
    sizeBytes: z.int().nonnegative(),
    checksum: sha256DigestSchema,
    version: z.int().positive(),
    parentArtifactId: artifactIdSchema.nullable(),
    sensitivity: dataClassificationSchema,
    scanState: artifactScanStateSchema,
    warnings: z.array(z.string().max(2_000)),
    createdAt: utcTimestampSchema,
    deletedAt: utcTimestampSchema.nullable(),
  })
  .strict();

export const createUploadSchema = z
  .object({
    fileName: z.string().min(1).max(1_024),
    declaredMimeType: z.string().min(1).max(255),
    sizeBytes: z.int().positive().max(5_000_000_000),
    checksum: sha256DigestSchema,
    sensitivity: dataClassificationSchema.default("internal"),
  })
  .strict();

export const uploadSessionSchema = z
  .object({
    uploadId: z.string().min(8).max(500),
    artifactId: artifactIdSchema,
    partSizeBytes: z.int().positive(),
    partUrls: z.array(z.url()).min(1),
    expiresAt: utcTimestampSchema,
  })
  .strict();

export const completeUploadSchema = z
  .object({
    checksum: sha256DigestSchema,
    parts: z
      .array(
        z
          .object({
            partNumber: z.int().positive(),
            etag: z.string().min(1).max(500),
          })
          .strict(),
      )
      .min(1),
  })
  .strict();

export const artifactLocationSchema = z
  .object({
    page: z.int().positive().nullable(),
    slide: z.int().positive().nullable(),
    sheet: z.string().min(1).max(255).nullable(),
    range: z.string().min(1).max(255).nullable(),
    paragraph: z.int().positive().nullable(),
    timestampSeconds: z.number().nonnegative().nullable(),
  })
  .strict();

export const canonicalArtifactBlockSchema = z
  .object({
    kind: z.enum(["text", "table", "image", "formula", "archive_entry", "media"]),
    text: z.string().max(1_000_000),
    location: artifactLocationSchema,
    metadata: z.record(z.string(), z.unknown()),
  })
  .strict();

export const canonicalArtifactSchema = z
  .object({
    artifactId: artifactIdSchema,
    originalChecksum: sha256DigestSchema,
    detectedFormat: z.string().min(1).max(255),
    processorVersion: z.string().min(1).max(255),
    blocks: z.array(canonicalArtifactBlockSchema).max(100_000),
    warnings: z.array(z.string().max(2_000)),
    previewStorageKey: z.string().min(1).max(2_000).nullable(),
    processedAt: utcTimestampSchema,
  })
  .strict();

export const artifactEditOperationSchema = z.discriminatedUnion("type", [
  z
    .object({
      type: z.literal("replace_text"),
      find: z.string().min(1).max(100_000),
      replacement: z.string().max(100_000),
      replaceAll: z.boolean().default(true),
    })
    .strict(),
  z
    .object({
      type: z.literal("append_paragraph"),
      text: z.string().min(1).max(100_000),
    })
    .strict(),
  z
    .object({
      type: z.literal("set_cell"),
      sheet: z.string().min(1).max(255),
      cell: z.string().regex(/^[A-Z]{1,3}[1-9][0-9]{0,6}$/),
      value: z.union([z.string(), z.number(), z.boolean(), z.null()]),
    })
    .strict(),
  z
    .object({
      type: z.literal("append_row"),
      sheet: z.string().min(1).max(255),
      values: z.array(z.union([z.string(), z.number(), z.boolean(), z.null()])).max(16_384),
    })
    .strict(),
  z
    .object({
      type: z.literal("add_slide"),
      title: z.string().min(1).max(300),
      body: z.string().max(100_000),
    })
    .strict(),
]);

export const editArtifactSchema = z
  .object({
    fileName: z.string().min(1).max(1_024).optional(),
    operations: z.array(artifactEditOperationSchema).min(1).max(1_000),
  })
  .strict();

export type Artifact = z.infer<typeof artifactSchema>;
export type ArtifactLocation = z.infer<typeof artifactLocationSchema>;
export type CanonicalArtifactBlock = z.infer<typeof canonicalArtifactBlockSchema>;
export type CanonicalArtifact = z.infer<typeof canonicalArtifactSchema>;
export type ArtifactEditOperation = z.infer<typeof artifactEditOperationSchema>;
export type EditArtifact = z.infer<typeof editArtifactSchema>;
