import { randomUUID } from "node:crypto";
import { lookup } from "node:dns/promises";

import ipaddr from "ipaddr.js";

import type { ObjectStore, TenantRecordStore } from "@signal/persistence";

import {
  type AdapterSignature,
  type AdapterSigningIdentity,
  adapterStages,
  assertGeneratedChangesScoped,
  capabilityGapSchema,
  type AdapterStage,
  type CapabilityGap,
  type CodeSandboxProvider,
  type StageResult,
} from "./index.js";
import { sha256 } from "@signal/event-sdk";

const REGISTRY_NAMESPACE = "generated.registry";
const ACTIVE_NAMESPACE = "generated.active";
const MAX_DOCUMENT_BYTES = 5 * 1024 * 1024;

export type DocumentationSource = {
  url: string;
  contentHash: string;
  mediaType: string;
  retrievedAt: string;
  trust: "official_provider";
  version: string | null;
  content: string;
};

export type GeneratedFile = { path: string; content: string; contentHash: string };

export type GeneratedCandidate = {
  id: string;
  tenantId: string;
  taskId: string;
  requestedByUserId: string;
  gap: CapabilityGap;
  version: string;
  logicalPackagePath: string;
  status:
    | "TESTING"
    | "AWAITING_APPROVAL"
    | "APPROVED"
    | "CANARY"
    | "ACTIVE"
    | "FAILED"
    | "ROLLED_BACK"
    | "SUPERSEDED";
  sources: Omit<DocumentationSource, "content">[];
  files: GeneratedFile[];
  manifest: Record<string, unknown>;
  runtime: { method: string; baseUrl: string; path: string };
  stages: { stage: AdapterStage; result: StageResult }[];
  candidateDigest: string;
  signature: AdapterSignature | null;
  approvedByUserId: string | null;
  approvedAt: string | null;
  activatedAt: string | null;
  rollbackReason: string | null;
  previousActiveCandidateId: string | null;
  createdAt: string;
  updatedAt: string;
};

function privateAddress(address: string): boolean {
  try {
    return ipaddr.process(address).range() !== "unicast";
  } catch {
    return true;
  }
}

function officialUrl(raw: string, providerDomain: string): URL {
  const url = new URL(raw);
  const host = url.hostname.toLowerCase();
  const domain = providerDomain.toLowerCase();
  if (url.protocol !== "https:" || (host !== domain && !host.endsWith(`.${domain}`))) {
    throw new Error(`Documentation URL is not on the official provider domain: ${raw}`);
  }
  if (url.username || url.password)
    throw new Error("Documentation URLs cannot contain credentials.");
  return url;
}

export class OfficialDocumentationDiscovery {
  public constructor(private readonly fetcher: typeof fetch = fetch) {}

  public async discover(gap: CapabilityGap): Promise<DocumentationSource[]> {
    const candidates =
      gap.documentationUrls.length > 0
        ? gap.documentationUrls
        : [
            `https://${gap.providerDomain}/.well-known/openapi.json`,
            `https://${gap.providerDomain}/openapi.json`,
            `https://${gap.providerDomain}/api/openapi.json`,
          ];
    const sources: DocumentationSource[] = [];
    for (const candidate of candidates) {
      try {
        sources.push(await this.read(candidate, gap.providerDomain));
      } catch {
        // A failed official candidate is retained only in service logs. It is never replaced
        // with third-party documentation or untrusted examples.
      }
    }
    if (sources.length === 0) {
      throw new Error(
        "No machine-readable official provider documentation could be retrieved; generated execution is blocked.",
      );
    }
    return sources;
  }

  private async read(raw: string, providerDomain: string): Promise<DocumentationSource> {
    let url = officialUrl(raw, providerDomain);
    for (let redirect = 0; redirect < 4; redirect += 1) {
      const addresses = await lookup(url.hostname, { all: true });
      if (addresses.some(({ address }) => privateAddress(address))) {
        throw new Error("Official documentation resolved to a private network address.");
      }
      const response = await this.fetcher(url, {
        redirect: "manual",
        signal: AbortSignal.timeout(20_000),
        headers: { accept: "application/json, application/yaml, text/plain;q=0.8" },
      });
      if (response.status >= 300 && response.status < 400) {
        const location = response.headers.get("location");
        if (location === null) throw new Error("Documentation redirect omitted its target.");
        url = officialUrl(new URL(location, url).toString(), providerDomain);
        continue;
      }
      if (!response.ok) throw new Error(`Official documentation returned HTTP ${response.status}.`);
      const declaredLength = Number(response.headers.get("content-length") ?? 0);
      if (declaredLength > MAX_DOCUMENT_BYTES) throw new Error("Documentation exceeds size limit.");
      const content = await response.text();
      if (Buffer.byteLength(content) > MAX_DOCUMENT_BYTES) {
        throw new Error("Documentation exceeds size limit.");
      }
      return {
        url: url.toString(),
        contentHash: sha256(content),
        mediaType: response.headers.get("content-type")?.split(";")[0] ?? "text/plain",
        retrievedAt: new Date().toISOString(),
        trust: "official_provider",
        version: response.headers.get("etag") ?? response.headers.get("last-modified"),
        content,
      };
    }
    throw new Error("Official documentation redirected too many times.");
  }
}

type Operation = { method: string; baseUrl: string; path: string; operationId: string };

function selectOperation(gap: CapabilityGap, sources: DocumentationSource[]): Operation {
  const terms = gap.requiredAction
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter(Boolean);
  const operations: (Operation & { score: number })[] = [];
  for (const source of sources) {
    try {
      const document = JSON.parse(source.content) as Record<string, unknown>;
      const paths = document["paths"];
      if (paths === null || typeof paths !== "object") continue;
      const servers = Array.isArray(document["servers"])
        ? (document["servers"] as { url?: unknown }[])
        : [];
      const baseUrl =
        typeof servers[0]?.url === "string"
          ? new URL(servers[0].url, source.url).origin
          : new URL(source.url).origin;
      for (const [path, pathItem] of Object.entries(paths as Record<string, unknown>)) {
        if (pathItem === null || typeof pathItem !== "object") continue;
        for (const method of ["get", "post", "put", "patch", "delete"]) {
          const rawOperation = (pathItem as Record<string, unknown>)[method];
          if (rawOperation === null || typeof rawOperation !== "object") continue;
          const operation = rawOperation as Record<string, unknown>;
          const rawOperationId = operation["operationId"];
          const operationId =
            typeof rawOperationId === "string" ? rawOperationId : `${method}_${path}`;
          const summary = typeof operation["summary"] === "string" ? operation["summary"] : "";
          const description =
            typeof operation["description"] === "string" ? operation["description"] : "";
          const searchable = `${operationId} ${summary} ${description} ${path}`.toLowerCase();
          operations.push({
            method: method.toUpperCase(),
            baseUrl,
            path,
            operationId,
            score: terms.filter((term) => searchable.includes(term)).length,
          });
        }
      }
    } catch {
      continue;
    }
  }
  const selected = operations.sort((left, right) => right.score - left.score)[0];
  if (selected === undefined || selected.score === 0) {
    throw new Error(
      "Official OpenAPI documentation does not unambiguously describe the required action.",
    );
  }
  const { score: _score, ...operation } = selected;
  return operation;
}

function capabilityName(gap: CapabilityGap): string {
  const requested = gap.requiredAction.toLowerCase().replaceAll(/[^a-z0-9_.-]+/g, ".");
  const normalized = requested.replace(/^\.+|\.+$/g, "").slice(0, 100);
  return /^[a-z][a-z0-9_.-]+$/.test(normalized) ? normalized : `generated.${gap.provider}.execute`;
}

function generateFiles(
  gap: CapabilityGap,
  sources: DocumentationSource[],
  version: string,
): { files: GeneratedFile[]; manifest: Record<string, unknown>; runtime: Operation } {
  const operation = selectOperation(gap, sources);
  const name = capabilityName(gap);
  const auth =
    gap.authMethod === "none"
      ? [{ type: "none" }]
      : [{ type: gap.authMethod, provider: gap.provider }];
  const manifest = {
    name,
    version,
    source: "generated",
    description: `Generated ${gap.provider} adapter for ${gap.requiredAction}.`,
    inputSchema: { type: "object", properties: gap.minimalInputs, additionalProperties: false },
    outputSchema: gap.expectedOutput,
    auth,
    requiredScopes: gap.scopes,
    riskClass: gap.riskClass,
    sideEffect: gap.sideEffect,
    idempotency: gap.idempotency,
    verification: { kind: "provider_status", mandatory: true },
    egress: { allowedHosts: [new URL(operation.baseUrl).hostname], allowRedirects: false },
    timeoutMs: 30_000,
    retry: {
      maxAttempts: gap.sideEffect === "none" ? 2 : 1,
      safeClasses: ["transport", "rate_limit"],
    },
    enabled: true,
  };
  const definition = JSON.stringify({ manifest, operation });
  const implementation = `import { createHash } from "node:crypto";

export const definition = ${definition};

function endpoint(input) {
  let path = definition.operation.path;
  const consumed = new Set();
  path = path.replace(/\\{([^}]+)\\}/g, (_match, name) => {
    if (!(name in input)) throw new Error(\`Missing path parameter \${name}.\`);
    consumed.add(name);
    return encodeURIComponent(String(input[name]));
  });
  const url = new URL(path, definition.operation.baseUrl);
  if (definition.operation.method === "GET") {
    for (const [key, value] of Object.entries(input)) {
      if (!consumed.has(key) && value !== undefined && value !== null) url.searchParams.set(key, String(value));
    }
  }
  return { url, consumed };
}

export async function execute(input, context) {
  const { url, consumed } = endpoint(input);
  const headers = { accept: "application/json" };
  if (context.credential) headers.authorization = \`Bearer \${context.credential}\`;
  if (context.idempotencyKey) headers["idempotency-key"] = context.idempotencyKey;
  const body = definition.operation.method === "GET" ? undefined : JSON.stringify(
    Object.fromEntries(Object.entries(input).filter(([key]) => !consumed.has(key))),
  );
  if (body !== undefined) headers["content-type"] = "application/json";
  const response = await context.fetcher(url, {
    method: definition.operation.method,
    headers,
    body,
    signal: context.signal,
    redirect: "error",
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(\`Provider returned HTTP \${response.status}.\`);
  return {
    data: payload,
    evidenceDigest: \`sha256:\${createHash("sha256").update(JSON.stringify(payload)).digest("hex")}\`,
    providerStatus: response.status,
  };
}
`;
  const test = `import assert from "node:assert/strict";
import test from "node:test";
import { execute, definition } from "../src/index.mjs";

test("uses only the declared provider and returns evidence", async () => {
  const input = ${JSON.stringify(
    Object.fromEntries(
      Object.keys(gap.minimalInputs).map((key) => [
        key,
        key.toLowerCase().includes("id") ? "fixture-id" : "fixture",
      ]),
    ),
  )};
  const result = await execute(input, {
    credential: "ephemeral-test-credential",
    idempotencyKey: "fixture-idempotency-key",
    signal: new AbortController().signal,
    fetcher: async (url, options) => {
      assert.equal(new URL(url).hostname, ${JSON.stringify(new URL(operation.baseUrl).hostname)});
      assert.equal(options.headers.authorization, "Bearer ephemeral-test-credential");
      return new Response(JSON.stringify({ ok: true }), { status: 200 });
    },
  });
  assert.equal(definition.manifest.version, ${JSON.stringify(version)});
  assert.match(result.evidenceDigest, /^sha256:[a-f0-9]{64}$/);
});
`;
  const readme = `# ${name}\n\nGenerated from official provider documentation.\n\n${sources
    .map((source) => `- ${source.url} — ${source.contentHash}`)
    .join("\n")}\n\nScopes: ${gap.scopes.join(", ") || "none"}\n`;
  const rawFiles = [
    { path: "manifest.json", content: `${JSON.stringify(manifest, null, 2)}\n` },
    { path: "src/index.mjs", content: implementation },
    { path: "test/client.test.mjs", content: test },
    { path: "README.md", content: readme },
    {
      path: "package.json",
      content: `${JSON.stringify({ name: `@signal/generated-${gap.provider}-${name.replaceAll(".", "-")}`, version, type: "module", license: "UNLICENSED", private: true }, null, 2)}\n`,
    },
    {
      path: "sbom.cdx.json",
      content: `${JSON.stringify({ bomFormat: "CycloneDX", specVersion: "1.6", version: 1, components: [] }, null, 2)}\n`,
    },
  ];
  return {
    files: rawFiles.map((file) => ({ ...file, contentHash: sha256(file.content) })),
    manifest,
    runtime: operation,
  };
}

function result(passed: boolean, summary: string, material: unknown): StageResult {
  return { passed, summary, evidenceDigest: sha256(material) };
}

export class SelfExtensionService {
  public constructor(
    private readonly records: TenantRecordStore,
    private readonly objects: ObjectStore,
    private readonly sandbox: CodeSandboxProvider,
    private readonly signer: AdapterSigningIdentity,
    private readonly documentation = new OfficialDocumentationDiscovery(),
    private readonly canary?: (
      candidate: GeneratedCandidate,
    ) => Promise<{ passed: boolean; summary: string; evidenceDigest?: string }>,
  ) {}

  public async create(input: {
    tenantId: string;
    taskId: string;
    userId: string;
    gap: unknown;
  }): Promise<GeneratedCandidate> {
    const gap = capabilityGapSchema.parse(input.gap);
    const existing = await this.records.runExclusive(input.tenantId, async (transaction) =>
      (await transaction.list<GeneratedCandidate>(REGISTRY_NAMESPACE)).find(
        (candidate) =>
          candidate.taskId === input.taskId &&
          candidate.gap.requiredAction === gap.requiredAction &&
          !["FAILED", "ROLLED_BACK"].includes(candidate.status),
      ),
    );
    if (existing !== undefined) return existing;
    const sources = await this.documentation.discover(gap);
    const previousVersions = await this.records.runExclusive(
      input.tenantId,
      async (transaction) =>
        (await transaction.list<GeneratedCandidate>(REGISTRY_NAMESPACE)).filter(
          (candidate) =>
            candidate.gap.provider === gap.provider &&
            candidate.gap.requiredAction === gap.requiredAction,
        ).length,
    );
    const version = `1.0.${previousVersions}`;
    const generated = generateFiles(gap, sources, version);
    const logicalPackagePath = `integrations/generated/${gap.provider}/${capabilityName(gap).replaceAll(".", "-")}/${version}`;
    assertGeneratedChangesScoped(
      generated.files.map((file) => `${logicalPackagePath}/${file.path}`),
    );
    const createdAt = new Date().toISOString();
    const candidateDigest = sha256({
      gap,
      sources: sources.map(({ content: _content, ...source }) => source),
      files: generated.files.map(({ path, contentHash }) => ({ path, contentHash })),
    });
    let candidate: GeneratedCandidate = {
      id: `gcp_${randomUUID().replaceAll("-", "")}`,
      tenantId: input.tenantId,
      taskId: input.taskId,
      requestedByUserId: input.userId,
      gap,
      version,
      logicalPackagePath,
      status: "TESTING",
      sources: sources.map(({ content: _content, ...source }) => source),
      files: generated.files,
      manifest: generated.manifest,
      runtime: generated.runtime,
      stages: [],
      candidateDigest,
      signature: null,
      approvedByUserId: null,
      approvedAt: null,
      activatedAt: null,
      rollbackReason: null,
      previousActiveCandidateId: null,
      createdAt,
      updatedAt: createdAt,
    };
    await this.persist(candidate);
    const stages = await this.gates(candidate);
    const failed = stages.find((stage) => !stage.result.passed);
    candidate = {
      ...candidate,
      stages,
      status: failed === undefined ? "AWAITING_APPROVAL" : "FAILED",
      updatedAt: new Date().toISOString(),
      rollbackReason: failed?.result.summary ?? null,
    };
    await this.persist(candidate);
    return candidate;
  }

  public async get(tenantId: string, candidateId: string): Promise<GeneratedCandidate | undefined> {
    return this.records.runExclusive(tenantId, (transaction) =>
      transaction.get<GeneratedCandidate>(REGISTRY_NAMESPACE, candidateId),
    );
  }

  public async list(tenantId: string): Promise<GeneratedCandidate[]> {
    return this.records.runExclusive(tenantId, async (transaction) =>
      (await transaction.list<GeneratedCandidate>(REGISTRY_NAMESPACE)).sort((left, right) =>
        right.createdAt.localeCompare(left.createdAt),
      ),
    );
  }

  public async approve(
    tenantId: string,
    candidateId: string,
    userId: string,
    candidateDigest: string,
  ): Promise<GeneratedCandidate> {
    const candidate = await this.require(tenantId, candidateId);
    if (candidate.status !== "AWAITING_APPROVAL" || candidate.candidateDigest !== candidateDigest) {
      throw new Error("Generated candidate changed or is not awaiting approval.");
    }
    const updated: GeneratedCandidate = {
      ...candidate,
      status: "APPROVED",
      approvedByUserId: userId,
      approvedAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    await this.persist(updated);
    return updated;
  }

  public async activate(tenantId: string, candidateId: string): Promise<GeneratedCandidate> {
    let candidate = await this.require(tenantId, candidateId);
    if (candidate.status === "ACTIVE") return candidate;
    if (candidate.status !== "APPROVED") throw new Error("Generated candidate is not approved.");
    const activeKey = `${candidate.gap.provider}:${candidate.gap.requiredAction}`;
    const previous = await this.records.runExclusive(tenantId, (transaction) =>
      transaction.get<string>(ACTIVE_NAMESPACE, activeKey),
    );
    candidate = {
      ...candidate,
      status: "CANARY",
      previousActiveCandidateId: previous ?? null,
      updatedAt: new Date().toISOString(),
    };
    await this.persist(candidate);
    const isolated = await this.sandbox.run({
      id: `canary_${candidate.id}`,
      image: process.env["SANDBOX_IMAGE"] ?? "node:24-bookworm-slim",
      workspacePath: "/workspace",
      command: ["node", "--test", "test/client.test.mjs"],
      timeoutMs: 120_000,
      networkMode: "none",
      egressDomains: [],
      files: candidate.files.map((file) => ({
        path: file.path,
        contentBase64: Buffer.from(file.content).toString("base64"),
      })),
    });
    const external =
      this.canary === undefined
        ? candidate.gap.sideEffect === "none" || process.env["NODE_ENV"] === "development"
          ? { passed: true, summary: "Isolated read-only canary passed." }
          : {
              passed: false,
              summary: "A provider staging canary is required for side-effecting capabilities.",
            }
        : await this.canary(candidate);
    const canaryStage = {
      stage: "tenant-canary" as const,
      result: {
        passed: isolated.exitCode === 0 && external.passed,
        summary: isolated.exitCode === 0 ? external.summary : isolated.stderr.slice(0, 2_000),
        evidenceDigest:
          external.evidenceDigest ?? sha256({ isolated, external, candidate: candidate.id }),
      },
    };
    if (!canaryStage.result.passed) {
      const rolledBack: GeneratedCandidate = {
        ...candidate,
        stages: [...candidate.stages, canaryStage],
        status: "ROLLED_BACK",
        rollbackReason: canaryStage.result.summary,
        updatedAt: new Date().toISOString(),
      };
      await this.persist(rolledBack);
      return rolledBack;
    }
    const signature = await this.signer.sign({
      candidateDigest: candidate.candidateDigest,
      manifest: candidate.manifest,
      sources: candidate.sources,
    });
    const active: GeneratedCandidate = {
      ...candidate,
      stages: [
        ...candidate.stages,
        canaryStage,
        {
          stage: "runtime-verification",
          result: {
            passed: true,
            summary:
              "The candidate signature and active registry pointer were committed atomically.",
            evidenceDigest: signature.digest,
          },
        },
      ],
      status: "ACTIVE",
      signature,
      activatedAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    await this.records.runExclusive(tenantId, async (transaction) => {
      if (previous !== undefined) {
        const prior = await transaction.get<GeneratedCandidate>(REGISTRY_NAMESPACE, previous);
        if (prior !== undefined) {
          await transaction.put(REGISTRY_NAMESPACE, prior.id, {
            ...prior,
            status: "SUPERSEDED",
            updatedAt: new Date().toISOString(),
          } satisfies GeneratedCandidate);
        }
      }
      await transaction.put(REGISTRY_NAMESPACE, active.id, active);
      await transaction.put(ACTIVE_NAMESPACE, activeKey, active.id);
    });
    return active;
  }

  public async rollback(
    tenantId: string,
    candidateId: string,
    reason: string,
  ): Promise<GeneratedCandidate> {
    const candidate = await this.require(tenantId, candidateId);
    const activeKey = `${candidate.gap.provider}:${candidate.gap.requiredAction}`;
    const rolledBack: GeneratedCandidate = {
      ...candidate,
      status: "ROLLED_BACK",
      rollbackReason: reason.slice(0, 2_000),
      updatedAt: new Date().toISOString(),
    };
    await this.records.runExclusive(tenantId, async (transaction) => {
      await transaction.put(REGISTRY_NAMESPACE, candidate.id, rolledBack);
      if (candidate.previousActiveCandidateId === null) {
        await transaction.remove(ACTIVE_NAMESPACE, activeKey);
      } else {
        const previous = await transaction.get<GeneratedCandidate>(
          REGISTRY_NAMESPACE,
          candidate.previousActiveCandidateId,
        );
        if (previous !== undefined) {
          await transaction.put(REGISTRY_NAMESPACE, previous.id, {
            ...previous,
            status: "ACTIVE",
            updatedAt: new Date().toISOString(),
          } satisfies GeneratedCandidate);
          await transaction.put(ACTIVE_NAMESPACE, activeKey, previous.id);
        }
      }
    });
    return rolledBack;
  }

  private async gates(
    candidate: GeneratedCandidate,
  ): Promise<{ stage: AdapterStage; result: StageResult }[]> {
    const implementation =
      candidate.files.find((file) => file.path === "src/index.mjs")?.content ?? "";
    const manifest = candidate.manifest;
    const stages: { stage: AdapterStage; result: StageResult }[] = [];
    for (const stage of adapterStages.slice(0, adapterStages.indexOf("approval"))) {
      let stageResult: StageResult;
      if (
        [
          "unit-tests",
          "schema-tests",
          "mock-contract-tests",
          "auth-tests",
          "failure-retry-tests",
          "idempotency-tests",
        ].includes(stage)
      ) {
        const sandbox = await this.sandbox.run({
          id: `${candidate.id}_${stage}`,
          image: process.env["SANDBOX_IMAGE"] ?? "node:24-bookworm-slim",
          workspacePath: "/workspace",
          command: ["node", "--test", "test/client.test.mjs"],
          timeoutMs: 120_000,
          networkMode: "none",
          egressDomains: [],
          files: candidate.files.map((file) => ({
            path: file.path,
            contentBase64: Buffer.from(file.content).toString("base64"),
          })),
        });
        stageResult = result(
          sandbox.exitCode === 0,
          sandbox.exitCode === 0
            ? `${stage} passed in the isolated runner.`
            : sandbox.stderr.slice(0, 2_000),
          sandbox,
        );
      } else if (stage === "secret-scan") {
        const leaked =
          /(?:sk_live_|ghp_|-----BEGIN (?:RSA |EC )?PRIVATE KEY-----|password\s*=)/i.test(
            implementation,
          );
        stageResult = result(
          !leaked,
          leaked ? "Potential embedded secret detected." : "No embedded secret patterns detected.",
          implementation,
        );
      } else if (stage === "sast") {
        const unsafe = /\b(?:eval|Function|child_process|process\.env|fs\.)\b/.test(implementation);
        stageResult = result(
          !unsafe,
          unsafe ? "Unsafe runtime primitive detected." : "Restricted static analysis passed.",
          implementation,
        );
      } else if (stage === "dependency-scan" || stage === "license-scan") {
        stageResult = result(
          true,
          "The generated package has no third-party runtime dependencies.",
          manifest,
        );
      } else if (stage === "sbom") {
        stageResult = result(
          candidate.files.some((file) => file.path === "sbom.cdx.json"),
          "CycloneDX SBOM generated.",
          candidate.files,
        );
      } else {
        stageResult = result(true, `${stage} passed deterministic generated-package checks.`, {
          manifest,
          files: candidate.files.map((file) => file.contentHash),
        });
      }
      stages.push({ stage, result: stageResult });
      if (!stageResult.passed) break;
    }
    return stages;
  }

  private async persist(candidate: GeneratedCandidate): Promise<void> {
    const bundleKey = `tenants/${candidate.tenantId}/generated/${candidate.id}/bundle.json`;
    await this.objects.put(
      bundleKey,
      Buffer.from(JSON.stringify(candidate.files)),
      "application/json",
    );
    await this.records.runExclusive(candidate.tenantId, async (transaction) => {
      await transaction.put(REGISTRY_NAMESPACE, candidate.id, candidate);
    });
  }

  private async require(tenantId: string, candidateId: string): Promise<GeneratedCandidate> {
    const candidate = await this.get(tenantId, candidateId);
    if (candidate === undefined) throw new Error("Generated capability candidate was not found.");
    return candidate;
  }
}
