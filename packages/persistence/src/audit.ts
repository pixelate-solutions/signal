import { createHash, randomUUID } from "node:crypto";

import type { TenantRecordTransaction } from "./records.js";

export type DurableAuditEvent = {
  id: string;
  actor: { type: string; id: string };
  action: string;
  resource: { type: string; id: string };
  payloadDigest: string;
  previousDigest: string | null;
  eventDigest: string;
  occurredAt: string;
};

function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical);
  if (value !== null && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, item]) => [key, canonical(item)]),
    );
  }
  return value;
}

function sha256(value: unknown): string {
  return `sha256:${createHash("sha256")
    .update(JSON.stringify(canonical(value)))
    .digest("hex")}`;
}

export async function appendAuditEvent(
  transaction: TenantRecordTransaction,
  draft: {
    id?: string;
    actor: DurableAuditEvent["actor"];
    action: string;
    resource: DurableAuditEvent["resource"];
    payloadDigest?: string;
    payload?: unknown;
    occurredAt?: string;
  },
): Promise<DurableAuditEvent> {
  const head = await transaction.get<{ digest: string }>("audit.chain", "head");
  const unsigned = {
    id: draft.id ?? `aud_${randomUUID().replaceAll("-", "")}`,
    actor: draft.actor,
    action: draft.action,
    resource: draft.resource,
    payloadDigest: draft.payloadDigest ?? sha256(draft.payload ?? null),
    previousDigest: head?.digest ?? null,
    occurredAt: draft.occurredAt ?? new Date().toISOString(),
  };
  const event: DurableAuditEvent = { ...unsigned, eventDigest: sha256(unsigned) };
  await transaction.put("audit.events", event.id, event);
  await transaction.put("audit.chain", "head", {
    eventId: event.id,
    digest: event.eventDigest,
    updatedAt: event.occurredAt,
  });
  return event;
}

export function verifyAuditChain(events: readonly DurableAuditEvent[]): boolean {
  if (events.length === 0) return true;
  const byPrevious = new Map<string | null, DurableAuditEvent[]>();
  for (const event of events) {
    const children = byPrevious.get(event.previousDigest) ?? [];
    children.push(event);
    byPrevious.set(event.previousDigest, children);
  }
  let previous: string | null = null;
  let visited = 0;
  while (visited < events.length) {
    const children: DurableAuditEvent[] = byPrevious.get(previous) ?? [];
    if (children.length !== 1) return false;
    const event = children[0];
    if (event === undefined) return false;
    const { eventDigest, ...unsigned }: DurableAuditEvent = event;
    if (eventDigest !== sha256(unsigned)) return false;
    previous = eventDigest;
    visited += 1;
  }
  return visited === events.length;
}
