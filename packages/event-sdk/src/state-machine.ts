import type { TaskState } from "@signal/contracts";

const transitions: Readonly<Record<TaskState, readonly TaskState[]>> = {
  CREATED: ["QUEUED", "CANCELLED"],
  QUEUED: ["PLANNING", "PAUSED", "CANCELLED", "FAILED"],
  PLANNING: ["RUNNING", "WAITING_USER", "WAITING_EXTERNAL", "PAUSED", "CANCELLED", "FAILED"],
  RUNNING: [
    "WAITING_EXTERNAL",
    "WAITING_USER",
    "RETRY_SCHEDULED",
    "PAUSED",
    "COMPLETED",
    "COMPLETED_WITH_WARNINGS",
    "FAILED",
    "CANCELLED",
  ],
  WAITING_EXTERNAL: ["RUNNING", "RETRY_SCHEDULED", "PAUSED", "FAILED", "CANCELLED"],
  WAITING_USER: ["RUNNING", "PAUSED", "FAILED", "CANCELLED"],
  RETRY_SCHEDULED: ["RUNNING", "WAITING_EXTERNAL", "PAUSED", "FAILED", "CANCELLED"],
  PAUSED: ["QUEUED", "PLANNING", "RUNNING", "WAITING_EXTERNAL", "WAITING_USER", "CANCELLED"],
  COMPLETED: [],
  COMPLETED_WITH_WARNINGS: [],
  FAILED: [],
  CANCELLED: [],
};

export class IllegalTaskTransitionError extends Error {
  public constructor(
    public readonly from: TaskState,
    public readonly to: TaskState,
  ) {
    super(`Illegal task transition: ${from} -> ${to}`);
    this.name = "IllegalTaskTransitionError";
  }
}

export function assertTaskTransition(from: TaskState, to: TaskState): void {
  if (!transitions[from].includes(to)) {
    throw new IllegalTaskTransitionError(from, to);
  }
}

export function allowedTaskTransitions(from: TaskState): readonly TaskState[] {
  return transitions[from];
}
