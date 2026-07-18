import { describe, expect, it } from "vitest";

import type { Principal } from "@signal/auth-sdk";
import { MEMORY_EMBEDDING_DIMENSIONS, MEMORY_EMBEDDING_VERSION } from "@signal/memory-sdk";
import { InMemoryTenantRecordStore } from "@signal/persistence";

import { MemoryService } from "./index.js";

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

const input = (url: string) => ({
  kind: "semantic_fact",
  subject: "user.current",
  predicate: "work_calls.log_url",
  object: { url },
  canonicalText: `Work calls are logged at ${url}`,
  scope: { type: "user", id: principal.userId },
  sensitivity: "internal",
  validFrom: "2026-07-18T12:00:00.000Z",
  validTo: null,
  expiresAt: null,
  sourceIds: ["msg_demo0001"],
});

describe("durable memory governance", () => {
  it("supersedes the old fact, retrieves the new fact, and removes derivatives on forget", async () => {
    const records = new InMemoryTenantRecordStore();
    const service = new MemoryService(() => new Date("2026-07-18T12:30:00.000Z"), records);
    const oldItem = await service.create(principal, input("https://calls.example.com/old"));
    const active = await service.create(principal, input("https://calls.example.com/team-log"));
    expect(
      (await service.list(principal, true)).find((item) => item.id === oldItem.id)?.status,
    ).toBe("superseded");
    expect(
      (
        await service.retrieve(principal, {
          text: "log my work call",
          scopes: [{ type: "user", id: principal.userId }],
          now: new Date("2026-07-18T12:30:00.000Z"),
        })
      )[0]?.id,
    ).toBe(active.id);
    const derivative = await records.runExclusive(principal.tenantId, (transaction) =>
      transaction.get<{
        embeddingVersion: string;
        embedding: number[];
      }>("memory.derivatives", active.id),
    );
    expect(derivative).toMatchObject({ embeddingVersion: MEMORY_EMBEDDING_VERSION });
    expect(derivative?.embedding).toHaveLength(MEMORY_EMBEDDING_DIMENSIONS);
    expect((await service.delete(principal, active.id)).derivativesRemoved).toBe(2);
    expect(
      await service.retrieve(principal, {
        text: "log my work call",
        scopes: [{ type: "user", id: principal.userId }],
        now: new Date("2026-07-18T12:30:00.000Z"),
      }),
    ).toHaveLength(0);
  });

  it("rejects secret-like memory", async () => {
    const service = new MemoryService();
    await expect(
      service.create(principal, input("https://token_secretabcdefghijkl.example")),
    ).rejects.toThrow("Secret-like");
  });

  it("Scenario J: denies cross-tenant memory reads, writes, and vector-style retrieval", async () => {
    const service = new MemoryService(() => new Date("2026-07-18T12:30:00.000Z"));
    const item = await service.create(principal, input("https://calls.example.com/team-log"));
    const intruder = { ...principal, tenantId: "ten_other0001", userId: "usr_other0001" };
    await expect(service.list(intruder, true)).resolves.toHaveLength(0);
    expect(
      await service.retrieve(intruder, {
        text: "log my work call",
        scopes: [{ type: "user", id: intruder.userId }],
        now: new Date("2026-07-18T12:30:00.000Z"),
      }),
    ).toHaveLength(0);
    await expect(service.update(intruder, item.id, { pinned: true })).rejects.toThrow("not found");
    await expect(service.delete(intruder, item.id)).rejects.toThrow("not found");
  });
});
