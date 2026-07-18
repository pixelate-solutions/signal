import { describe, expect, it } from "vitest";
import { z } from "zod";

import { FakeDeterministicModelProvider, MetaMuseSparkProvider } from "./index.js";

const baseRequest = {
  requestId: "model_request_demo",
  messages: [{ role: "user" as const, content: [{ type: "text" as const, text: "Plan this." }] }],
  tools: [],
  maxOutputTokens: 100,
  deadline: new Date("2026-07-18T12:01:00.000Z"),
  metadata: {
    tenantId: "ten_demo0001",
    taskId: "tsk_demo0001",
    contextVersion: "ctx-1",
    toolRegistryVersion: "tools-1",
    policyVersion: "policy-1",
    memorySnapshot: [],
  },
};

describe("model providers", () => {
  it("shares the structured-output contract", async () => {
    const provider = new FakeDeterministicModelProvider(() => ({ plan: ["Research", "Verify"] }));
    await expect(
      provider.completeStructured(
        {
          ...baseRequest,
          schemaName: "plan",
          schema: z.object({ plan: z.array(z.string()) }),
          jsonSchema: { type: "object" },
        },
        new AbortController().signal,
      ),
    ).resolves.toMatchObject({ output: { plan: ["Research", "Verify"] } });
  });

  it("fails closed when the Meta credential is unavailable", async () => {
    const provider = new MetaMuseSparkProvider({
      baseUrl: "https://api.meta.ai/v1",
      model: "meta/muse-spark-1.1",
      apiVersion: "public-preview-2026-07",
    });
    await expect(provider.health()).resolves.toMatchObject({ status: "unhealthy" });
    await expect(
      provider.completeStructured(
        {
          ...baseRequest,
          schemaName: "plan",
          schema: z.object({ plan: z.array(z.string()) }),
          jsonSchema: { type: "object" },
        },
        new AbortController().signal,
      ),
    ).rejects.toThrow("CONNECTION_REQUIRED");
  });

  it("uses the configured Responses API and records provider metadata", async () => {
    const fetcher: typeof fetch = async (input, init) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
      expect(url).toBe("https://api.meta.ai/v1/responses");
      expect(new Headers(init?.headers).get("authorization")).toBe("Bearer test-key");
      return new Response(
        JSON.stringify({
          id: "meta_req_1",
          output_text: JSON.stringify({ plan: ["Verify"] }),
          usage: { input_tokens: 10, output_tokens: 3 },
        }),
        { status: 200, headers: { "x-request-id": "meta_req_1" } },
      );
    };
    const provider = new MetaMuseSparkProvider({
      baseUrl: "https://api.meta.ai/v1/",
      apiKey: "test-key",
      model: "meta/muse-spark-1.1",
      apiVersion: "public-preview-2026-07",
      fetcher,
    });
    const response = await provider.completeStructured(
      {
        ...baseRequest,
        schemaName: "plan",
        schema: z.object({ plan: z.array(z.string()) }),
        jsonSchema: { type: "object" },
      },
      new AbortController().signal,
    );
    expect(response.metadata).toMatchObject({
      provider: "meta-model-api",
      model: "meta/muse-spark-1.1",
      requestId: "meta_req_1",
    });
  });
});
