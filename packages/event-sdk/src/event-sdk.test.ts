import { describe, expect, it } from "vitest";

import type { TaskEventDraft } from "@signal/contracts";

import {
  assertTaskTransition,
  finalizeEvent,
  renderEventCard,
  sha256,
  verifyEventChain,
} from "./index.js";

const clock = { now: () => new Date("2026-07-18T12:00:00.000Z") };
let nextId = 1;
const ids = { next: () => `evt_demo000${nextId++}` };

const draft: TaskEventDraft = {
  taskId: "tsk_demo0001",
  type: "task.created",
  actor: { type: "user", id: "usr_demo0001" },
  visibility: "user",
  summary: "Task accepted.",
  details: {},
  secretFields: [],
  evidenceIds: [],
};

describe("event SDK", () => {
  it("creates and verifies a digest chain", () => {
    const first = finalizeEvent(draft, 1, null, clock, ids);
    const second = finalizeEvent(
      { ...draft, type: "task.planning_started" },
      2,
      first.digest,
      clock,
      ids,
    );
    expect(verifyEventChain([first, second])).toBe(true);
    expect(verifyEventChain([{ ...first, summary: "tampered" }, second])).toBe(false);
  });

  it("uses canonical object ordering for hashes", () => {
    expect(sha256({ b: 2, a: 1 })).toBe(sha256({ a: 1, b: 2 }));
  });

  it("rejects terminal-state transitions", () => {
    expect(() => assertTaskTransition("COMPLETED", "RUNNING")).toThrow("Illegal task transition");
  });

  it("renders only facts present in an event", () => {
    const event = finalizeEvent(draft, 1, null, clock, ids);
    const card = renderEventCard(event);
    expect(card.title).toBe("Task accepted.");
    expect(card.body).toBe("");
  });
});
