import { describe, expect, it } from "vitest";

import {
  actionResponseInputSchema,
  createMessageSchema,
  deviceCommandSchema,
  taskEventSchema,
  taskStateSchema,
} from "./index.js";

describe("public contracts", () => {
  it("rejects undocumented task states", () => {
    expect(taskStateSchema.safeParse("DONE").success).toBe(false);
  });

  it("requires a digest on an approval response", () => {
    expect(
      actionResponseInputSchema.safeParse({
        response: "APPROVE",
      }).success,
    ).toBe(false);
  });

  it("accepts a text objective", () => {
    expect(
      createMessageSchema.parse({
        content: [{ type: "text", text: "Research the carrier and prepare the change." }],
      }).content,
    ).toHaveLength(1);
  });

  it("requires chained event digests", () => {
    const result = taskEventSchema.safeParse({
      eventId: "evt_12345678",
      taskId: "tsk_12345678",
      sequence: 1,
      type: "task.created",
      occurredAt: "2026-07-18T12:00:00.000Z",
      actor: { type: "user", id: "usr_12345678" },
      visibility: "user",
      summary: "Task accepted.",
      details: {},
      secretFields: [],
      evidenceIds: [],
      digest: "not-a-digest",
      previousDigest: null,
    });
    expect(result.success).toBe(false);
  });

  it("requires signed, expiring device commands", () => {
    expect(
      deviceCommandSchema.safeParse({
        commandId: "cmd_12345678",
        taskId: "tsk_12345678",
        userId: "usr_12345678",
        deviceId: "dev_12345678",
        actionType: "open_url",
        payload: { url: "https://example.com" },
        requiredPermission: "open_url",
        riskClass: "R0",
        requiresForeground: false,
        requiresConfirmation: false,
        issuedAt: "2026-07-18T12:00:00.000Z",
        expiresAt: "2026-07-18T12:05:00.000Z",
        nonce: "a".repeat(32),
      }).success,
    ).toBe(false);
  });
});
