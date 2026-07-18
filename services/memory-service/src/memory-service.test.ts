import { describe, expect, it } from "vitest";

import type { Principal } from "@signal/auth-sdk";

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
  it("supersedes the old fact, retrieves the new fact, and removes derivatives on forget", () => {
    const service = new MemoryService(() => new Date("2026-07-18T12:30:00.000Z"));
    const oldItem = service.create(principal, input("https://calls.example.com/old"));
    const active = service.create(principal, input("https://calls.example.com/team-log"));
    expect(service.list(principal, true).find((item) => item.id === oldItem.id)?.status).toBe(
      "superseded",
    );
    expect(
      service.retrieve(principal, {
        text: "log my work call",
        scopes: [{ type: "user", id: principal.userId }],
        now: new Date("2026-07-18T12:30:00.000Z"),
      })[0]?.id,
    ).toBe(active.id);
    expect(service.delete(principal, active.id).derivativesRemoved).toBe(2);
    expect(
      service.retrieve(principal, {
        text: "log my work call",
        scopes: [{ type: "user", id: principal.userId }],
        now: new Date("2026-07-18T12:30:00.000Z"),
      }),
    ).toHaveLength(0);
  });

  it("rejects secret-like memory", () => {
    const service = new MemoryService();
    expect(() =>
      service.create(principal, input("https://token_secretabcdefghijkl.example")),
    ).toThrow("Secret-like");
  });

  it("Scenario J: denies cross-tenant memory reads, writes, and vector-style retrieval", () => {
    const service = new MemoryService(() => new Date("2026-07-18T12:30:00.000Z"));
    const item = service.create(principal, input("https://calls.example.com/team-log"));
    const intruder = { ...principal, tenantId: "ten_other0001", userId: "usr_other0001" };
    expect(service.list(intruder, true)).toHaveLength(0);
    expect(
      service.retrieve(intruder, {
        text: "log my work call",
        scopes: [{ type: "user", id: intruder.userId }],
        now: new Date("2026-07-18T12:30:00.000Z"),
      }),
    ).toHaveLength(0);
    expect(() => service.update(intruder, item.id, { pinned: true })).toThrow("another tenant");
    expect(() => service.delete(intruder, item.id)).toThrow("another tenant");
  });
});
