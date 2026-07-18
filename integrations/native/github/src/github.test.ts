import { createHash } from "node:crypto";

import { describe, expect, it } from "vitest";

import type { ToolExecutionContext } from "@signal/contracts";

import { createGitHubIssueAdapter } from "./index.js";

const context: ToolExecutionContext = {
  executionId: "tex_demo0001",
  tenantId: "ten_demo0001",
  userId: "usr_demo0001",
  taskId: "tsk_demo0001",
  stepId: "stp_demo0001",
  connectionId: "con_demo0001",
  policyDecisionId: "pol_demo0001",
  idempotencyKey: "idem_issue_0001",
  deadline: "2026-07-18T13:00:00.000Z",
  remainingToolCalls: 10,
};

describe("GitHub native issue tool", () => {
  it("preflights the idempotency marker and avoids a duplicate write", async () => {
    let writes = 0;
    const markerHash = createHashForTest(context.idempotencyKey);
    const adapter = createGitHubIssueAdapter(
      async () => "test-token",
      async (url, init) => {
        if (init?.method === "POST") {
          writes += 1;
          return new Response(null, { status: 500 });
        }
        return new Response(
          JSON.stringify([
            {
              number: 7,
              html_url: "https://github.test/issues/7",
              body: `<!-- signal-idempotency:${markerHash} -->`,
            },
          ]),
          { status: 200 },
        );
      },
    );
    const result = await adapter.execute(
      { owner: "pixelate", repo: "signal", title: "T", body: "B" },
      context,
      { signal: new AbortController().signal },
    );
    expect(result.status).toBe("SUCCEEDED");
    expect(writes).toBe(0);
  });
});

function createHashForTest(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}
