import { describe, expect, it } from "vitest";

import type { ActionRequest, DeviceCommand } from "@signal/contracts";

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
  approvalThreshold: 1,
  approvedUserIds: [],
  rejectedUserIds: [],
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

  it("marks an eligible device command for headless platform delivery", async () => {
    const sink = new DevelopmentPushSink();
    const service = new NotificationService(sink);
    const command: DeviceCommand = {
      commandId: "cmd_demo0001",
      taskId: "tsk_demo0001",
      userId: "usr_demo0001",
      deviceId: "dev_demo0001",
      actionType: "create_signal_note",
      payload: { text: "Approved note" },
      requiredPermission: "secure_notes",
      riskClass: "R1",
      requiresForeground: false,
      requiresConfirmation: false,
      issuedAt: "2026-07-18T12:00:00.000Z",
      expiresAt: "2026-07-18T12:15:00.000Z",
      nonce: "n".repeat(32),
      serverSignature: "s".repeat(64),
    };
    await service.notifyDeviceCommand({
      command,
      tenantId: "ten_demo0001",
      deviceTokenHandle: "push_demo0001",
    });
    expect(sink.messages[0]?.message).toMatchObject({
      backgroundEligible: true,
      deepLink: `signal://device-commands/${command.commandId}`,
    });
  });
});
