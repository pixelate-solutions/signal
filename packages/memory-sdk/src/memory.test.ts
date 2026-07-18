import { describe, expect, it } from "vitest";

import type { MemoryItem } from "@signal/contracts";

import { assertMemorySafe, extractExplicitMemory, rankMemories } from "./index.js";

const now = new Date("2026-07-18T12:00:00.000Z");

describe("memory governance", () => {
  it("extracts the canonical work-call URL from an explicit statement", () => {
    expect(
      extractExplicitMemory(
        "I log my work calls at https://calls.example.com/team-log.",
        "msg_demo0001",
        "usr_demo0001",
        now,
      ),
    ).toMatchObject({
      kind: "semantic_fact",
      subject: "user.current",
      predicate: "work_calls.log_url",
      object: { url: "https://calls.example.com/team-log" },
      confidence: 0.99,
    });
  });

  it("does not save incidental text", () => {
    expect(
      extractExplicitMemory(
        "Someone mentioned https://calls.example.com/team-log.",
        "msg_demo0001",
        "usr_demo0001",
        now,
      ),
    ).toBeUndefined();
  });

  it("rejects secret-like memory", () => {
    expect(() => assertMemorySafe("remember my password", { value: "hunter2" })).toThrow(
      "cannot be stored",
    );
  });

  it("retrieves the fact under different phrasing and excludes expired values", () => {
    const active: MemoryItem = {
      id: "mem_demo0001",
      tenantId: "ten_demo0001",
      userId: "usr_demo0001",
      kind: "semantic_fact",
      subject: "user.current",
      predicate: "work_calls.log_url",
      object: { url: "https://calls.example.com/team-log" },
      canonicalText: "Work calls are logged at https://calls.example.com/team-log",
      scope: { type: "user", id: "usr_demo0001" },
      explicitness: "explicit",
      confidence: 0.99,
      sensitivity: "internal",
      validFrom: "2026-01-01T00:00:00.000Z",
      validTo: null,
      expiresAt: null,
      status: "active",
      pinned: false,
      sourceIds: ["msg_demo0001"],
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
      lastUsedAt: null,
    };
    const expired = { ...active, id: "mem_demo0002", expiresAt: "2026-01-02T00:00:00.000Z" };
    const result = rankMemories(
      {
        text: "Put this in my call tracker",
        tenantId: "ten_demo0001",
        userId: "usr_demo0001",
        scopes: [{ type: "user", id: "usr_demo0001" }],
        now,
      },
      [expired, active],
    );
    expect(result.map((memory) => memory.id)).toEqual(["mem_demo0001"]);
  });
});
