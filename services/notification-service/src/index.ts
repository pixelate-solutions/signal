import { createHash } from "node:crypto";
import { randomUUID } from "node:crypto";
import { connect } from "node:http2";

import { importPKCS8, SignJWT } from "jose";

import type { ActionRequest, DeviceCommand } from "@signal/contracts";
import { redact } from "@signal/observability";
import { InMemoryTenantRecordStore, type TenantRecordStore } from "@signal/persistence";

const DELIVERY_NAMESPACE = "notification.deliveries";
const ATTEMPT_NAMESPACE = "notification.attempts";

export type PushMessage = {
  id: string;
  tenantId: string;
  userId: string;
  actionRequestId: string;
  title: string;
  body: string;
  deepLink: string;
  urgency: "normal" | "high";
  collapseKey: string;
  expiresAt: string;
  backgroundEligible: boolean;
};

export type PushDelivery = {
  providerMessageId: string;
  acceptedAt: string;
};

export interface PushProvider {
  send(deviceTokenHandle: string, message: PushMessage): Promise<PushDelivery>;
}

export class DevelopmentPushSink implements PushProvider {
  readonly messages: { deviceTokenHandle: string; message: PushMessage; delivery: PushDelivery }[] =
    [];

  public async send(deviceTokenHandle: string, message: PushMessage): Promise<PushDelivery> {
    const delivery = {
      providerMessageId: `devpush_${randomUUID().replaceAll("-", "")}`,
      acceptedAt: new Date().toISOString(),
    };
    this.messages.push({ deviceTokenHandle, message, delivery });
    return delivery;
  }
}

export class FirebasePushProvider implements PushProvider {
  public constructor(
    private readonly projectId: string,
    private readonly accessToken: () => Promise<string>,
    private readonly resolveToken: (handle: string, message: PushMessage) => Promise<string>,
    private readonly fetcher: typeof fetch = fetch,
  ) {}

  public async send(deviceTokenHandle: string, message: PushMessage): Promise<PushDelivery> {
    const [token, bearer] = await Promise.all([
      this.resolveToken(deviceTokenHandle, message),
      this.accessToken(),
    ]);
    return this.sendResolved(token, message, bearer);
  }

  public async sendResolved(
    token: string,
    message: PushMessage,
    suppliedBearer?: string,
  ): Promise<PushDelivery> {
    const bearer = suppliedBearer ?? (await this.accessToken());
    const response = await this.fetcher(
      `https://fcm.googleapis.com/v1/projects/${encodeURIComponent(this.projectId)}/messages:send`,
      {
        method: "POST",
        headers: { authorization: `Bearer ${bearer}`, "content-type": "application/json" },
        body: JSON.stringify({
          message: {
            token,
            ...(message.backgroundEligible
              ? {}
              : { notification: { title: message.title, body: message.body } }),
            data: {
              actionRequestId: message.actionRequestId,
              deepLink: message.deepLink,
            },
            android: {
              collapseKey: message.collapseKey,
              priority: message.urgency === "high" ? "high" : "normal",
            },
            apns: {
              headers: {
                "apns-collapse-id": message.collapseKey,
                "apns-push-type": message.backgroundEligible ? "background" : "alert",
                "apns-priority": message.backgroundEligible ? "5" : "10",
              },
              payload: {
                aps: message.backgroundEligible
                  ? { "content-available": 1 }
                  : { "thread-id": message.actionRequestId },
              },
            },
          },
        }),
      },
    );
    if (!response.ok) throw new Error(`Push provider returned HTTP ${response.status}.`);
    const body = (await response.json()) as { name?: string };
    if (body.name === undefined) throw new Error("Push provider omitted its message ID.");
    return { providerMessageId: body.name, acceptedAt: new Date().toISOString() };
  }
}

export type ResolvedPushToken = { token: string; platform: "ios" | "android" };

export class ApnsPushProvider {
  #cachedProviderToken: { token: string; expiresAt: number } | undefined;

  public constructor(
    private readonly configuration: {
      teamId: string;
      keyId: string;
      bundleId: string;
      resolvePrivateKey: () => Promise<string>;
      production?: boolean;
    },
  ) {}

  public async sendResolved(token: string, message: PushMessage): Promise<PushDelivery> {
    const authority =
      this.configuration.production === false
        ? "https://api.sandbox.push.apple.com"
        : "https://api.push.apple.com";
    const client = connect(authority);
    const providerToken = await this.providerToken();
    return new Promise<PushDelivery>((resolve, reject) => {
      const request = client.request({
        ":method": "POST",
        ":path": `/3/device/${encodeURIComponent(token)}`,
        authorization: `bearer ${providerToken}`,
        "content-type": "application/json",
        "apns-topic": this.configuration.bundleId,
        "apns-push-type": message.backgroundEligible ? "background" : "alert",
        "apns-priority": message.backgroundEligible ? "5" : message.urgency === "high" ? "10" : "5",
        "apns-expiration": String(Math.floor(new Date(message.expiresAt).getTime() / 1_000)),
        "apns-collapse-id": message.collapseKey,
      });
      let status = 0;
      let providerMessageId = "";
      let responseBody = "";
      request.setEncoding("utf8");
      request.on("response", (headers) => {
        status = Number(headers[":status"] ?? 0);
        providerMessageId = String(headers["apns-id"] ?? "");
      });
      request.on("data", (chunk: string) => {
        responseBody += chunk;
      });
      request.on("error", (error) => {
        client.close();
        reject(error instanceof Error ? error : new Error("The APNs request failed."));
      });
      request.on("end", () => {
        client.close();
        if (status < 200 || status >= 300) {
          reject(new Error(`APNs returned HTTP ${status}: ${responseBody.slice(0, 300)}`));
          return;
        }
        resolve({
          providerMessageId: providerMessageId || `apns_${message.id}`,
          acceptedAt: new Date().toISOString(),
        });
      });
      request.end(
        JSON.stringify({
          aps: {
            ...(message.backgroundEligible
              ? { "content-available": 1 }
              : {
                  alert: { title: message.title, body: message.body },
                  sound: "default",
                  "thread-id": message.actionRequestId,
                }),
          },
          actionRequestId: message.actionRequestId,
          deepLink: message.deepLink,
        }),
      );
    });
  }

  private async providerToken(): Promise<string> {
    const now = Date.now();
    if (this.#cachedProviderToken !== undefined && this.#cachedProviderToken.expiresAt > now) {
      return this.#cachedProviderToken.token;
    }
    const key = await importPKCS8(await this.configuration.resolvePrivateKey(), "ES256");
    const token = await new SignJWT({})
      .setProtectedHeader({ alg: "ES256", kid: this.configuration.keyId })
      .setIssuer(this.configuration.teamId)
      .setIssuedAt()
      .sign(key);
    this.#cachedProviderToken = { token, expiresAt: now + 50 * 60 * 1_000 };
    return token;
  }
}

export class PlatformPushProvider implements PushProvider {
  public constructor(
    private readonly resolveToken: (
      handle: string,
      message: PushMessage,
    ) => Promise<ResolvedPushToken>,
    private readonly providers: {
      firebase: FirebasePushProvider;
      apns: ApnsPushProvider;
    },
  ) {}

  public async send(deviceTokenHandle: string, message: PushMessage): Promise<PushDelivery> {
    const resolved = await this.resolveToken(deviceTokenHandle, message);
    return resolved.platform === "ios"
      ? this.providers.apns.sendResolved(resolved.token, message)
      : this.providers.firebase.sendResolved(resolved.token, message);
  }
}

export type QuietHours = {
  enabled: boolean;
  startLocal: string;
  endLocal: string;
  timezone: string;
};

function localMinutes(now: Date, timezone: string): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: timezone,
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(now);
  const hour = Number(parts.find((part) => part.type === "hour")?.value ?? 0);
  const minute = Number(parts.find((part) => part.type === "minute")?.value ?? 0);
  return hour * 60 + minute;
}

function inQuietHours(now: Date, settings: QuietHours): boolean {
  if (!settings.enabled) return false;
  const parse = (value: string) => {
    const [hour = "0", minute = "0"] = value.split(":");
    return Number(hour) * 60 + Number(minute);
  };
  const current = localMinutes(now, settings.timezone);
  const start = parse(settings.startLocal);
  const end = parse(settings.endLocal);
  return start <= end ? current >= start && current < end : current >= start || current < end;
}

export class NotificationService {
  public constructor(
    private readonly provider: PushProvider,
    private readonly now: () => Date = () => new Date(),
    private readonly records: TenantRecordStore = new InMemoryTenantRecordStore(),
  ) {}

  public async notifyAction(input: {
    action: ActionRequest;
    userId: string;
    deviceTokenHandle: string;
    quietHours: QuietHours;
  }): Promise<{ status: "DELIVERED" | "SUPPRESSED_QUIET_HOURS"; delivery?: PushDelivery }> {
    const deduplicationKey = `${input.action.id}:${createHash("sha256")
      .update(input.deviceTokenHandle)
      .digest("hex")}`;
    const existing = await this.records.runExclusive(input.action.tenantId, async (transaction) =>
      transaction.get<{
        status: "DELIVERED" | "SUPPRESSED_QUIET_HOURS";
        delivery?: PushDelivery;
      }>(DELIVERY_NAMESPACE, deduplicationKey),
    );
    if (existing !== undefined) return existing;

    const urgent = input.action.risk === "R3" || input.action.risk === "R4";
    if (!urgent && inQuietHours(this.now(), input.quietHours)) {
      const suppressed = { status: "SUPPRESSED_QUIET_HOURS" as const };
      return this.records.runExclusive(input.action.tenantId, async (transaction) => {
        const raced = await transaction.get<typeof suppressed>(
          DELIVERY_NAMESPACE,
          deduplicationKey,
        );
        if (raced !== undefined) return raced;
        await transaction.put(DELIVERY_NAMESPACE, deduplicationKey, suppressed);
        return suppressed;
      });
    }

    const sanitized = redact({
      title:
        input.action.type === "APPROVAL" ? "Signal needs your review" : "Signal needs your input",
      body: `A task is waiting for ${input.action.type.toLowerCase().replaceAll("_", " ")}.`,
    });
    const message: PushMessage = {
      id: `ntf_${randomUUID().replaceAll("-", "")}`,
      tenantId: input.action.tenantId,
      userId: input.userId,
      actionRequestId: input.action.id,
      title: String((sanitized as { title: string }).title),
      body: String((sanitized as { body: string }).body),
      deepLink: `signal://tasks/${input.action.taskId}/actions/${input.action.id}`,
      urgency: urgent ? "high" : "normal",
      collapseKey: input.action.id,
      expiresAt: input.action.expiresAt,
      backgroundEligible: false,
    };
    const attemptId = `pat_${randomUUID().replaceAll("-", "")}`;
    await this.records.runExclusive(input.action.tenantId, async (transaction) => {
      await transaction.put(ATTEMPT_NAMESPACE, attemptId, {
        id: attemptId,
        deduplicationKey,
        messageId: message.id,
        actionRequestId: input.action.id,
        deviceTokenDigest: createHash("sha256").update(input.deviceTokenHandle).digest("hex"),
        status: "SENDING",
        attemptedAt: this.now().toISOString(),
      });
    });
    let delivery: PushDelivery;
    try {
      delivery = await this.provider.send(input.deviceTokenHandle, message);
    } catch (error) {
      await this.records.runExclusive(input.action.tenantId, async (transaction) => {
        await transaction.put(ATTEMPT_NAMESPACE, attemptId, {
          id: attemptId,
          deduplicationKey,
          messageId: message.id,
          actionRequestId: input.action.id,
          status: "FAILED",
          failedAt: this.now().toISOString(),
          reason: error instanceof Error ? error.message : "Push delivery failed.",
        });
      });
      throw error;
    }
    const delivered = { status: "DELIVERED" as const, delivery };
    return this.records.runExclusive(input.action.tenantId, async (transaction) => {
      const existing = await transaction.get<{
        status: "DELIVERED" | "SUPPRESSED_QUIET_HOURS";
        delivery?: PushDelivery;
      }>(DELIVERY_NAMESPACE, deduplicationKey);
      if (existing !== undefined) return existing;
      await transaction.put(DELIVERY_NAMESPACE, deduplicationKey, delivered);
      await transaction.put(ATTEMPT_NAMESPACE, attemptId, {
        id: attemptId,
        deduplicationKey,
        messageId: message.id,
        actionRequestId: input.action.id,
        status: "DELIVERED",
        delivery,
        deliveredAt: this.now().toISOString(),
      });
      return delivered;
    });
  }

  public async notifyDeviceCommand(input: {
    command: DeviceCommand;
    tenantId: string;
    deviceTokenHandle: string;
  }): Promise<PushDelivery> {
    const existing = await this.records.runExclusive(input.tenantId, (transaction) =>
      transaction.get<PushDelivery>("notification.device_deliveries", input.command.commandId),
    );
    if (existing !== undefined) return existing;
    const message: PushMessage = {
      id: `ntf_${randomUUID().replaceAll("-", "")}`,
      tenantId: input.tenantId,
      userId: input.command.userId,
      actionRequestId: input.command.commandId,
      title: "Signal device action",
      body: "Open Signal to review a waiting device action.",
      deepLink: `signal://device-commands/${input.command.commandId}`,
      urgency:
        input.command.riskClass === "R3" || input.command.riskClass === "R4" ? "high" : "normal",
      collapseKey: input.command.commandId,
      expiresAt: input.command.expiresAt,
      backgroundEligible: !input.command.requiresForeground && !input.command.requiresConfirmation,
    };
    const delivery = await this.provider.send(input.deviceTokenHandle, message);
    return this.records.runExclusive(input.tenantId, async (transaction) => {
      const raced = await transaction.get<PushDelivery>(
        "notification.device_deliveries",
        input.command.commandId,
      );
      if (raced !== undefined) return raced;
      await transaction.put("notification.device_deliveries", input.command.commandId, delivery);
      return delivery;
    });
  }
}
