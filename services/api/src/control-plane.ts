import { randomUUID } from "node:crypto";

import type { Principal } from "@signal/auth-sdk";
import {
  deviceCommandResultSchema,
  deviceRegistrationSchema,
  settingsSchema,
  updateSettingsSchema,
  type DeviceRegistration,
  type Settings,
} from "@signal/contracts";

export class SettingsConflictError extends Error {
  public constructor() {
    super("Settings changed on another client. Refresh before saving again.");
    this.name = "SettingsConflictError";
  }
}

export class SettingsManager {
  readonly #settings = new Map<string, Settings>();

  public get(principal: Principal): Settings {
    const existing = this.#settings.get(principal.userId);
    if (existing !== undefined) return existing;
    const created = settingsSchema.parse({
      version: 0,
      locale: "en-US",
      timezone: "UTC",
      implicitMemory: false,
      biometricLock: false,
      quietHours: { enabled: false, startLocal: "22:00", endLocal: "07:00" },
      approvalDefaults: {
        R0: "ALLOW",
        R1: "ALLOW_WITH_LIMITS",
        R2: "REQUIRE_APPROVAL",
        R3: "REQUIRE_APPROVAL",
        R4: "DENY",
      },
      disabledCapabilityClasses: [],
      retentionDays: 365,
      updatedAt: new Date().toISOString(),
    });
    this.#settings.set(principal.userId, created);
    return created;
  }

  public update(principal: Principal, rawInput: unknown): Settings {
    const input = updateSettingsSchema.parse(rawInput);
    const current = this.get(principal);
    if (input.expectedVersion !== current.version) throw new SettingsConflictError();
    const { expectedVersion: _expectedVersion, ...patch } = input;
    const updated = settingsSchema.parse({
      ...current,
      ...patch,
      version: current.version + 1,
      updatedAt: new Date().toISOString(),
    });
    this.#settings.set(principal.userId, updated);
    return updated;
  }
}

type RegisteredDevice = DeviceRegistration & {
  id: string;
  tenantId: string;
  userId: string;
  registeredAt: string;
  lastSeenAt: string;
};

export class DeviceRegistry {
  readonly #devices = new Map<string, RegisteredDevice>();
  readonly #results = new Map<string, unknown>();

  public register(principal: Principal, rawInput: unknown): RegisteredDevice {
    const input = deviceRegistrationSchema.parse(rawInput);
    const now = new Date().toISOString();
    const device: RegisteredDevice = {
      id: `dev_${randomUUID().replaceAll("-", "")}`,
      tenantId: principal.tenantId,
      userId: principal.userId,
      ...input,
      registeredAt: now,
      lastSeenAt: now,
    };
    this.#devices.set(device.id, device);
    return device;
  }

  public recordResult(principal: Principal, commandId: string, rawInput: unknown) {
    const result = deviceCommandResultSchema.parse({
      ...(typeof rawInput === "object" && rawInput !== null ? rawInput : {}),
      commandId,
    });
    const key = `${principal.tenantId}:${commandId}`;
    const existing = this.#results.get(key);
    if (existing !== undefined && JSON.stringify(existing) !== JSON.stringify(result)) {
      throw new SettingsConflictError();
    }
    this.#results.set(key, result);
    return result;
  }
}
