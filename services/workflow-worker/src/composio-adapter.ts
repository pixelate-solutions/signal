import { createHash } from "node:crypto";

import type { ConnectionManager } from "@signal/connection-service";
import { toolManifestSchema, type ToolManifest } from "@signal/contracts";
import type { ToolAdapter, ToolRegistry } from "@signal/tool-sdk";

type ConfiguredComposioTool = {
  manifest: ToolManifest;
  toolSlug: string;
  toolVersion: string;
  verification: ComposioVerification | null;
};

type ValueBinding = {
  source: "input" | "result";
  path: string;
};

type ComposioVerification = {
  toolSlug: string;
  toolVersion: string;
  arguments: Record<string, ValueBinding>;
  assertions: {
    observedPath: string;
    expected: ValueBinding;
    comparison: "exact" | "trimmed_text";
  }[];
};

function requiredString(value: unknown, path: string): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error(`${path} must be a non-empty string.`);
  }
  return value;
}

function pinnedVersion(value: unknown, path: string): string {
  const version = requiredString(value, path);
  if (version.toLowerCase() === "latest") {
    throw new Error(`${path} must pin a concrete provider tool version.`);
  }
  return version;
}

function binding(value: unknown, path: string): ValueBinding {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${path} must be a value binding object.`);
  }
  const candidate = value as Record<string, unknown>;
  const source = candidate["source"];
  if (source !== "input" && source !== "result") {
    throw new Error(`${path}.source must be input or result.`);
  }
  const valuePath = requiredString(candidate["path"], `${path}.path`);
  if (!/^[a-zA-Z0-9_-]+(?:\.[a-zA-Z0-9_-]+)*$/.test(valuePath)) {
    throw new Error(`${path}.path must be a safe dot-separated property path.`);
  }
  return { source, path: valuePath };
}

function verification(value: unknown, path: string): ComposioVerification | null {
  if (value === undefined) return null;
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${path} must be an object.`);
  }
  const candidate = value as Record<string, unknown>;
  const rawArguments = candidate["arguments"];
  if (rawArguments === null || typeof rawArguments !== "object" || Array.isArray(rawArguments)) {
    throw new Error(`${path}.arguments must be an object.`);
  }
  const rawAssertions = candidate["assertions"];
  if (!Array.isArray(rawAssertions) || rawAssertions.length === 0) {
    throw new Error(`${path}.assertions must contain at least one assertion.`);
  }
  const argumentsMap = Object.fromEntries(
    Object.entries(rawArguments as Record<string, unknown>).map(([name, valueBinding]) => [
      name,
      binding(valueBinding, `${path}.arguments.${name}`),
    ]),
  );
  const assertions = rawAssertions.map((raw, index) => {
    if (raw === null || typeof raw !== "object" || Array.isArray(raw)) {
      throw new Error(`${path}.assertions[${index}] must be an object.`);
    }
    const assertion = raw as Record<string, unknown>;
    const observedPath = requiredString(
      assertion["observedPath"],
      `${path}.assertions[${index}].observedPath`,
    );
    if (!/^[a-zA-Z0-9_-]+(?:\.[a-zA-Z0-9_-]+)*$/.test(observedPath)) {
      throw new Error(`${path}.assertions[${index}].observedPath is unsafe.`);
    }
    const rawComparison = assertion["comparison"];
    if (
      rawComparison !== undefined &&
      rawComparison !== "exact" &&
      rawComparison !== "trimmed_text"
    ) {
      throw new Error(`${path}.assertions[${index}].comparison is unsupported.`);
    }
    const comparison: "exact" | "trimmed_text" = rawComparison ?? "exact";
    return {
      observedPath,
      expected: binding(assertion["expected"], `${path}.assertions[${index}].expected`),
      comparison,
    };
  });
  return {
    toolSlug: requiredString(candidate["toolSlug"], `${path}.toolSlug`),
    toolVersion: pinnedVersion(candidate["toolVersion"], `${path}.toolVersion`),
    arguments: argumentsMap,
    assertions,
  };
}

function parseTools(value: string | undefined): ConfiguredComposioTool[] {
  if (value === undefined || value.trim().length === 0) return [];
  const parsed = JSON.parse(value) as unknown;
  if (!Array.isArray(parsed) || parsed.length === 0) {
    throw new Error("COMPOSIO_TOOLS_JSON must be a non-empty JSON array when configured.");
  }
  return parsed.map((raw, index) => {
    if (raw === null || typeof raw !== "object" || Array.isArray(raw)) {
      throw new Error(`COMPOSIO_TOOLS_JSON[${index}] must be an object.`);
    }
    const item = raw as Record<string, unknown>;
    const toolSlug = requiredString(item["toolSlug"], `COMPOSIO_TOOLS_JSON[${index}].toolSlug`);
    const toolVersion = pinnedVersion(
      item["toolVersion"],
      `COMPOSIO_TOOLS_JSON[${index}].toolVersion`,
    );
    const sideEffect = item["sideEffect"] ?? "external";
    const verifier = verification(
      item["verification"],
      `COMPOSIO_TOOLS_JSON[${index}].verification`,
    );
    if (sideEffect !== "none" && verifier === null) {
      throw new Error(
        `COMPOSIO_TOOLS_JSON[${index}] is side-effecting and requires a read-after-write verification tool.`,
      );
    }
    const manifest = toolManifestSchema.parse({
      name: requiredString(item["name"], `COMPOSIO_TOOLS_JSON[${index}].name`),
      version: item["version"] ?? "1.0.0",
      source: "composio",
      description: requiredString(item["description"], `COMPOSIO_TOOLS_JSON[${index}].description`),
      inputSchema: item["inputSchema"],
      outputSchema: { type: "object" },
      auth: [
        {
          provider: requiredString(item["provider"], `COMPOSIO_TOOLS_JSON[${index}].provider`),
          type: "oauth2",
        },
      ],
      requiredScopes: item["requiredScopes"] ?? [],
      riskClass: item["riskClass"] ?? "R2",
      sideEffect,
      idempotency: sideEffect === "none" ? "read_only" : "none",
      verification: {
        kind: sideEffect === "none" ? "provider_status" : "read_after_write",
        mandatory: true,
      },
      egress: {
        allowedHosts: ["api.composio.dev", "backend.composio.dev"],
        allowRedirects: false,
      },
      timeoutMs: item["timeoutMs"] ?? 30_000,
      retry: {
        maxAttempts: sideEffect === "none" ? 2 : 1,
        safeClasses: sideEffect === "none" ? ["transport", "rate_limit"] : [],
      },
      enabled: item["enabled"] ?? true,
    });
    return { manifest, toolSlug, toolVersion, verification: verifier };
  });
}

function evidenceId(value: unknown): string {
  return `evd_${createHash("sha256").update(JSON.stringify(value)).digest("hex").slice(0, 24)}`;
}

function valueAt(root: unknown, path: string): unknown {
  let current = root;
  for (const part of path.split(".")) {
    if (current === null || typeof current !== "object" || Array.isArray(current)) {
      return undefined;
    }
    current = (current as Record<string, unknown>)[part];
  }
  return current;
}

function boundValue(
  valueBinding: ValueBinding,
  input: Readonly<Record<string, unknown>>,
  result: unknown,
): unknown {
  return valueAt(valueBinding.source === "input" ? input : result, valueBinding.path);
}

function sameValue(
  left: unknown,
  right: unknown,
  comparison: "exact" | "trimmed_text" = "exact",
): boolean {
  if (comparison === "trimmed_text") {
    return (
      typeof left === "string" &&
      typeof right === "string" &&
      left.replaceAll("\r\n", "\n").trim() === right.replaceAll("\r\n", "\n").trim()
    );
  }
  return JSON.stringify(left) === JSON.stringify(right);
}

function adapter(
  configuration: ConfiguredComposioTool,
  connections: ConnectionManager,
): ToolAdapter {
  return {
    manifest: configuration.manifest,
    execute: async (input, context, cancellation) => {
      if (context.connectionId === null) {
        throw new Error("CONNECTION_REQUIRED: a Composio connection is required.");
      }
      const result = await connections.executeComposioTool({
        tenantId: context.tenantId,
        connectionId: context.connectionId,
        taskId: context.taskId,
        adapter: configuration.manifest.name,
        toolSlug: configuration.toolSlug,
        toolVersion: configuration.toolVersion,
        arguments: input,
        signal: cancellation.signal,
      });
      if (!result.successful) {
        return {
          status: "FAILED",
          data: null,
          sanitizedMessage: "The connected provider did not complete the requested action.",
          provider: result.logId === null ? {} : { requestId: result.logId },
          retryable: configuration.manifest.sideEffect === "none",
          errorClass: "unknown",
          sideEffectState:
            configuration.manifest.sideEffect === "none" ? "definitely_not_started" : "unknown",
          evidenceIds: [],
          usage: { durationMs: 0, costMinor: 0, currency: "USD" },
        };
      }
      const evidence = { logId: result.logId, data: result.data };
      return {
        status: "SUCCEEDED",
        data: result.data,
        sanitizedMessage: "The connected provider completed the requested action.",
        provider: result.logId === null ? {} : { requestId: result.logId },
        retryable: false,
        errorClass: "none",
        sideEffectState:
          configuration.manifest.sideEffect === "none"
            ? "definitely_not_started"
            : "definitely_completed",
        evidenceIds: [evidenceId(evidence)],
        verificationHint: "Composio reported a successful provider execution.",
        usage: { durationMs: 0, costMinor: 0, currency: "USD" },
      };
    },
    verify: async (input, result, context, cancellation) => {
      const providerPassed = result.status === "SUCCEEDED" && result.evidenceIds.length > 0;
      if (!providerPassed || configuration.manifest.sideEffect === "none") {
        return {
          ...result,
          status: providerPassed ? "SUCCEEDED" : "FAILED",
          sanitizedMessage: providerPassed
            ? result.sanitizedMessage
            : "Provider execution evidence was unavailable; completion was not claimed.",
        };
      }
      const verifier = configuration.verification;
      if (verifier === null || context.connectionId === null) {
        return {
          ...result,
          status: "FAILED",
          errorClass: "unknown",
          sideEffectState: "unknown",
          sanitizedMessage:
            "Independent provider verification was unavailable; completion was not claimed.",
        };
      }
      const argumentsMap = Object.fromEntries(
        Object.entries(verifier.arguments).map(([name, valueBinding]) => [
          name,
          boundValue(valueBinding, input, result.data),
        ]),
      );
      if (Object.values(argumentsMap).some((value) => value === undefined)) {
        return {
          ...result,
          status: "FAILED",
          errorClass: "validation",
          sideEffectState: "unknown",
          sanitizedMessage:
            "Provider verification inputs could not be derived from the approved request and result.",
        };
      }
      const observed = await connections.executeComposioTool({
        tenantId: context.tenantId,
        connectionId: context.connectionId,
        taskId: context.taskId,
        adapter: `${configuration.manifest.name}.verify`,
        toolSlug: verifier.toolSlug,
        toolVersion: verifier.toolVersion,
        arguments: argumentsMap,
        signal: cancellation.signal,
      });
      const passed =
        observed.successful &&
        verifier.assertions.every((assertion) =>
          sameValue(
            valueAt(observed.data, assertion.observedPath),
            boundValue(assertion.expected, input, result.data),
            assertion.comparison,
          ),
        );
      const verificationEvidence = {
        logId: observed.logId,
        assertions: verifier.assertions.map((assertion) => ({
          observedPath: assertion.observedPath,
          passed: sameValue(
            valueAt(observed.data, assertion.observedPath),
            boundValue(assertion.expected, input, result.data),
            assertion.comparison,
          ),
        })),
      };
      return {
        ...result,
        status: passed ? "SUCCEEDED" : "FAILED",
        errorClass: passed ? "none" : "unknown",
        sideEffectState: passed ? "definitely_completed" : "unknown",
        evidenceIds: [...result.evidenceIds, evidenceId(verificationEvidence)],
        sanitizedMessage: passed
          ? "The connected provider action was independently verified by a separate read."
          : "The provider read-after-write verification did not match; completion was not claimed.",
      };
    },
  };
}

export function registerConfiguredComposioTools(
  registry: ToolRegistry,
  connections: ConnectionManager,
  rawConfiguration: string | undefined,
): number {
  const tools = parseTools(rawConfiguration);
  for (const configuration of tools) registry.register(adapter(configuration, connections));
  return tools.length;
}
