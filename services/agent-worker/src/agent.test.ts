import { describe, expect, it } from "vitest";

import { BoundedAgent } from "./index.js";

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
