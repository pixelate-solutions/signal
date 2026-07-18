import { describe, expect, it } from "vitest";

import { DefaultPolicyEvaluator, type PolicyRequest } from "./index.js";

let id = 0;
const evaluator = new DefaultPolicyEvaluator({ next: () => `pol_demo000${++id}` });

function request(overrides: Partial<PolicyRequest["capability"]> = {}): PolicyRequest {
  return {
    principal: {
      userId: "usr_demo0001",
      tenantId: "ten_demo0001",
      roles: ["owner"],
      delegatedUserId: null,
    },
    task: { id: "tsk_demo0001", objective: "Check the carrier", risk: "R0" },
    capability: {
      name: "carrier.read",
      version: "1.0.0",
      risk: "R0",
      sideEffect: "none",
      verificationStrength: "independent",
      ...overrides,
    },
    connection: { id: "con_demo0001", scopes: ["read", "write"] },
    target: {
      provider: "carrier",
      domain: "carrier.example",
      recipient: null,
      merchant: null,
      account: null,
    },
    dataClasses: ["internal"],
    amount: null,
    occurredAt: "2026-07-18T12:00:00.000Z",
    materialPayload: { shipment: "4831" },
  };
}

describe("default policy", () => {
  it("allows independently verifiable reads", async () => {
    await expect(evaluator.evaluate(request())).resolves.toMatchObject({ outcome: "ALLOW" });
  });

  it("requires approval for external writes despite broad provider scopes", async () => {
    await expect(
      evaluator.evaluate(request({ risk: "R2", sideEffect: "external" })),
    ).resolves.toMatchObject({ outcome: "REQUIRE_APPROVAL" });
  });

  it("denies secret egress", async () => {
    await expect(
      evaluator.evaluate({ ...request(), dataClasses: ["secret"] }),
    ).resolves.toMatchObject({ outcome: "DENY" });
  });
});
