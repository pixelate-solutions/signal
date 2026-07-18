import { randomUUID } from "node:crypto";

import type { ActionRequest } from "@signal/contracts";
import { redact } from "@signal/observability";

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
    private readonly resolveToken: (handle: string) => Promise<string>,
    private readonly fetcher: typeof fetch = fetch,
  ) {}

  public async send(deviceTokenHandle: string, message: PushMessage): Promise<PushDelivery> {
    const [token, bearer] = await Promise.all([
      this.resolveToken(deviceTokenHandle),
      this.accessToken(),
    ]);
    const response = await this.fetcher(
      `https://fcm.googleapis.com/v1/projects/${encodeURIComponent(this.projectId)}/messages:send`,
      {
        method: "POST",
        headers: { authorization: `Bearer ${bearer}`, "content-type": "application/json" },
        body: JSON.stringify({
          message: {
            token,
            notification: { title: message.title, body: message.body },
            data: {
              actionRequestId: message.actionRequestId,
              deepLink: message.deepLink,
            },
            android: {
              collapseKey: message.collapseKey,
              priority: message.urgency === "high" ? "high" : "normal",
            },
            apns: {
              headers: { "apns-collapse-id": message.collapseKey },
              payload: { aps: { "thread-id": message.actionRequestId } },
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
  readonly #deliveries = new Map<string, PushDelivery>();

  public constructor(
    private readonly provider: PushProvider,
    private readonly now: () => Date = () => new Date(),
  ) {}

  public async notifyAction(input: {
    action: ActionRequest;
    userId: string;
    deviceTokenHandle: string;
    quietHours: QuietHours;
  }): Promise<{ status: "DELIVERED" | "SUPPRESSED_QUIET_HOURS"; delivery?: PushDelivery }> {
    const existing = this.#deliveries.get(input.action.id);
    if (existing !== undefined) return { status: "DELIVERED", delivery: existing };
    const urgent = input.action.risk === "R3" || input.action.risk === "R4";
    if (!urgent && inQuietHours(this.now(), input.quietHours)) {
      return { status: "SUPPRESSED_QUIET_HOURS" };
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
    };
    const delivery = await this.provider.send(input.deviceTokenHandle, message);
    this.#deliveries.set(input.action.id, delivery);
    return { status: "DELIVERED", delivery };
  }
}
