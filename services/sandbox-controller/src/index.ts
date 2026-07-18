import { execFile } from "node:child_process";
import { createHmac, randomUUID } from "node:crypto";
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

export class AdapterSigner {
  public constructor(private readonly signingKey: Uint8Array) {
    if (signingKey.byteLength < 32)
      throw new Error("Adapter signing key must be at least 32 bytes.");
  }

  public sign(manifest: Record<string, unknown>): { digest: string; signature: string } {
    const material = canonicalJson(manifest);
    return {
      digest: sha256(manifest),
      signature: createHmac("sha256", this.signingKey).update(material).digest("base64url"),
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
