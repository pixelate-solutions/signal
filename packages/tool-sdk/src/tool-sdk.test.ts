import { describe, expect, it } from "vitest";

import type { ToolManifest } from "@signal/contracts";

import { scoreRoute, selectRoute, ToolRegistry } from "./index.js";

function manifest(source: ToolManifest["source"], name = `${source}.lookup`): ToolManifest {
  return {
    name,
    version: "1.0.0",
    source,
    description: "Look up provider state",
    inputSchema: { type: "object" },
    outputSchema: { type: "object" },
    auth: [],
    requiredScopes: [],
    riskClass: "R0",
    sideEffect: "none",
    idempotency: "read_only",
    verification: { kind: "provider_status", mandatory: true },
    egress: { allowedHosts: ["provider.example"], allowRedirects: false },
    timeoutMs: 10_000,
    retry: { maxAttempts: 2, safeClasses: ["transport"] },
    enabled: true,
  };
}

describe("capability routing", () => {
  it("prefers native over browser for otherwise equal routes", () => {
    const native = {
      tool: manifest("native"),
      connected: true,
      providerHealthy: true,
      reliability: 0.95,
      latencyMs: 200,
      costMinor: 0,
      termsPermitted: true,
    };
    const browser = {
      tool: manifest("browser"),
      connected: true,
      providerHealthy: true,
      reliability: 0.95,
      latencyMs: 200,
      costMinor: 0,
      termsPermitted: true,
    };
    expect(selectRoute([browser, native])?.tool.source).toBe("native");
    expect(scoreRoute(native)).toBeGreaterThan(scoreRoute(browser));
  });

  it("excludes a route that provider terms prohibit", () => {
    const route = {
      tool: manifest("browser"),
      connected: true,
      providerHealthy: true,
      reliability: 1,
      latencyMs: 1,
      costMinor: 0,
      termsPermitted: false,
    };
    expect(selectRoute([route])).toBeUndefined();
  });

  it("keeps versions pinned in the registry", () => {
    const registry = new ToolRegistry();
    const adapter = {
      manifest: manifest("native"),
      execute: async () => {
        throw new Error("unused");
      },
    };
    registry.register(adapter);
    expect(registry.get(adapter.manifest.name, "1.0.0")).toBe(adapter);
  });
});
