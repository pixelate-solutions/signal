import { afterEach, describe, expect, it } from "vitest";

import { createFixtureServer } from "./index.js";

const app = createFixtureServer();
afterEach(async () => app.ready());

describe("local external-system fixtures", () => {
  it("serves a Meta Responses-compatible deterministic envelope", async () => {
    const response = await app.inject({
      method: "POST",
      url: "/v1/responses",
      payload: { stream: false },
    });
    expect(response.statusCode).toBe(200);
    const body = response.json() as {
      model: string;
      output_text: string;
      output: { content: { text: string }[] }[];
    };
    expect(body.model).toBe("muse-spark-1.1");
    expect(body.output_text).toContain('"desiredCapability":"signal_test_state.read"');
    expect(body.output[0]?.content[0]?.text).toBe(body.output_text);
  });

  it("deduplicates provider writes and exposes verifiable state", async () => {
    const first = await app.inject({
      method: "POST",
      url: "/provider/write",
      headers: { "idempotency-key": "same" },
      payload: { key: "order-1", value: 1 },
    });
    const second = await app.inject({
      method: "POST",
      url: "/provider/write",
      headers: { "idempotency-key": "same" },
      payload: { key: "order-1", value: 1 },
    });
    expect(first.statusCode).toBe(201);
    expect(second.json().replayed).toBe(true);
    expect(
      (await app.inject({ method: "GET", url: "/provider/state/order-1" })).json().write,
    ).not.toBeNull();
  });
});
