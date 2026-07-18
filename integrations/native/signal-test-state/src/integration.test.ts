import { describe, expect, it } from "vitest";

import { ToolRegistry } from "@signal/tool-sdk";

import { registerSignalTestStateTools } from "./index.js";

describe("isolated test-state provider", () => {
  it("deduplicates a write using the provider idempotency key", async () => {
    const registry = new ToolRegistry();
    const provider = registerSignalTestStateTools(registry);
    const adapter = registry.get("signal_test_state.write", "1.0.0");
    if (adapter === undefined) throw new Error("adapter missing");
    const context = {
      executionId: "tex_demo0001",
      tenantId: "ten_demo0001",
      userId: "usr_demo0001",
      taskId: "tsk_demo0001",
      stepId: "stp_demo0001",
      connectionId: null,
      policyDecisionId: "pol_demo0001",
      idempotencyKey: "stable-provider-key",
      deadline: "2026-07-18T13:00:00.000Z",
      remainingToolCalls: 10,
    };
    await adapter.execute({ key: "shipment:4831", value: "Friday" }, context, {
      signal: new AbortController().signal,
    });
    await adapter.execute({ key: "shipment:4831", value: "Friday" }, context, {
      signal: new AbortController().signal,
    });
    expect(provider.writes).toBe(1);
    expect(provider.read("shipment:4831").value).toBe("Friday");
  });
});
