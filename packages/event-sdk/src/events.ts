import type { TaskEvent, TaskEventDraft } from "@signal/contracts";

import { sha256 } from "./canonical.js";

export type EventClock = {
  now(): Date;
};

export type EventIdFactory = {
  next(): string;
};

export function finalizeEvent(
  draft: TaskEventDraft,
  sequence: number,
  previousDigest: TaskEvent["previousDigest"],
  clock: EventClock,
  ids: EventIdFactory,
): TaskEvent {
  const base = {
    eventId: ids.next(),
    taskId: draft.taskId,
    sequence,
    type: draft.type,
    occurredAt: clock.now().toISOString(),
    actor: draft.actor,
    visibility: draft.visibility,
    summary: draft.summary,
    details: draft.details,
    secretFields: draft.secretFields,
    evidenceIds: draft.evidenceIds,
    previousDigest,
  };

  return {
    ...base,
    digest: sha256(base),
  };
}

export function verifyEventChain(events: readonly TaskEvent[]): boolean {
  let previous: TaskEvent["previousDigest"] = null;
  let sequence = 1;

  for (const event of events) {
    if (event.sequence !== sequence || event.previousDigest !== previous) {
      return false;
    }
    const { digest, ...base } = event;
    if (sha256(base) !== digest) {
      return false;
    }
    previous = event.digest;
    sequence += 1;
  }
  return true;
}
