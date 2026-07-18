import { Controller, Get, Headers, Inject, Param, Post, UseGuards } from "@nestjs/common";

import { requireRecentAuthentication, requireRole, type Principal } from "@signal/auth-sdk";
import type { TenantRecordStore } from "@signal/persistence";

import { RequestPrincipal, SignalAuthGuard } from "../auth.js";
import { RECORD_STORE } from "../tokens.js";

type GeneratedCandidateRecord = {
  id: string;
  tenantId: string;
  requestedByUserId: string;
  taskId: string;
  status: string;
  version: string;
  logicalPackagePath: string;
  candidateDigest: string;
  gap: Record<string, unknown>;
  sources: unknown[];
  files: { path: string; content: string; contentHash: string }[];
  stages: unknown[];
  signature: unknown;
  rollbackReason: string | null;
  createdAt: string;
  updatedAt: string;
};

@UseGuards(SignalAuthGuard)
@Controller("v1/developer/capabilities")
export class DeveloperCapabilitiesController {
  public constructor(@Inject(RECORD_STORE) private readonly records: TenantRecordStore) {}

  @Get()
  public async list(@RequestPrincipal() principal: Principal) {
    const items = await this.records.runExclusive(principal.tenantId, async (transaction) =>
      (await transaction.list<GeneratedCandidateRecord>("generated.registry"))
        .filter(
          (candidate) =>
            candidate.requestedByUserId === principal.userId ||
            principal.roles.includes("owner") ||
            principal.roles.includes("administrator"),
        )
        .sort((left, right) => right.createdAt.localeCompare(left.createdAt))
        .map((candidate) => this.safe(candidate, false)),
    );
    return { items, nextCursor: null };
  }

  @Get(":id")
  public async get(@RequestPrincipal() principal: Principal, @Param("id") id: string) {
    return this.safe(await this.require(principal, id), true);
  }

  @Post(":id/rollback")
  public async rollback(
    @RequestPrincipal() principal: Principal,
    @Param("id") id: string,
    @Headers("x-reason") reason: string | undefined,
  ) {
    await this.require(principal, id);
    requireRole(principal, ["owner", "administrator"]);
    requireRecentAuthentication(principal, new Date(), 600);
    const response = await fetch(
      `${(process.env["SANDBOX_CONTROLLER_URL"] ?? "http://sandbox-controller:3300").replace(/\/$/, "")}/v1/candidates/${encodeURIComponent(id)}/rollback`,
      {
        method: "POST",
        headers: {
          "x-signal-service-token":
            process.env["INTERNAL_SERVICE_TOKEN"] ?? "signal-local-internal-only",
          "content-type": "application/json",
        },
        body: JSON.stringify({
          tenantId: principal.tenantId,
          reason: reason ?? `Manual rollback requested by ${principal.userId}.`,
        }),
        signal: AbortSignal.timeout(120_000),
      },
    );
    if (!response.ok) throw new Error(`Capability rollback returned HTTP ${response.status}.`);
    return this.safe((await response.json()) as GeneratedCandidateRecord, true);
  }

  private async require(principal: Principal, id: string): Promise<GeneratedCandidateRecord> {
    const candidate = await this.records.runExclusive(principal.tenantId, (transaction) =>
      transaction.get<GeneratedCandidateRecord>("generated.registry", id),
    );
    if (
      candidate === undefined ||
      (candidate.requestedByUserId !== principal.userId &&
        !principal.roles.includes("owner") &&
        !principal.roles.includes("administrator"))
    ) {
      throw new Error("Generated capability was not found.");
    }
    return candidate;
  }

  private safe(candidate: GeneratedCandidateRecord, includeFiles: boolean) {
    return {
      id: candidate.id,
      taskId: candidate.taskId,
      status: candidate.status,
      version: candidate.version,
      logicalPackagePath: candidate.logicalPackagePath,
      candidateDigest: candidate.candidateDigest,
      gap: candidate.gap,
      sources: candidate.sources,
      stages: candidate.stages,
      signature: candidate.signature,
      rollbackReason: candidate.rollbackReason,
      createdAt: candidate.createdAt,
      updatedAt: candidate.updatedAt,
      ...(includeFiles ? { files: candidate.files } : {}),
    };
  }
}
