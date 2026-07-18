import { execFile } from "node:child_process";
import { createHmac, randomUUID } from "node:crypto";
import {
  GetPublicKeyCommand,
  KMSClient,
  SignCommand,
  type KMSClientConfig,
} from "@aws-sdk/client-kms";
import { relative, resolve } from "node:path";
import { promisify } from "node:util";

import { z } from "zod";

import { canonicalJson, sha256 } from "@signal/event-sdk";

const execFileAsync = promisify(execFile);

export const sandboxJobSchema = z
  .object({
    id: z.string().min(8),
    image: z.string().min(1),
    workspacePath: z.string().min(1),
    command: z.array(z.string().min(1)).min(1),
    timeoutMs: z
      .int()
      .min(1_000)
      .max(30 * 60_000),
    networkMode: z.enum(["none", "provider-sandbox-proxy"]),
    egressDomains: z.array(z.string().min(1)).max(50),
    files: z
      .array(
        z
          .object({
            path: z.string().min(1).max(1_000),
            contentBase64: z.string().max(10 * 1024 * 1024),
          })
          .strict(),
      )
      .max(500)
      .optional(),
  })
  .strict();

export type SandboxJob = z.infer<typeof sandboxJobSchema>;
export type SandboxResult = {
  exitCode: number;
  stdout: string;
  stderr: string;
  timedOut: boolean;
};

export interface CodeSandboxProvider {
  run(job: SandboxJob): Promise<SandboxResult>;
}

export class RemoteSandboxProvider implements CodeSandboxProvider {
  public constructor(
    private readonly endpoint: string,
    private readonly serviceToken: string,
    private readonly fetcher: typeof fetch = fetch,
  ) {}

  public async run(rawJob: SandboxJob): Promise<SandboxResult> {
    const job = sandboxJobSchema.parse(rawJob);
    const body = JSON.stringify(job);
    for (let attempt = 0; attempt < 5; attempt += 1) {
      const response = await this.fetcher(`${this.endpoint.replace(/\/$/, "")}/v1/execute`, {
        method: "POST",
        headers: {
          authorization: `Bearer ${this.serviceToken}`,
          "content-type": "application/json",
        },
        body,
        signal: AbortSignal.timeout(job.timeoutMs + 180_000),
      });
      if (response.ok) return (await response.json()) as SandboxResult;
      if (response.status !== 429 || attempt === 4) {
        throw new Error(`Isolated sandbox executor returned HTTP ${response.status}.`);
      }
      const retrySeconds = Math.min(
        5,
        Math.max(1, Number(response.headers.get("retry-after") ?? 1)),
      );
      await new Promise((resolve) => setTimeout(resolve, retrySeconds * 1_000));
    }
    throw new Error("Isolated sandbox executor queue did not become available.");
  }
}

export const capabilityGapSchema = z
  .object({
    requiredAction: z.string().min(1).max(500),
    minimalInputs: z.record(z.string(), z.unknown()),
    expectedOutput: z.record(z.string(), z.unknown()),
    provider: z.string().regex(/^[a-z][a-z0-9-]{1,62}$/),
    providerDomain: z.string().min(3).max(253),
    authMethod: z.enum(["oauth2", "api_key", "basic", "none"]),
    scopes: z.array(z.string().min(1).max(500)).max(100),
    riskClass: z.enum(["R0", "R1", "R2", "R3", "R4"]),
    sideEffect: z.enum(["none", "reversible", "external", "financial", "irreversible"]),
    idempotency: z.enum(["none", "provider_key", "state_check", "read_only"]),
    successEvidence: z.string().min(1).max(2_000),
    documentationUrls: z.array(z.url()).max(20).default([]),
  })
  .strict();

export type CapabilityGap = z.infer<typeof capabilityGapSchema>;

export class DockerSandboxProvider implements CodeSandboxProvider {
  public constructor(
    private readonly dockerBinary = "docker",
    private readonly allowedWorkspaceRoot = resolve(process.cwd(), "integrations/generated"),
  ) {}

  public async run(rawJob: SandboxJob): Promise<SandboxResult> {
    const job = sandboxJobSchema.parse(rawJob);
    const workspacePath = resolve(job.workspacePath);
    const workspaceRelative = relative(this.allowedWorkspaceRoot, workspacePath);
    if (workspaceRelative.startsWith("..") || workspaceRelative.startsWith("/")) {
      throw new Error("Sandbox workspace must be an isolated generated-adapter directory.");
    }
    if (job.networkMode === "provider-sandbox-proxy" && job.egressDomains.length === 0) {
      throw new Error("Sandbox proxy mode requires an explicit provider-domain allowlist.");
    }
    const network = job.networkMode === "none" ? "none" : "signal-sandbox-proxy";
    const args = [
      "run",
      "--rm",
      "--network",
      network,
      "--read-only",
      "--cap-drop=ALL",
      "--security-opt=no-new-privileges",
      "--pids-limit=128",
      "--memory=512m",
      "--cpus=1",
      "--user=65532:65532",
      "--tmpfs=/tmp:rw,noexec,nosuid,size=128m",
      `--mount=type=bind,source=${workspacePath},target=/workspace`,
      "--workdir=/workspace",
      ...job.egressDomains.flatMap((domain) => ["--env", `SIGNAL_EGRESS_DOMAIN=${domain}`]),
      job.image,
      ...job.command,
    ];
    try {
      const result = await execFileAsync(this.dockerBinary, args, {
        timeout: job.timeoutMs,
        maxBuffer: 10 * 1024 * 1024,
      });
      return { exitCode: 0, stdout: result.stdout, stderr: result.stderr, timedOut: false };
    } catch (error) {
      const failure = error as {
        code?: number | string;
        stdout?: string;
        stderr?: string;
        killed?: boolean;
      };
      return {
        exitCode: typeof failure.code === "number" ? failure.code : 1,
        stdout: failure.stdout ?? "",
        stderr: failure.stderr ?? "Sandbox process failed.",
        timedOut: failure.killed === true,
      };
    }
  }
}

export const adapterStages = [
  "format",
  "lint",
  "type-check",
  "unit-tests",
  "schema-tests",
  "mock-contract-tests",
  "auth-tests",
  "provider-sandbox-tests",
  "failure-retry-tests",
  "idempotency-tests",
  "secret-scan",
  "sast",
  "dependency-scan",
  "license-scan",
  "sbom",
  "build-sign",
  "risk-review",
  "approval",
  "tenant-canary",
  "runtime-verification",
] as const;

export type AdapterStage = (typeof adapterStages)[number];
export type StageResult = { passed: boolean; summary: string; evidenceDigest: string };
export type StageRunner = (stage: AdapterStage) => Promise<StageResult>;

const protectedPrefixes = [
  "services/api/",
  "services/connection-service/",
  "services/tool-gateway/",
  "services/sandbox-controller/",
  "packages/auth-sdk/",
  "packages/policy-client/",
  "infra/",
  ".github/",
];

export function assertGeneratedChangesScoped(paths: readonly string[]): void {
  for (const path of paths) {
    if (
      !path.startsWith("integrations/generated/") ||
      protectedPrefixes.some((prefix) => path.startsWith(prefix))
    ) {
      throw new Error(`Generated adapter attempted to modify protected path: ${path}`);
    }
    if (path.includes("..") || path.startsWith("/"))
      throw new Error(`Unsafe generated path: ${path}`);
  }
}

export type AdapterSignature = {
  digest: string;
  signature: string;
  algorithm: "HMAC_SHA_256" | "RSASSA_PSS_SHA_256";
  keyId: string;
  publicKey: string | null;
};

export type AdapterSigningIdentity = {
  sign(manifest: Record<string, unknown>): Promise<AdapterSignature>;
};

export class AdapterSigner implements AdapterSigningIdentity {
  public constructor(private readonly signingKey: Uint8Array) {
    if (signingKey.byteLength < 32)
      throw new Error("Adapter signing key must be at least 32 bytes.");
  }

  public async sign(manifest: Record<string, unknown>): Promise<AdapterSignature> {
    const material = canonicalJson(manifest);
    return {
      digest: sha256(manifest),
      signature: createHmac("sha256", this.signingKey).update(material).digest("base64url"),
      algorithm: "HMAC_SHA_256",
      keyId: "local-development",
      publicKey: null,
    };
  }
}

export class AwsKmsAdapterSigner implements AdapterSigningIdentity {
  readonly #client: KMSClient;

  public constructor(
    private readonly keyId: string,
    config: KMSClientConfig = {},
  ) {
    this.#client = new KMSClient(config);
  }

  public async sign(manifest: Record<string, unknown>): Promise<AdapterSignature> {
    const digestValue = sha256(manifest);
    const digestBytes = Buffer.from(digestValue.slice("sha256:".length), "hex");
    const [signed, publicKey] = await Promise.all([
      this.#client.send(
        new SignCommand({
          KeyId: this.keyId,
          Message: digestBytes,
          MessageType: "DIGEST",
          SigningAlgorithm: "RSASSA_PSS_SHA_256",
        }),
      ),
      this.#client.send(new GetPublicKeyCommand({ KeyId: this.keyId })),
    ]);
    if (signed.Signature === undefined || publicKey.PublicKey === undefined) {
      throw new Error("KMS signing identity did not return a signature and public key.");
    }
    return {
      digest: digestValue,
      signature: Buffer.from(signed.Signature).toString("base64url"),
      algorithm: "RSASSA_PSS_SHA_256",
      keyId: signed.KeyId ?? this.keyId,
      publicKey: Buffer.from(publicKey.PublicKey).toString("base64"),
    };
  }
}

export class GeneratedAdapterPipeline {
  public async execute(input: {
    packagePaths: string[];
    runStage: StageRunner;
    rollback: () => Promise<void>;
  }): Promise<{
    id: string;
    status: "DEPLOYED" | "FAILED" | "ROLLED_BACK";
    stages: { stage: AdapterStage; result: StageResult }[];
  }> {
    assertGeneratedChangesScoped(input.packagePaths);
    const stages: { stage: AdapterStage; result: StageResult }[] = [];
    for (const stage of adapterStages) {
      const result = await input.runStage(stage);
      stages.push({ stage, result });
      if (!result.passed) {
        if (stage === "tenant-canary" || stage === "runtime-verification") {
          await input.rollback();
          return { id: `adp_${randomUUID().replaceAll("-", "")}`, status: "ROLLED_BACK", stages };
        }
        return { id: `adp_${randomUUID().replaceAll("-", "")}`, status: "FAILED", stages };
      }
    }
    return { id: `adp_${randomUUID().replaceAll("-", "")}`, status: "DEPLOYED", stages };
  }
}
