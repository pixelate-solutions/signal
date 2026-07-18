import { z } from "zod";

import type { MemoryItem, Task, ToolResult } from "@signal/contracts";
import { rankMemories } from "@signal/memory-sdk";
import type { ModelProvider, ModelRequest } from "@signal/model-gateway";
import { redact } from "@signal/observability";
import type { ToolRegistry } from "@signal/tool-sdk";

export type ContextCompilationInput = {
  task: Task;
  memories: readonly MemoryItem[];
  recentEvents: readonly { type: string; summary: string }[];
  policies: readonly string[];
  query: string;
};

export type CompiledContext = {
  task: Pick<Task, "id" | "objective" | "constraints" | "successCriteria" | "state" | "budget">;
  memories: readonly Pick<MemoryItem, "id" | "kind" | "canonicalText" | "sourceIds">[];
  recentEvents: readonly { type: string; summary: string }[];
  policies: readonly string[];
};

export function compileContext(input: ContextCompilationInput, now = new Date()): CompiledContext {
  const selected = rankMemories(
    {
      text: input.query,
      tenantId: input.task.tenantId,
      userId: input.task.ownerUserId,
      scopes: [
        { type: "user", id: input.task.ownerUserId },
        { type: "conversation", id: input.task.conversationId },
        { type: "task", id: input.task.id },
      ],
      now,
    },
    input.memories,
  ).slice(0, 8);
  return redact({
    task: {
      id: input.task.id,
      objective: input.task.objective,
      constraints: input.task.constraints,
      successCriteria: input.task.successCriteria,
      state: input.task.state,
      budget: input.task.budget,
    },
    memories: selected.map(({ id, kind, canonicalText, sourceIds }) => ({
      id,
      kind,
      canonicalText,
      sourceIds,
    })),
    recentEvents: input.recentEvents.slice(-30),
    policies: input.policies,
  }) as CompiledContext;
}

const planSchema = z
  .object({
    steps: z
      .array(
        z
          .object({
            id: z.string(),
            description: z.string(),
            desiredCapability: z.string(),
            sideEffecting: z.boolean(),
          })
          .strict(),
      )
      .min(1)
      .max(30),
    successCriteria: z
      .array(z.object({ id: z.string(), description: z.string(), required: z.boolean() }).strict())
      .min(1),
    userSummary: z.string(),
  })
  .strict();

export type AgentPlan = z.infer<typeof planSchema>;

export type AgentBudget = {
  maxIterations: number;
  maxToolCalls: number;
  deadline: Date;
};

export class BoundedAgent {
  public constructor(
    private readonly model: ModelProvider,
    private readonly tools: ToolRegistry,
  ) {}

  public async plan(
    baseRequest: ModelRequest,
    context: CompiledContext,
    signal: AbortSignal,
  ): Promise<AgentPlan> {
    const response = await this.model.completeStructured(
      {
        ...baseRequest,
        messages: [
          ...baseRequest.messages,
          {
            role: "developer",
            content: [
              {
                type: "text",
                text: JSON.stringify({
                  instruction:
                    "Return an operational plan with explicit verification. Never claim provider state.",
                  context,
                }),
              },
            ],
          },
        ],
        schemaName: "signal_task_plan",
        schema: planSchema,
        jsonSchema: {
          type: "object",
          required: ["steps", "successCriteria", "userSummary"],
          additionalProperties: false,
        },
      },
      signal,
    );
    return response.output;
  }

  public relevantTools(desiredCapability: string) {
    return this.tools.search(desiredCapability, 8);
  }

  public decideAfterObservation(
    result: ToolResult,
  ): "verify" | "wait" | "connect" | "safe_retry" | "investigate_state" | "fail" {
    if (result.status === "CONNECTION_REQUIRED") return "connect";
    if (result.status === "APPROVAL_REQUIRED") return "wait";
    if (result.status === "SUCCEEDED") return "verify";
    if (result.sideEffectState === "unknown") return "investigate_state";
    if (result.retryable && result.sideEffectState === "definitely_not_started")
      return "safe_retry";
    return "fail";
  }
}
