import { describe, expect, it } from "vitest";

import type { ActionRequest } from "@signal/contracts";

import { DevelopmentPushSink, NotificationService } from "./index.js";

const action: ActionRequest = {
  id: "act_demo0001",
  tenantId: "ten_demo0001",
  taskId: "tsk_demo0001",
  type: "APPROVAL",
  title: "Transfer secret account data",
  description: "Sensitive material must not be copied into push.",
  materialPayload: { account: "private" },
  materialDigest: `sha256:${"a".repeat(64)}`,
  risk: "R2",
  options: [],
  approverUserIds: ["usr_demo0001"],
  state: "PENDING",
  requiresRecentAuth: false,
  expiresAt: "2026-07-18T14:00:00.000Z",
  createdAt: "2026-07-18T12:00:00.000Z",
  respondedAt: null,
};

describe("notification service", () => {
  it("sends one privacy-safe push after a durable action exists", async () => {
    const sink = new DevelopmentPushSink();
    const service = new NotificationService(sink, () => new Date("2026-07-18T12:10:00.000Z"));
    const input = {
      action,
      userId: "usr_demo0001",
      deviceTokenHandle: "push_demo0001",
      quietHours: { enabled: false, startLocal: "22:00", endLocal: "07:00", timezone: "UTC" },
    };
    await service.notifyAction(input);
    await service.notifyAction(input);
    expect(sink.messages).toHaveLength(1);
    expect(JSON.stringify(sink.messages)).not.toContain("secret account data");
    expect(sink.messages[0]?.message.deepLink).toContain(action.id);
  });

  it("suppresses nonurgent delivery during quiet hours while leaving the action durable", async () => {
    const sink = new DevelopmentPushSink();
    const service = new NotificationService(sink, () => new Date("2026-07-18T23:00:00.000Z"));
    await expect(
      service.notifyAction({
        action,
        userId: "usr_demo0001",
        deviceTokenHandle: "push_demo0001",
        quietHours: { enabled: true, startLocal: "22:00", endLocal: "07:00", timezone: "UTC" },
      }),
    ).resolves.toEqual({ status: "SUPPRESSED_QUIET_HOURS" });
    expect(sink.messages).toHaveLength(0);
  });
});
