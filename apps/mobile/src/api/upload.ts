import * as Crypto from "expo-crypto";

import type { Artifact } from "@signal/contracts";

import { signalApi } from "./client";

export type LocalAttachment = {
  uri: string;
  name: string;
  mimeType: string;
  size: number;
};

function hex(buffer: ArrayBuffer): string {
  return [...new Uint8Array(buffer)].map((value) => value.toString(16).padStart(2, "0")).join("");
}

export async function uploadAttachment(attachment: LocalAttachment): Promise<Artifact> {
  const source = await fetch(attachment.uri);
  if (!source.ok) throw new Error(`Could not read ${attachment.name}.`);
  const blob = await source.blob();
  const bytes = new Uint8Array(await blob.arrayBuffer());
  const digest = await Crypto.digest(Crypto.CryptoDigestAlgorithm.SHA256, bytes);
  const checksum = `sha256:${hex(digest)}`;
  const session = await signalApi.createUpload({
    fileName: attachment.name,
    declaredMimeType: attachment.mimeType,
    sizeBytes: attachment.size,
    checksum,
  });
  const partUrl = session.partUrls[0];
  if (partUrl === undefined) throw new Error("The upload session did not provide a destination.");
  const upload = await fetch(partUrl, {
    method: "PUT",
    headers: { "content-type": "application/octet-stream", "x-signal-checksum": checksum },
    body: blob,
  });
  if (!upload.ok) throw new Error(`Upload failed with HTTP ${upload.status}.`);
  return signalApi.completeUpload(
    session.uploadId,
    checksum,
    upload.headers.get("etag") ?? checksum,
  );
}
