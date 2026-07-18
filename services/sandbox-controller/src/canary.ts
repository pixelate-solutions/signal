import { createHash } from "node:crypto";
import { lookup } from "node:dns/promises";
import { isIP } from "node:net";
import { fileURLToPath } from "node:url";

import Fastify, { type FastifyInstance } from "fastify";
import ipaddr from "ipaddr.js";
import { z } from "zod";

import { sha256 } from "@signal/event-sdk";

const candidateSchema = z
  .object({
    candidateId: z.string().min(8).max(100),
    candidateDigest: z.string().regex(/^sha256:[a-f0-9]{64}$/),
    provider: z.string().regex(/^[a-z][a-z0-9-]{1,62}$/),
    sideEffect: z.enum(["none", "reversible", "external", "financial", "irreversible"]),
    runtime: z
      .object({
        method: z.enum(["GET", "POST", "PUT", "PATCH", "DELETE"]),
        path: z.string().startsWith("/").max(2_000),
      })
      .strict(),
  })
  .strict();

const providerConfigSchema = z
  .object({
    baseUrl: z.url().refine((value) => value.startsWith("https://"), "HTTPS is required."),
    input: z.record(z.string(), z.unknown()),
    headers: z.record(z.string(), z.string()).default({}),
    allowedMethods: z
      .array(z.enum(["GET", "POST", "PUT", "PATCH", "DELETE"]))
      .min(1)
      .max(5),
    sideEffectsAllowed: z.boolean(),
    expectedStatusCodes: z.array(z.int().min(200).max(299)).min(1).max(20),
    expectedJson: z.record(z.string(), z.unknown()).default({}),
  })
  .strict();

const configSchema = z.record(z.string(), providerConfigSchema);
type ProviderConfig = z.infer<typeof providerConfigSchema>;
type AddressResolver = (
  hostname: string,
) => Promise<readonly { address: string; family: number }[]>;

function publicAddress(address: string): boolean {
  try {
    return ipaddr.process(address).range() === "unicast";
  } catch {
    return false;
  }
}

function safeHeaders(config: ProviderConfig): Record<string, string> {
  const blocked = new Set([
    "connection",
    "content-length",
    "cookie",
    "forwarded",
    "host",
    "proxy-authorization",
    "transfer-encoding",
    "x-forwarded-for",
    "x-forwarded-host",
  ]);
  const headers: Record<string, string> = { accept: "application/json" };
  for (const [rawName, value] of Object.entries(config.headers)) {
    const name = rawName.toLowerCase();
    if (!/^[a-z0-9-]{1,100}$/.test(name) || blocked.has(name)) {
      throw new Error(`Canary header ${rawName} is forbidden.`);
    }
    if (/\r|\n/.test(value)) throw new Error(`Canary header ${rawName} is malformed.`);
    headers[name] = value;
  }
  return headers;
}

function scalarString(value: unknown): string {
  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }
  throw new Error("Canary query and path values must be strings, numbers, or booleans.");
}

function endpoint(
  config: ProviderConfig,
  runtime: z.infer<typeof candidateSchema>["runtime"],
): { url: URL; body: string | undefined } {
  const input = config.input;
  const consumed = new Set<string>();
  const path = runtime.path.replace(/\{([^}]+)\}/g, (_match, name: string) => {
    if (!(name in input)) throw new Error(`Canary input is missing path parameter ${name}.`);
    consumed.add(name);
    return encodeURIComponent(scalarString(input[name]));
  });
  const url = new URL(config.baseUrl);
  url.pathname = `${url.pathname.replace(/\/$/, "")}/${path.replace(/^\//, "")}`;
  url.search = "";
  url.hash = "";
  const remainder = Object.entries(input).filter(([name]) => !consumed.has(name));
  if (runtime.method === "GET") {
    for (const [name, value] of remainder) {
      if (value !== undefined && value !== null) url.searchParams.set(name, scalarString(value));
    }
    return { url, body: undefined };
  }
  return { url, body: JSON.stringify(Object.fromEntries(remainder)) };
}

async function boundedResponse(response: Response): Promise<string> {
  if (response.body === null) return "";
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let bytes = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    bytes += value.byteLength;
    if (bytes > 1024 * 1024) {
      await reader.cancel();
      throw new Error("Provider canary response exceeded 1 MiB.");
    }
    chunks.push(value);
  }
  return new TextDecoder().decode(Buffer.concat(chunks.map((chunk) => Buffer.from(chunk))));
}

function expectedJsonMatches(body: string, expected: Record<string, unknown>): boolean {
  if (Object.keys(expected).length === 0) return true;
  try {
    const actual = JSON.parse(body) as Record<string, unknown>;
    return Object.entries(expected).every(
      ([key, value]) => JSON.stringify(actual[key]) === JSON.stringify(value),
    );
  } catch {
    return false;
  }
}

export async function createGeneratedCanaryHost(
  options: {
    token?: string;
    configJson?: string;
    fetcher?: typeof fetch;
    resolver?: AddressResolver;
    logger?: boolean;
  } = {},
): Promise<FastifyInstance> {
  const expectedToken = options.token ?? process.env["GENERATED_CANARY_TOKEN"];
  const config = configSchema.parse(
    JSON.parse(options.configJson ?? process.env["GENERATED_CANARY_CONFIG_JSON"] ?? "{}"),
  );
  const fetcher = options.fetcher ?? fetch;
  const resolver: AddressResolver =
    options.resolver ?? ((hostname) => lookup(hostname, { all: true, verbatim: true }));
  const app = Fastify({ logger: options.logger ?? true, bodyLimit: 512 * 1024 });

  app.get("/health", async () => ({ status: "ok", service: "generated-provider-canary" }));
  app.post("/v1/canary", async (request, reply) => {
    if (
      expectedToken === undefined ||
      request.headers.authorization !== `Bearer ${expectedToken}`
    ) {
      return reply.code(401).send({ passed: false, summary: "Canary authentication failed." });
    }
    const parsed = candidateSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(422).send({ passed: false, summary: "Invalid canary candidate." });
    }
    const candidate = parsed.data;
    const provider = config[candidate.provider];
    if (provider === undefined) {
      return {
        passed: false,
        summary: `No operator-approved staging canary exists for ${candidate.provider}.`,
        evidenceDigest: sha256({ candidate: candidate.candidateDigest, configured: false }),
      };
    }
    if (!provider.allowedMethods.includes(candidate.runtime.method)) {
      return {
        passed: false,
        summary: "The generated method is outside the staging canary allowlist.",
        evidenceDigest: sha256({ candidate: candidate.candidateDigest, methodAllowed: false }),
      };
    }
    if (candidate.sideEffect !== "none" && !provider.sideEffectsAllowed) {
      return {
        passed: false,
        summary: "Side effects are disabled for this staging canary.",
        evidenceDigest: sha256({ candidate: candidate.candidateDigest, sideEffectsAllowed: false }),
      };
    }
    try {
      const target = endpoint(provider, candidate.runtime);
      const addresses = isIP(target.url.hostname)
        ? [{ address: target.url.hostname, family: isIP(target.url.hostname) }]
        : await resolver(target.url.hostname);
      if (addresses.length === 0 || addresses.some(({ address }) => !publicAddress(address))) {
        throw new Error("Canary endpoint resolved to a private or reserved address.");
      }
      const headers = safeHeaders(provider);
      headers["idempotency-key"] = `signal-canary-${candidate.candidateId}`;
      if (target.body !== undefined) headers["content-type"] = "application/json";
      const response = await fetcher(target.url, {
        method: candidate.runtime.method,
        headers,
        ...(target.body === undefined ? {} : { body: target.body }),
        redirect: "error",
        signal: AbortSignal.timeout(60_000),
      });
      const body = await boundedResponse(response);
      const bodyHash = `sha256:${createHash("sha256").update(body).digest("hex")}`;
      const statusAccepted = provider.expectedStatusCodes.includes(response.status);
      const bodyAccepted = expectedJsonMatches(body, provider.expectedJson);
      const passed = statusAccepted && bodyAccepted;
      return {
        passed,
        summary: passed
          ? `Provider staging canary returned an approved HTTP ${response.status} response.`
          : "Provider staging canary response did not match the approved contract.",
        evidenceDigest: sha256({
          candidate: candidate.candidateDigest,
          provider: candidate.provider,
          status: response.status,
          bodyHash,
        }),
      };
    } catch (error) {
      return {
        passed: false,
        summary: error instanceof Error ? error.message : "Provider staging canary failed.",
        evidenceDigest: sha256({
          candidate: candidate.candidateDigest,
          provider: candidate.provider,
          errorClass: error instanceof Error ? error.name : "unknown",
        }),
      };
    }
  });
  return app;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const app = await createGeneratedCanaryHost();
  await app.listen({ host: "0.0.0.0", port: Number(process.env["PORT"] ?? 3375) });
}
