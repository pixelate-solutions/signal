import type { TaskEvent } from "@signal/contracts";

export type EventCardTone = "neutral" | "progress" | "success" | "warning" | "danger" | "action";

export type EventCard = {
  id: string;
  sequence: number;
  eyebrow: string;
  title: string;
  body: string;
  tone: EventCardTone;
  expandable: boolean;
  evidenceIds: readonly string[];
};

const labels: Partial<Record<TaskEvent["type"], string>> = {
  "task.created": "Task accepted",
  "task.plan_created": "Plan ready",
  "tool.execution_started": "Tool running",
  "tool.execution_succeeded": "Tool finished",
  "tool.execution_failed": "Tool failed",
  "tool.retry_scheduled": "Retry scheduled",
  "route.changed": "Route adapted",
  "connection.required": "Connection required",
  "approval.requested": "Your approval is needed",
  "approval.responded": "Decision recorded",
  "external.wait_started": "Waiting externally",
  "verification.started": "Verifying outcome",
  "verification.succeeded": "Outcome verified",
  "verification.failed": "Verification failed",
  "task.completed": "Completed",
  "task.failed": "Task failed",
  "task.cancelled": "Task cancelled",
};

function toneFor(type: TaskEvent["type"]): EventCardTone {
  if (
    type === "approval.requested" ||
    type === "connection.required" ||
    type === "browser.takeover_requested"
  ) {
    return "action";
  }
  if (type.endsWith("failed") || type === "artifact.quarantined") {
    return "danger";
  }
  if (type.endsWith("succeeded") || type === "task.completed" || type === "tests.passed") {
    return "success";
  }
  if (type.includes("retry") || type.includes("wait") || type === "route.changed") {
    return "warning";
  }
  if (type.endsWith("started") || type === "task.state_changed") {
    return "progress";
  }
  return "neutral";
}

export function renderEventCard(event: TaskEvent): EventCard {
  return {
    id: event.eventId,
    sequence: event.sequence,
    eyebrow: labels[event.type] ?? event.type.replaceAll(".", " · "),
    title: event.summary,
    body: typeof event.details["userMessage"] === "string" ? event.details["userMessage"] : "",
    tone: toneFor(event.type),
    expandable: Object.keys(event.details).length > 0 || event.evidenceIds.length > 0,
    evidenceIds: event.evidenceIds,
  };
}
