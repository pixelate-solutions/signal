import { describe, expect, it } from "vitest";

import type { ModelProvider, StructuredModelRequest } from "@signal/model-gateway";

import { BoundedAgent, type CompiledContext } from "./index.js";

describe("agent observation decisions", () => {
  const agent = new BoundedAgent({} as never, {} as never);

  it("investigates unknown side effects before retry", () => {
    expect(
      agent.decideAfterObservation({
        status: "FAILED",
        sanitizedMessage: "The provider timed out.",
        provider: {},
        retryable: true,
        errorClass: "transport",
        sideEffectState: "unknown",
        evidenceIds: [],
        usage: { durationMs: 5_000, costMinor: 0, currency: "USD" },
      }),
    ).toBe("investigate_state");
  });

  it("retries only a definitely-not-started retryable result", () => {
    expect(
      agent.decideAfterObservation({
        status: "FAILED",
        sanitizedMessage: "Connection refused before submission.",
        provider: {},
        retryable: true,
        errorClass: "transport",
        sideEffectState: "definitely_not_started",
        evidenceIds: [],
        usage: { durationMs: 100, costMinor: 0, currency: "USD" },
      }),
    ).toBe("safe_retry");
  });
});

describe("agent planning wire contract", () => {
  it("passes a textual exact-name catalog and decodes strict JSON step inputs", async () => {
    let captured: StructuredModelRequest<unknown> | undefined;
    const model = {
      completeStructured: async <T>(request: StructuredModelRequest<T>) => {
        captured = request as StructuredModelRequest<unknown>;
        return {
          output: {
            steps: [
              {
                id: "send_email",
                description: "Send the requested email.",
                desiredCapability: "google.gmail.send_email",
                inputJson:
                  '{"recipient_email":"admin@pixelate.solutions","body":"Hello from Signal"}',
                connectionProvider: "google",
                sideEffecting: true,
              },
            ],
            successCriteria: [
              { id: "read_back", description: "Read the sent message back.", required: true },
            ],
          } as T,
          metadata: {
            provider: "test",
            model: "test",
            apiVersion: "test",
            requestId: request.requestId,
            usage: { inputTokens: 0, outputTokens: 0, reasoningTokens: 0 },
          },
        };
      },
    } as unknown as ModelProvider;
    const agent = new BoundedAgent(model, {} as never);
    const context = {
      task: {
        id: "tsk_demo0001",
        objective: "Email admin@pixelate.solutions.",
        constraints: [],
        successCriteria: [],
        state: "PLANNING",
        budget: {
          maxModelTokens: 10_000,
          maxToolCalls: 10,
          maxIterations: 10,
          maxWallClockSeconds: 60,
        },
      },
      memories: [],
      recentEvents: [],
      policies: [],
      artifacts: [],
    } as CompiledContext;

    const result = await agent.plan(
      {
        requestId: "mdl_demo0001",
        messages: [{ role: "user", content: [{ type: "text", text: context.task.objective }] }],
        tools: [
          {
            name: "google.gmail.send_email",
            description: "Send a Gmail message.",
            inputSchema: {
              type: "object",
              properties: { recipient_email: { type: "string" }, body: { type: "string" } },
              required: ["recipient_email", "body"],
              additionalProperties: false,
            },
            connectionProvider: "google",
            sideEffecting: true,
          },
        ],
        maxOutputTokens: 4_000,
        deadline: new Date("2026-07-19T06:00:00.000Z"),
        metadata: {
          tenantId: "ten_demo0001",
          taskId: "tsk_demo0001",
          contextVersion: "1",
          toolRegistryVersion: "1",
          policyVersion: "1",
          memorySnapshot: [],
        },
      },
      context,
      new AbortController().signal,
    );

    expect(captured?.tools).toEqual([]);
    const developerText = captured?.messages[1]?.content[0];
    expect(developerText?.type).toBe("text");
    expect(developerText?.type === "text" ? developerText.text : "").toContain(
      '"name":"google.gmail.send_email"',
    );
    expect(result.steps[0]?.input).toEqual({
      recipient_email: "admin@pixelate.solutions",
      body: "Hello from Signal",
    });
    expect(result.steps[0]).toMatchObject({
      connectionProvider: "google",
      sideEffecting: true,
    });
    expect(result.userSummary).toBe(
      "Signal prepared a 1-step plan and will verify the outcome before completion.",
    );
  });
});
