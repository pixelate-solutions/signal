import type { Task, TaskEvent } from "@signal/contracts";

const genericCompletionSummaries = new Set([
  "all mandatory verification checks passed.",
  "all planned steps have durable successful executions and retained evidence.",
  "the outcome is verified.",
  "the requested outcome was completed and verified.",
]);

export function isQuestionObjective(objective: string): boolean {
  const normalized = objective.trim();
  return (
    normalized.endsWith("?") ||
    /^(?:who|what|when|where|why|how|do|does|did|is|are|am|can|could|should|would|will|has|have|had)\b/i.test(
      normalized,
    )
  );
}

export function receiptOutcome(task: Task, events: readonly TaskEvent[]): string {
  const usefulSummary = (event: TaskEvent): boolean => {
    const normalized = event.summary.trim().toLocaleLowerCase();
    return (
      normalized.length > 0 &&
      event.summary.trim() !== task.objective.trim() &&
      !genericCompletionSummaries.has(normalized)
    );
  };
  const newestFirst = [...events].sort((left, right) => right.sequence - left.sequence);
  const verified = newestFirst.find(
    (event) => event.type === "verification.succeeded" && usefulSummary(event),
  );
  if (verified !== undefined) return verified.summary.trim();
  const toolOutcome = newestFirst.find(
    (event) => event.type === "tool.execution_succeeded" && usefulSummary(event),
  );
  if (toolOutcome !== undefined) return toolOutcome.summary.trim();
  return "The requested outcome was completed and verified.";
}
