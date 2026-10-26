import { describe, expect, it, vi } from "vitest";

import { ToolRegistry } from "@signal/tool-sdk";

import { registerDeviceTool } from "./device-adapter.js";

const context = {
  executionId: "tex_device0001",
  tenantId: "ten_demo0001",
  userId: "usr_demo0001",
  taskId: "tsk_demo0001",
  stepId: "stp_demo0001",
  connectionId: null,
  policyDecisionId: "pol_demo0001",
  idempotencyKey: "idempotency-device-0001",
  deadline: "2026-07-19T23:00:00.000Z",
  remainingToolCalls: 5,
};

describe("device adapter", () => {
  it("always lets the control plane issue the command instead of trusting model input", async () => {
    const fetcher = vi.fn<typeof fetch>(async () =>
      Promise.resolve(
        new Response(
          JSON.stringify({
            status: "QUEUED",
            command: { commandId: "cmd_serverissued0001", deviceId: "dev_demo0001" },
            result: null,
            deliveryError: null,
          }),
          { status: 201, headers: { "content-type": "application/json" } },
        ),
      ),
    );
    const registry = new ToolRegistry();
    registerDeviceTool(registry, {
      baseUrl: "http://api:3000",
      serviceToken: "service-token",
      fetcher,
    });
    const adapter = registry.get("device.execute", "1.0.0");
    if (adapter === undefined) throw new Error("Device adapter was not registered.");

    const result = await adapter.execute(
      {
        commandId: "chknotes01",
        actionType: "app_intent",
        payload: { operation: "check_installed_apps" },
        requiredPermission: "device.apps.read",
        riskClass: "R0",
        requiresForeground: false,
        requiresConfirmation: false,
      },
      context,
      { signal: new AbortController().signal },
    );

    expect(fetcher).toHaveBeenCalledOnce();
    const [url, init] = fetcher.mock.calls[0] ?? [];
    expect(String(url)).toBe("http://api:3000/internal/v1/device-commands");
    expect(init?.method).toBe("POST");
    expect(JSON.parse(String(init?.body))).not.toHaveProperty("commandId");
    expect(result).toMatchObject({
      status: "APPROVAL_REQUIRED",
      data: { commandId: "cmd_serverissued0001" },
    });
    expect(adapter.manifest.inputSchema["properties"]).not.toHaveProperty("commandId");
  });

  it("treats an empty installed-app result as a verified negative answer", async () => {
    const fetcher = vi.fn<typeof fetch>(async () =>
      Promise.resolve(
        new Response(
          JSON.stringify({
            status: "COMPLETED",
            command: { commandId: "cmd_serverissued0002", deviceId: "dev_demo0001" },
            result: {
              status: "SUCCEEDED",
              result: { operation: "check_installed_apps", installed: false, matches: [] },
              evidenceDigest: "sha256:device-result",
            },
            deliveryError: null,
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        ),
      ),
    );
    const registry = new ToolRegistry();
    registerDeviceTool(registry, {
      baseUrl: "http://api:3000",
      serviceToken: "service-token",
      fetcher,
    });
    const adapter = registry.get("device.execute", "1.0.0");
    if (adapter === undefined) throw new Error("Device adapter was not registered.");

    const result = await adapter.execute(
      {
        actionType: "app_intent",
        payload: { operation: "check_installed_apps" },
        requiredPermission: "device.apps.read",
      },
      context,
      { signal: new AbortController().signal },
    );

    expect(result).toMatchObject({
      status: "SUCCEEDED",
      sanitizedMessage: "The registered device did not find a supported notes app.",
      sideEffectState: "definitely_completed",
    });
    expect(result.evidenceIds).toHaveLength(1);
  });
});
