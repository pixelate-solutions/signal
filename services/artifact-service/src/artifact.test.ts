import { createHash } from "node:crypto";

import { describe, expect, it } from "vitest";

import type { Principal } from "@signal/auth-sdk";

import { ArtifactService } from "./index.js";

const principal: Principal = {
  subject: "test",
  tenantId: "ten_demo0001",
  userId: "usr_demo0001",
  roles: ["owner"],
  scopes: ["*"],
  sessionId: "session_demo",
  authenticatedAt: "2026-07-18T12:00:00.000Z",
  expiresAt: "2026-07-18T13:00:00.000Z",
  deviceId: null,
};

const digest = (bytes: Uint8Array) => `sha256:${createHash("sha256").update(bytes).digest("hex")}`;

describe("artifact upload boundary", () => {
  it("quarantines, verifies, scans, and releases exact bytes", async () => {
    const bytes = Buffer.from("Signal attachment");
    const service = new ArtifactService("http://localhost:3000");
    const upload = await service.createUpload(principal, {
      fileName: "note.txt",
      declaredMimeType: "text/plain",
      sizeBytes: bytes.byteLength,
      checksum: digest(bytes),
      sensitivity: "internal",
    });
    const url = new URL(upload.partUrls[0] ?? "");
    const etag = await service.putPart(
      upload.uploadId,
      url.searchParams.get("token") ?? "",
      1,
      bytes,
    );
    const artifact = await service.completeUpload(principal, upload.uploadId, {
      checksum: digest(bytes),
      parts: [{ partNumber: 1, etag }],
    });
    expect(artifact.scanState).toBe("CLEAN");
    expect(Buffer.from(await service.bytes(principal, artifact.id)).toString()).toBe(
      "Signal attachment",
    );
  });

  it("rejects the standard malware test signature", async () => {
    const bytes = Buffer.from("EICAR-STANDARD-ANTIVIRUS-TEST-FILE");
    const service = new ArtifactService("http://localhost:3000");
    const upload = await service.createUpload(principal, {
      fileName: "bad.txt",
      declaredMimeType: "text/plain",
      sizeBytes: bytes.byteLength,
      checksum: digest(bytes),
    });
    const url = new URL(upload.partUrls[0] ?? "");
    const etag = await service.putPart(
      upload.uploadId,
      url.searchParams.get("token") ?? "",
      1,
      bytes,
    );
    await expect(
      service.completeUpload(principal, upload.uploadId, {
        checksum: digest(bytes),
        parts: [{ partNumber: 1, etag }],
      }),
    ).rejects.toThrow("malware");
  });

  it("Scenario J: denies cross-tenant artifact metadata and byte access", async () => {
    const bytes = Buffer.from("Tenant-private artifact");
    const service = new ArtifactService("http://localhost:3000");
    const upload = await service.createUpload(principal, {
      fileName: "private.txt",
      declaredMimeType: "text/plain",
      sizeBytes: bytes.byteLength,
      checksum: digest(bytes),
    });
    const url = new URL(upload.partUrls[0] ?? "");
    const etag = await service.putPart(
      upload.uploadId,
      url.searchParams.get("token") ?? "",
      1,
      bytes,
    );
    const artifact = await service.completeUpload(principal, upload.uploadId, {
      checksum: digest(bytes),
      parts: [{ partNumber: 1, etag }],
    });
    const intruder = { ...principal, tenantId: "ten_other0001", userId: "usr_other0001" };
    await expect(service.get(intruder, artifact.id)).rejects.toThrow("not found");
    await expect(service.bytes(intruder, artifact.id)).rejects.toThrow("not found");
  });
});
