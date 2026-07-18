import { describe, expect, it } from "vitest";

import {
  DefaultPolicyEvaluator,
  LayeredPolicyEvaluator,
  type PolicyRequest,
  type StoredPolicyBundle,
} from "./index.js";

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

describe("layered tenant policy", () => {
  it("lets organization and user policy become stricter but never weaken platform policy", async () => {
    const now = "2026-07-18T12:00:00.000Z";
    const bundles: StoredPolicyBundle[] = [
      {
        id: "pbl_organization0001",
        tenantId: "ten_demo0001",
        scope: "organization",
        ownerUserId: null,
        version: "org-v1",
        active: true,
        createdBy: "usr_demo0001",
        createdAt: now,
        updatedAt: now,
        rules: [
          {
            id: "prl_domain0001",
            description: "Only approved external domains.",
            enabled: true,
            priority: 100,
            match: {
              capabilities: ["mail.*"],
              risks: [],
              sideEffects: [],
              providers: [],
              domains: [],
              dataClassesAny: [],
              amountGreaterThanMinor: null,
            },
            outcome: "ALLOW",
            reason: "Organization mail rule.",
            limits: { allowed_domains: ["example.com"] },
          },
        ],
      },
      {
        id: "pbl_userpolicy0001",
        tenantId: "ten_demo0001",
        scope: "user",
        ownerUserId: "usr_demo0001",
        version: "user-v1",
        active: true,
        createdBy: "usr_demo0001",
        createdAt: now,
        updatedAt: now,
        rules: [
          {
            id: "prl_userdeny0001",
            description: "Disable external mail.",
            enabled: true,
            priority: 100,
            match: {
              capabilities: ["mail.*"],
              risks: [],
              sideEffects: [],
              providers: [],
              domains: [],
              dataClassesAny: [],
              amountGreaterThanMinor: null,
            },
            outcome: "DENY",
            reason: "Mail is disabled by the user.",
            limits: {},
          },
        ],
      },
    ];
    const layered = new LayeredPolicyEvaluator(
      new DefaultPolicyEvaluator({ next: () => "pol_layered0001" }),
      async () => bundles,
    );
    const base = request();
    const policyRequest: PolicyRequest = {
      ...base,
      capability: {
        name: "mail.send",
        version: "1.0.0",
        risk: "R2",
        sideEffect: "external",
        verificationStrength: "independent",
      },
      target: { ...base.target, domain: "outside.example" },
    };
    const decision = await layered.evaluate(policyRequest);
    expect(decision.outcome).toBe("DENY");
    expect(decision.bundleVersion).toContain("+");
  });
});
