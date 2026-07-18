import { createHash } from "node:crypto";

import type { ToolAdapter } from "@signal/tool-sdk";

const evidenceId = (value: unknown) =>
  `evd_${createHash("sha256").update(JSON.stringify(value)).digest("hex").slice(0, 24)}`;

export function createGitHubIssueAdapter(
  credential: (
    connectionId: string,
    context: { tenantId: string; taskId: string; adapter: string },
  ) => Promise<string>,
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
      requiredScopes: ["repo"],
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
      const token = await credential(context.connectionId, {
        tenantId: context.tenantId,
        taskId: context.taskId,
        adapter: "github.issue.create",
      });
      const marker = `<!-- signal-idempotency:${createHash("sha256").update(context.idempotencyKey).digest("hex")} -->`;
      const base = `https://api.github.com/repos/${encodeURIComponent(String(input["owner"]))}/${encodeURIComponent(String(input["repo"]))}`;
      const search = await fetcher(`${base}/issues?state=all&per_page=100`, {
        headers: {
          authorization: `Bearer ${token}`,
          accept: "application/vnd.github+json",
          "x-github-api-version": "2026-03-10",
        },
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
          "x-github-api-version": "2026-03-10",
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
    verify: async (input, result, context, cancellation) => {
      if (
        context.connectionId === null ||
        result.data === null ||
        typeof result.data !== "object"
      ) {
        return {
          ...result,
          status: "FAILED",
          sanitizedMessage: "GitHub verification context is incomplete.",
          errorClass: "unknown",
          sideEffectState: "unknown",
        };
      }
      const number = (result.data as { number?: unknown }).number;
      if (typeof number !== "number" || !Number.isInteger(number) || number < 1) {
        return {
          ...result,
          status: "FAILED",
          sanitizedMessage: "GitHub did not return a verifiable issue number.",
          errorClass: "unknown",
          sideEffectState: "unknown",
        };
      }
      const token = await credential(context.connectionId, {
        tenantId: context.tenantId,
        taskId: context.taskId,
        adapter: "github.issue.create.verify",
      });
      const owner = encodeURIComponent(String(input["owner"]));
      const repo = encodeURIComponent(String(input["repo"]));
      const response = await fetcher(
        `https://api.github.com/repos/${owner}/${repo}/issues/${number}`,
        {
          headers: {
            authorization: `Bearer ${token}`,
            accept: "application/vnd.github+json",
            "x-github-api-version": "2026-03-10",
          },
          signal: cancellation.signal,
        },
      );
      if (!response.ok) {
        return {
          ...result,
          status: "FAILED",
          sanitizedMessage: "GitHub read-after-write verification failed.",
          errorClass: response.status === 401 ? "auth" : "unknown",
          sideEffectState: "unknown",
        };
      }
      const observed = (await response.json()) as {
        number?: number;
        title?: string;
        body?: string | null;
      };
      const marker = `<!-- signal-idempotency:${createHash("sha256")
        .update(context.idempotencyKey)
        .digest("hex")} -->`;
      const passed =
        observed.number === number &&
        observed.title === String(input["title"]) &&
        typeof observed.body === "string" &&
        observed.body.includes(String(input["body"])) &&
        observed.body.includes(marker);
      const evidence = {
        number,
        title: observed.title ?? null,
        markerPresent: observed.body?.includes(marker) ?? false,
        passed,
      };
      return {
        ...result,
        status: passed ? "SUCCEEDED" : "FAILED",
        sanitizedMessage: passed
          ? `GitHub issue #${number} was independently verified.`
          : "The GitHub issue did not match the approved title, body, and idempotency marker.",
        errorClass: passed ? "none" : "unknown",
        sideEffectState: passed ? "definitely_completed" : "unknown",
        evidenceIds: [...result.evidenceIds, evidenceId(evidence)],
        verificationHint: passed
          ? "Verified by an independent GitHub issue read."
          : "Do not claim completion.",
      };
    },
  };
}
