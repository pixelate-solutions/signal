import nacl from "tweetnacl";
import { describe, expect, it } from "vitest";

import { DeviceCommandProtocol } from "./device-commands.js";

const canonical = (value: unknown): string => {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  return `{${Object.entries(value as Record<string, unknown>)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, item]) => `${JSON.stringify(key)}:${canonical(item)}`)
    .join(",")}}`;
};

describe("signed device command protocol", () => {
  it("accepts a result only from the registered device and before expiry", () => {
    const protocol = new DeviceCommandProtocol(new Uint8Array(32).fill(1));
    const device = nacl.sign.keyPair.fromSeed(new Uint8Array(32).fill(2));
    protocol.registerDevice("dev_demo0001", Buffer.from(device.publicKey).toString("base64url"));
    const command = protocol.issue(
      {
        taskId: "tsk_demo0001",
        userId: "usr_demo0001",
        deviceId: "dev_demo0001",
        actionType: "open_url",
        payload: { url: "https://example.com" },
        requiredPermission: "open_url",
        riskClass: "R1",
        requiresForeground: true,
        requiresConfirmation: true,
      },
      new Date("2026-07-18T12:00:00.000Z"),
    );
    const material = {
      commandId: command.commandId,
      status: "SUCCEEDED" as const,
      result: { opened: true },
      evidenceDigest: `sha256:${"a".repeat(64)}`,
      completedAt: "2026-07-18T12:01:00.000Z",
    };
    const signature = nacl.sign.detached(Buffer.from(canonical(material)), device.secretKey);
    expect(
      protocol.verifyResult({
        ...material,
        deviceSignature: Buffer.from(signature).toString("base64url"),
      }).status,
    ).toBe("SUCCEEDED");
  });

  it("Scenario I: preserves an authenticated UNSUPPORTED result instead of claiming success", () => {
    const protocol = new DeviceCommandProtocol(new Uint8Array(32).fill(3));
    const device = nacl.sign.keyPair.fromSeed(new Uint8Array(32).fill(4));
    protocol.registerDevice("dev_demo0002", Buffer.from(device.publicKey).toString("base64url"));
    const command = protocol.issue(
      {
        taskId: "tsk_demo0002",
        userId: "usr_demo0001",
        deviceId: "dev_demo0002",
        actionType: "compose_message",
        payload: { requestedMode: "silent_background_send" },
        requiredPermission: "sms",
        riskClass: "R2",
        requiresForeground: true,
        requiresConfirmation: true,
      },
      new Date("2026-07-18T12:00:00.000Z"),
    );
    const material = {
      commandId: command.commandId,
      status: "UNSUPPORTED" as const,
      result: {
        reason: "iOS does not permit silent background SMS sending.",
        supportedAlternative: "foreground_compose_sheet",
      },
      evidenceDigest: `sha256:${"b".repeat(64)}`,
      completedAt: "2026-07-18T12:01:00.000Z",
    };
    const signature = nacl.sign.detached(Buffer.from(canonical(material)), device.secretKey);
    expect(
      protocol.verifyResult({
        ...material,
        deviceSignature: Buffer.from(signature).toString("base64url"),
      }),
    ).toMatchObject({
      status: "UNSUPPORTED",
      result: { supportedAlternative: "foreground_compose_sheet" },
    });
  });
});
