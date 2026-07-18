import { describe, expect, it } from "vitest";

import { createGeneratedCanaryHost } from "./canary.js";

describe("generated provider canary", () => {
  it("executes only the operator-approved staging contract and returns evidence", async () => {
    const candidateId = "gcp_fixture0001";
    const app = await createGeneratedCanaryHost({
      token: "canary-secret",
      logger: false,
      configJson: JSON.stringify({
        fixture: {
          baseUrl: "https://api.fixture.example/staging",
          input: { issue: "fixture", projectId: "project-1" },
          headers: { authorization: "Bearer staging-only" },
          allowedMethods: ["POST"],
          sideEffectsAllowed: true,
          expectedStatusCodes: [201],
          expectedJson: { created: true },
        },
      }),
      resolver: async () => [{ address: "93.184.216.34", family: 4 }],
      fetcher: async (input, init) => {
        const url =
          input instanceof Request ? input.url : input instanceof URL ? input.toString() : input;
        expect(url).toBe("https://api.fixture.example/staging/projects/project-1/issues");
        expect(init?.method).toBe("POST");
        expect(init?.headers).toMatchObject({ authorization: "Bearer staging-only" });
        expect(new Headers(init?.headers).get("idempotency-key")).toBe(
          `signal-canary-${candidateId}`,
        );
        expect(JSON.parse(typeof init?.body === "string" ? init.body : "")).toEqual({
          issue: "fixture",
        });
        return new Response(JSON.stringify({ created: true, id: "staging-1" }), { status: 201 });
      },
    });
    const response = await app.inject({
      method: "POST",
      url: "/v1/canary",
      headers: { authorization: "Bearer canary-secret" },
      payload: {
        candidateId,
        candidateDigest: `sha256:${"a".repeat(64)}`,
        provider: "fixture",
        sideEffect: "external",
        runtime: { method: "POST", path: "/projects/{projectId}/issues" },
      },
    });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      passed: true,
      evidenceDigest: expect.stringMatching(/^sha256:/),
    });
    await app.close();
  });

  it("fails closed for unknown providers and private endpoints", async () => {
    const unknown = await createGeneratedCanaryHost({
      token: "canary-secret",
      logger: false,
      configJson: "{}",
    });
    const response = await unknown.inject({
      method: "POST",
      url: "/v1/canary",
      headers: { authorization: "Bearer canary-secret" },
      payload: {
        candidateId: "gcp_fixture0002",
        candidateDigest: `sha256:${"b".repeat(64)}`,
        provider: "fixture",
        sideEffect: "none",
        runtime: { method: "GET", path: "/status" },
      },
    });
    expect(response.json()).toMatchObject({ passed: false });
    await unknown.close();
  });
});
