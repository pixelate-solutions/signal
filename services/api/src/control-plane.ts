import { randomUUID } from "node:crypto";

import { DeviceCommandProtocol, type Principal } from "@signal/auth-sdk";
import type { CredentialBroker } from "@signal/connection-service";
import {
  deviceRegistrationSchema,
  settingsSchema,
  updateSettingsSchema,
  type DeviceRegistration,
  type DeviceCommand,
  type DeviceCommandResult,
  type Settings,
} from "@signal/contracts";
import type { NotificationService } from "@signal/notification-service";
import { InMemoryTenantRecordStore, type TenantRecordStore } from "@signal/persistence";

const SETTINGS_NAMESPACE = "account.settings";
const DEVICE_NAMESPACE = "device.registrations";
const RESULT_NAMESPACE = "device.results";
const COMMAND_NAMESPACE = "device.commands";

function defaultSettings(): Settings {
  return settingsSchema.parse({
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
      // ALLOW means "do not add a stricter user override"; the platform still
      // requires a distinct multi-party quorum for R4 operations.
      R4: "ALLOW",
    },
    disabledCapabilityClasses: [],
    notifications: {
      actionRequired: true,
      reminders: true,
      taskCompletion: true,
      taskFailure: true,
      securityEvents: true,
    },
    sensitiveMemory: "confirm",
    modelDataPolicy: "minimum_required",
    processingRegion: "automatic",
    developerMode: false,
    retentionDays: 365,
    updatedAt: new Date().toISOString(),
  });
}

export class SettingsConflictError extends Error {
  public constructor() {
    super("Settings changed on another client. Refresh before saving again.");
    this.name = "SettingsConflictError";
  }
}

export class SettingsManager {
  public constructor(private readonly store: TenantRecordStore = new InMemoryTenantRecordStore()) {}

  public async get(principal: Principal): Promise<Settings> {
    return this.store.runExclusive(principal.tenantId, async (transaction) => {
      const existing = await transaction.get<Settings>(SETTINGS_NAMESPACE, principal.userId);
      if (existing !== undefined) {
        const normalized = settingsSchema.parse({ ...defaultSettings(), ...existing });
        if (JSON.stringify(normalized) !== JSON.stringify(existing)) {
          await transaction.put(SETTINGS_NAMESPACE, principal.userId, normalized);
        }
        return normalized;
      }
      const created = defaultSettings();
      await transaction.put(SETTINGS_NAMESPACE, principal.userId, created);
      return created;
    });
  }

  public async update(principal: Principal, rawInput: unknown): Promise<Settings> {
    const input = updateSettingsSchema.parse(rawInput);
    return this.store.runExclusive(principal.tenantId, async (transaction) => {
      const existing = await transaction.get<Settings>(SETTINGS_NAMESPACE, principal.userId);
      const current =
        existing === undefined
          ? defaultSettings()
          : settingsSchema.parse({ ...defaultSettings(), ...existing });
      if (input.expectedVersion !== current.version) throw new SettingsConflictError();
      const { expectedVersion: _expectedVersion, ...patch } = input;
      const updated = settingsSchema.parse({
        ...current,
        ...patch,
        version: current.version + 1,
        updatedAt: new Date().toISOString(),
      });
      await transaction.put(SETTINGS_NAMESPACE, principal.userId, updated);
      return updated;
    });
  }
}

export type RegisteredDevice = Omit<DeviceRegistration, "pushToken"> & {
  id: string;
  tenantId: string;
  userId: string;
  pushTokenHandle: string | null;
  permissions: Record<string, "granted" | "denied" | "prompt">;
  status: "active" | "revoked";
  registeredAt: string;
  lastSeenAt: string;
};

export class DeviceRegistry {
  public constructor(
    private readonly store: TenantRecordStore = new InMemoryTenantRecordStore(),
    private readonly credentials?: CredentialBroker,
    private readonly protocol: DeviceCommandProtocol = new DeviceCommandProtocol(),
    private readonly notifications?: NotificationService,
  ) {}

  public get serverPublicKey(): string {
    return this.protocol.serverPublicKey;
  }

  public async register(principal: Principal, rawInput: unknown): Promise<RegisteredDevice> {
    const input = deviceRegistrationSchema.parse(rawInput);
    const existing = await this.store.runExclusive(principal.tenantId, async (transaction) =>
      (await transaction.list<RegisteredDevice>(DEVICE_NAMESPACE)).find(
        (device) => device.userId === principal.userId && device.publicKey === input.publicKey,
      ),
    );
    const { pushToken, ...publicRegistration } = input;
    let pushTokenHandle = existing?.pushTokenHandle ?? null;
    if (pushToken !== null) {
      if (this.credentials === undefined) {
        throw new Error("Encrypted push-token storage is unavailable.");
      }
      if (pushTokenHandle === null) {
        pushTokenHandle = await this.credentials.create(
          {
            tenantId: principal.tenantId,
            ownerUserId: principal.userId,
            provider: "firebase",
            secretType: "push_token",
          },
          JSON.stringify({ token: pushToken, platform: input.platform }),
        );
      } else {
        await this.credentials.rotate(
          pushTokenHandle,
          principal.tenantId,
          JSON.stringify({ token: pushToken, platform: input.platform }),
        );
      }
    }
    const now = new Date().toISOString();
    const device: RegisteredDevice = {
      id: existing?.id ?? `dev_${randomUUID().replaceAll("-", "")}`,
      tenantId: principal.tenantId,
      userId: principal.userId,
      ...publicRegistration,
      pushTokenHandle,
      permissions: existing?.permissions ?? {},
      status: "active",
      registeredAt: existing?.registeredAt ?? now,
      lastSeenAt: now,
    };
    return this.store.runExclusive(principal.tenantId, async (transaction) => {
      await transaction.put(DEVICE_NAMESPACE, device.id, device);
      return device;
    });
  }

  public async list(principal: Principal): Promise<RegisteredDevice[]> {
    return this.store.runExclusive(principal.tenantId, async (transaction) =>
      (await transaction.list<RegisteredDevice>(DEVICE_NAMESPACE)).filter(
        (device) => device.userId === principal.userId,
      ),
    );
  }

  public async updatePermissions(
    principal: Principal,
    deviceId: string,
    permissions: Record<string, "granted" | "denied" | "prompt">,
  ): Promise<RegisteredDevice> {
    return this.store.runExclusive(principal.tenantId, async (transaction) => {
      const device = await transaction.get<RegisteredDevice>(DEVICE_NAMESPACE, deviceId);
      if (device === undefined || device.userId !== principal.userId) {
        throw new Error("Device not found.");
      }
      const updated = { ...device, permissions, lastSeenAt: new Date().toISOString() };
      await transaction.put(DEVICE_NAMESPACE, deviceId, updated);
      return updated;
    });
  }

  public async revoke(principal: Principal, deviceId: string): Promise<RegisteredDevice> {
    const current = await this.store.runExclusive(principal.tenantId, (transaction) =>
      transaction.get<RegisteredDevice>(DEVICE_NAMESPACE, deviceId),
    );
    if (current === undefined || current.userId !== principal.userId) {
      throw new Error("Device not found.");
    }
    if (current.pushTokenHandle !== null && this.credentials !== undefined) {
      await this.credentials.revoke(current.pushTokenHandle, principal.tenantId);
    }
    return this.store.runExclusive(principal.tenantId, async (transaction) => {
      const device = await transaction.get<RegisteredDevice>(DEVICE_NAMESPACE, deviceId);
      if (device === undefined || device.userId !== principal.userId) {
        throw new Error("Device not found.");
      }
      const updated = {
        ...device,
        status: "revoked" as const,
        pushTokenHandle: null,
        lastSeenAt: new Date().toISOString(),
      };
      await transaction.put(DEVICE_NAMESPACE, deviceId, updated);
      return updated;
    });
  }

  public async recordResult(principal: Principal, commandId: string, rawInput: unknown) {
    const stored = await this.store.runExclusive(principal.tenantId, (transaction) =>
      transaction.get<StoredDeviceCommand>(COMMAND_NAMESPACE, commandId),
    );
    if (stored === undefined || stored.command.userId !== principal.userId) {
      throw new Error("Device command not found.");
    }
    const device = await this.store.runExclusive(principal.tenantId, (transaction) =>
      transaction.get<RegisteredDevice>(DEVICE_NAMESPACE, stored.command.deviceId),
    );
    if (device === undefined || device.status !== "active") {
      throw new Error("The command device is no longer active.");
    }
    const result = this.protocol.verifyResultFor(stored.command, device.publicKey, {
      ...(typeof rawInput === "object" && rawInput !== null ? rawInput : {}),
      commandId,
    });
    return this.store.runExclusive(principal.tenantId, async (transaction) => {
      const existing = await transaction.get(RESULT_NAMESPACE, commandId);
      if (existing !== undefined && JSON.stringify(existing) !== JSON.stringify(result)) {
        throw new SettingsConflictError();
      }
      await transaction.put(RESULT_NAMESPACE, commandId, result);
      await transaction.put(COMMAND_NAMESPACE, commandId, {
        ...stored,
        status: "COMPLETED",
        result,
        completedAt: result.completedAt,
        updatedAt: new Date().toISOString(),
      } satisfies StoredDeviceCommand);
      return result;
    });
  }

  public async issue(input: IssueDeviceCommand): Promise<StoredDeviceCommand> {
    const existing = await this.store.runExclusive(input.tenantId, async (transaction) =>
      (await transaction.list<StoredDeviceCommand>(COMMAND_NAMESPACE)).find(
        (candidate) =>
          candidate.command.taskId === input.taskId &&
          candidate.idempotencyKey === input.idempotencyKey,
      ),
    );
    if (existing !== undefined) return existing;
    const device = await this.store.runExclusive(input.tenantId, async (transaction) => {
      const devices = await transaction.list<RegisteredDevice>(DEVICE_NAMESPACE);
      return devices.find(
        (candidate) =>
          candidate.userId === input.userId &&
          candidate.status === "active" &&
          (input.deviceId === undefined || candidate.id === input.deviceId) &&
          candidate.capabilities.includes(input.actionType),
      );
    });
    if (device === undefined) throw new Error("No active device supports this action.");
    if (device.platform === "ios" && input.actionType === "android_intent") {
      throw new Error("Android intents cannot be delivered to an iOS device.");
    }
    const permission = device.permissions[input.requiredPermission] ?? "prompt";
    if (permission === "denied") throw new Error("The required device permission is denied.");
    this.protocol.registerDevice(device.id, device.publicKey);
    const requiresForeground =
      device.appVariant === "consumer" && input.actionType !== "create_signal_note"
        ? true
        : input.requiresForeground;
    const command = this.protocol.issue({
      taskId: input.taskId,
      userId: input.userId,
      deviceId: device.id,
      actionType: input.actionType,
      payload: input.payload,
      requiredPermission: input.requiredPermission,
      riskClass: input.riskClass,
      requiresForeground,
      requiresConfirmation: input.requiresConfirmation || permission !== "granted",
      ttlSeconds: input.ttlSeconds ?? 900,
    });
    const now = new Date().toISOString();
    const stored: StoredDeviceCommand = {
      command,
      tenantId: input.tenantId,
      idempotencyKey: input.idempotencyKey,
      status: "QUEUED",
      result: null,
      deliveryError: null,
      createdAt: now,
      updatedAt: now,
      deliveredAt: null,
      completedAt: null,
    };
    await this.store.runExclusive(input.tenantId, async (transaction) => {
      await transaction.put(COMMAND_NAMESPACE, command.commandId, stored);
    });
    if (device.pushTokenHandle !== null && this.notifications !== undefined) {
      try {
        await this.notifications.notifyDeviceCommand({
          command,
          tenantId: input.tenantId,
          deviceTokenHandle: device.pushTokenHandle,
        });
      } catch (error) {
        stored.deliveryError = error instanceof Error ? error.message : "Push delivery failed.";
        await this.store.runExclusive(input.tenantId, async (transaction) => {
          await transaction.put(COMMAND_NAMESPACE, command.commandId, stored);
        });
      }
    }
    return stored;
  }

  public async pending(principal: Principal, deviceId: string): Promise<DeviceCommand[]> {
    const device = await this.store.runExclusive(principal.tenantId, (transaction) =>
      transaction.get<RegisteredDevice>(DEVICE_NAMESPACE, deviceId),
    );
    if (device === undefined || device.userId !== principal.userId || device.status !== "active") {
      throw new Error("Device not found.");
    }
    const now = new Date();
    return this.store.runExclusive(principal.tenantId, async (transaction) => {
      const records = await transaction.list<StoredDeviceCommand>(COMMAND_NAMESPACE);
      const pending: DeviceCommand[] = [];
      for (const record of records) {
        if (record.command.deviceId !== deviceId || record.status === "COMPLETED") continue;
        if (new Date(record.command.expiresAt) <= now) {
          await transaction.put(COMMAND_NAMESPACE, record.command.commandId, {
            ...record,
            status: "EXPIRED",
            updatedAt: now.toISOString(),
          } satisfies StoredDeviceCommand);
          continue;
        }
        pending.push(record.command);
        await transaction.put(COMMAND_NAMESPACE, record.command.commandId, {
          ...record,
          status: "DELIVERED",
          deliveredAt: record.deliveredAt ?? now.toISOString(),
          updatedAt: now.toISOString(),
        } satisfies StoredDeviceCommand);
      }
      return pending;
    });
  }

  public async command(
    tenantId: string,
    commandId: string,
  ): Promise<StoredDeviceCommand | undefined> {
    return this.store.runExclusive(tenantId, (transaction) =>
      transaction.get<StoredDeviceCommand>(COMMAND_NAMESPACE, commandId),
    );
  }
}

export type IssueDeviceCommand = {
  tenantId: string;
  userId: string;
  taskId: string;
  deviceId?: string | undefined;
  actionType: DeviceCommand["actionType"];
  payload: DeviceCommand["payload"];
  requiredPermission: string;
  riskClass: DeviceCommand["riskClass"];
  requiresForeground: boolean;
  requiresConfirmation: boolean;
  ttlSeconds?: number | undefined;
  idempotencyKey: string;
};

export type StoredDeviceCommand = {
  command: DeviceCommand;
  tenantId: string;
  idempotencyKey: string;
  status: "QUEUED" | "DELIVERED" | "COMPLETED" | "EXPIRED";
  result: DeviceCommandResult | null;
  deliveryError: string | null;
  createdAt: string;
  updatedAt: string;
  deliveredAt: string | null;
  completedAt: string | null;
};
