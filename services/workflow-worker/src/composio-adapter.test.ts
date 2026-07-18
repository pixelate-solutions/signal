import { describe, expect, it } from "vitest";

import type { ConnectionManager } from "@signal/connection-service";
import { ToolRegistry } from "@signal/tool-sdk";

import { registerConfiguredComposioTools } from "./composio-adapter.js";

const context = {
  executionId: "tex_composio0001",
  tenantId: "ten_demo0001",
  userId: "usr_demo0001",
  taskId: "tsk_demo0001",
  stepId: "stp_demo0001",
  connectionId: "con_demo0001",
  policyDecisionId: "pol_demo0001",
  idempotencyKey: "idempotency-demo-0001",
  deadline: "2026-07-18T13:00:00.000Z",
  remainingToolCalls: 5,
};

function writeConfiguration(verification: unknown) {
  return JSON.stringify([
    {
      name: "composio.ticket.create",
      toolSlug: "TICKETS_CREATE",
      toolVersion: "20260718_01",
      provider: "tickets",
      description: "Create a ticket and verify it by a separate read.",
      inputSchema: {
        type: "object",
        properties: { title: { type: "string" } },
        required: ["title"],
        additionalProperties: false,
      },
      requiredScopes: ["tickets:write"],
      riskClass: "R2",
      sideEffect: "external",
      verification,
    },
  ]);
}

describe("configured Composio adapters", () => {
  it("refuses a side-effecting tool without an independent verifier", () => {
    const registry = new ToolRegistry();
    expect(() =>
      registerConfiguredComposioTools(
        registry,
        {} as ConnectionManager,
        writeConfiguration(undefined),
      ),
    ).toThrow("read-after-write verification tool");
  });

  it("verifies a write through a separately configured provider read", async () => {
    const calls: string[] = [];
    const connections = {
      executeComposioTool: async (input: { toolSlug: string }) => {
        calls.push(input.toolSlug);
        return input.toolSlug === "TICKETS_CREATE"
          ? {
              successful: true,
              data: { ticket: { id: "ticket-42", title: "Ship Signal" } },
              error: null,
              logId: "write-log",
            }
          : {
              successful: true,
              data: { ticket: { id: "ticket-42", title: "Ship Signal" } },
              error: null,
              logId: "read-log",
            };
      },
    } as unknown as ConnectionManager;
    const registry = new ToolRegistry();
    registerConfiguredComposioTools(
      registry,
      connections,
      writeConfiguration({
        toolSlug: "TICKETS_GET",
        toolVersion: "20260718_01",
        arguments: { ticketId: { source: "result", path: "ticket.id" } },
        assertions: [
          {
            observedPath: "ticket.title",
            expected: { source: "input", path: "title" },
          },
        ],
      }),
    );
    const adapter = registry.get("composio.ticket.create", "1.0.0");
    if (adapter === undefined || adapter.verify === undefined) {
      throw new Error("The configured Composio adapter and verifier were not registered.");
    }
    const result = await adapter.execute({ title: "Ship Signal" }, context, {
      signal: new AbortController().signal,
    });
    const verified = await adapter.verify({ title: "Ship Signal" }, result, context, {
      signal: new AbortController().signal,
    });
    expect(verified).toMatchObject({
      status: "SUCCEEDED",
      sideEffectState: "definitely_completed",
    });
    expect(verified.evidenceIds).toHaveLength(2);
    expect(calls).toEqual(["TICKETS_CREATE", "TICKETS_GET"]);
  });
});
