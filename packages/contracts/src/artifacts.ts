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

export type Artifact = z.infer<typeof artifactSchema>;
