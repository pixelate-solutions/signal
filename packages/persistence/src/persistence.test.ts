import { describe, expect, it } from "vitest";

import { LocalEnvelopeCipher } from "./envelope.js";
import { InMemoryObjectStore } from "./object-store.js";
import { InMemoryTenantRecordStore } from "./records.js";

describe("durable persistence primitives", () => {
  it("binds encrypted content to its tenant context", async () => {
    const cipher = new LocalEnvelopeCipher("development-secret-that-is-long-enough");
    const context = { tenantId: "ten_one", recordId: "cred_one" };
    const envelope = await cipher.encrypt(new TextEncoder().encode("secret"), context);
    const decrypted = await cipher.decrypt(envelope, context);
    expect(new TextDecoder().decode(decrypted)).toBe("secret");
    await expect(
      cipher.decrypt(envelope, { tenantId: "ten_two", recordId: "cred_one" }),
    ).rejects.toThrow("context");
  });

  it("isolates tenant records and copies stored values", async () => {
    const store = new InMemoryTenantRecordStore();
    await store.runExclusive("ten_one", async (transaction) => {
      await transaction.put("settings", "usr_one", { enabled: true });
    });
    await expect(
      store.runExclusive("ten_two", (transaction) => transaction.list("settings")),
    ).resolves.toEqual([]);
    await expect(
      store.runExclusive("ten_one", (transaction) => transaction.get("settings", "usr_one")),
    ).resolves.toEqual({ enabled: true });
  });

  it("stores immutable object copies", async () => {
    const store = new InMemoryObjectStore();
    const bytes = new Uint8Array([1, 2, 3]);
    await store.put("artifact", bytes, "application/octet-stream");
    bytes[0] = 9;
    await expect(store.get("artifact")).resolves.toMatchObject({
      body: new Uint8Array([1, 2, 3]),
    });
  });
});
