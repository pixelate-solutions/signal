import { describe, expect, it } from "vitest";

import type { ToolExecutionContext } from "@signal/contracts";

import { createGoogleAdapters } from "./index.js";

const context: ToolExecutionContext = {
  executionId: "tex_demo0001",
  tenantId: "ten_demo0001",
  userId: "usr_demo0001",
  taskId: "tsk_demo0001",
  stepId: "stp_demo0001",
  connectionId: "con_demo0001",
  policyDecisionId: "pol_demo0001",
  idempotencyKey: "idem_calendar_0001",
  deadline: "2026-07-18T13:00:00.000Z",
  remainingToolCalls: 10,
};

describe("Google native tools", () => {
  it("uses a deterministic provider event ID to prevent duplicate calendar writes", async () => {
    const bodies: string[] = [];
    const adapter = createGoogleAdapters(
      async () => "test-token",
      async (_url, init) => {
        bodies.push(typeof init?.body === "string" ? init.body : "");
        return new Response(JSON.stringify({ id: "provider_event", status: "confirmed" }), {
          status: 200,
        });
      },
    ).find((tool) => tool.manifest.name === "google.calendar.upsert_event");
    const input = {
      calendarId: "primary",
      summary: "Review",
      start: "2026-07-18T12:00:00Z",
      end: "2026-07-18T12:30:00Z",
      timezone: "UTC",
    };
    await adapter?.execute(input, context, { signal: new AbortController().signal });
    await adapter?.execute(input, context, { signal: new AbortController().signal });
    expect(JSON.parse(bodies[0] ?? "{}").id).toBe(JSON.parse(bodies[1] ?? "{}").id);
  });

  it("returns connection required instead of success on expired OAuth", async () => {
    const adapter = createGoogleAdapters(
      async () => "test-token",
      async () => new Response(null, { status: 401 }),
    )[0];
    await expect(
      adapter?.execute({ query: "newer:1d" }, context, { signal: new AbortController().signal }),
    ).rejects.toThrow("CONNECTION_REQUIRED");
  });
});
