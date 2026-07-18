import { createHash } from "node:crypto";

import type { ToolAdapter } from "@signal/tool-sdk";

export function createGitHubIssueAdapter(
  credential: (connectionId: string) => Promise<string>,
  fetcher: typeof fetch = fetch,
): ToolAdapter {
  return {
    manifest: {
      name: "github.issue.create",
      version: "1.0.0",
      source: "native",
      description:
        "Create a GitHub issue once, with a hidden idempotency marker and post-write verification.",
      inputSchema: {
        type: "object",
        properties: {
          owner: { type: "string" },
          repo: { type: "string" },
          title: { type: "string" },
          body: { type: "string" },
        },
        required: ["owner", "repo", "title", "body"],
        additionalProperties: false,
      },
      outputSchema: { type: "object" },
      auth: [{ provider: "github", type: "oauth2" }],
      requiredScopes: ["issues:write"],
      riskClass: "R2",
      sideEffect: "external",
      idempotency: "state_check",
      verification: { kind: "read_after_write", mandatory: true },
      egress: { allowedHosts: ["api.github.com"], allowRedirects: false },
      timeoutMs: 20_000,
      retry: { maxAttempts: 1, safeClasses: [] },
      enabled: true,
    },
    execute: async (input, context, cancellation) => {
      if (context.connectionId === null)
        throw new Error("CONNECTION_REQUIRED: GitHub connection required.");
      const token = await credential(context.connectionId);
      const marker = `<!-- signal-idempotency:${createHash("sha256").update(context.idempotencyKey).digest("hex")} -->`;
      const base = `https://api.github.com/repos/${encodeURIComponent(String(input["owner"]))}/${encodeURIComponent(String(input["repo"]))}`;
      const search = await fetcher(`${base}/issues?state=all&per_page=100`, {
        headers: { authorization: `Bearer ${token}`, accept: "application/vnd.github+json" },
        signal: cancellation.signal,
      });
      if (search.status === 401)
        throw new Error("CONNECTION_REQUIRED: GitHub authorization expired.");
      if (!search.ok) throw new Error(`GitHub preflight returned HTTP ${search.status}.`);
      const issues = (await search.json()) as { number: number; body?: string; html_url: string }[];
      const existing = issues.find((issue) => issue.body?.includes(marker));
      if (existing !== undefined) {
        return {
          status: "SUCCEEDED",
          data: { number: existing.number, url: existing.html_url, replayed: true },
          sanitizedMessage:
            "The approved GitHub issue already exists; Signal did not create a duplicate.",
          provider: { statusCode: 200 },
          retryable: false,
          errorClass: "none",
          sideEffectState: "definitely_completed",
          evidenceIds: [],
          verificationHint: `Read issue ${existing.number} and compare title/body.`,
          usage: { durationMs: 0, costMinor: 0, currency: "USD" },
        };
      }
      const response = await fetcher(`${base}/issues`, {
        method: "POST",
        headers: {
          authorization: `Bearer ${token}`,
          accept: "application/vnd.github+json",
          "content-type": "application/json",
        },
        body: JSON.stringify({
          title: input["title"],
          body: `${String(input["body"])}\n\n${marker}`,
        }),
        signal: cancellation.signal,
      });
      if (!response.ok) throw new Error(`GitHub issue creation returned HTTP ${response.status}.`);
      const issue = (await response.json()) as {
        number: number;
        html_url: string;
        node_id?: string;
      };
      return {
        status: "SUCCEEDED",
        data: { number: issue.number, url: issue.html_url },
        sanitizedMessage: `GitHub accepted issue #${issue.number}.`,
        provider: {
          statusCode: response.status,
          ...(issue.node_id === undefined ? {} : { requestId: issue.node_id }),
        },
        retryable: false,
        errorClass: "none",
        sideEffectState: "definitely_completed",
        evidenceIds: [],
        verificationHint: `Read issue ${issue.number} before claiming completion.`,
        usage: { durationMs: 0, costMinor: 0, currency: "USD" },
      };
    },
  };
}
