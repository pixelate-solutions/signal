import { describe, expect, it } from "vitest";

import { ExampleStatusClient } from "./index.js";

describe("generated Example status adapter", () => {
  it("encodes the required field and validates the official response contract", async () => {
    const calls: string[] = [];
    const client = new ExampleStatusClient(
      async () => "test-token",
      async (input) => {
        calls.push(
          typeof input === "string" ? input : input instanceof URL ? input.href : input.url,
        );
        return new Response(
          JSON.stringify({ resourceId: "res/with space", status: "ready", requestId: "req_123" }),
          { status: 200, headers: { "content-type": "application/json" } },
        );
      },
    );
    await expect(client.read({ resourceId: "res/with space" })).resolves.toMatchObject({
      status: "ready",
    });
    expect(calls[0]).toContain("res%2Fwith%20space");
  });

  it("does not turn missing credentials into success", async () => {
    const client = new ExampleStatusClient(
      async () => "",
      async () => new Response(null, { status: 401 }),
    );
    await expect(client.read({ resourceId: "res_1" })).rejects.toThrow("CONNECTION_REQUIRED");
  });
});
