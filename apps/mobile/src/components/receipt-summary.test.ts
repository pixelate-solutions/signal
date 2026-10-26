import { describe, expect, it } from "vitest";

import type { Task, TaskEvent } from "@signal/contracts";

import { isQuestionObjective, receiptOutcome } from "./receipt-summary";

const task = {
  objective: "Do I have a notes app on my phone?",
} as Task;

function event(sequence: number, type: TaskEvent["type"], summary: string): TaskEvent {
  return { sequence, type, summary } as TaskEvent;
}

describe("verified receipt summary", () => {
  it("shows the verified answer instead of repeating the question", () => {
    expect(
      receiptOutcome(task, [
        event(18, "verification.succeeded", "No supported notes app is installed on the phone."),
        event(20, "task.completed", "The outcome is verified."),
      ]),
    ).toBe("No supported notes app is installed on the phone.");
  });

  it("falls back to a successful tool outcome when no final verification summary exists", () => {
    expect(
      receiptOutcome(task, [
        event(10, "tool.execution_succeeded", "The phone reports that Apple Notes is installed."),
        event(11, "task.completed", "The outcome is verified."),
      ]),
    ).toBe("The phone reports that Apple Notes is installed.");
  });

  it("recognizes direct questions", () => {
    expect(isQuestionObjective(task.objective)).toBe(true);
    expect(isQuestionObjective("Create a calendar event tomorrow")).toBe(false);
  });
});
