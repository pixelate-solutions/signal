import { Controller, Get, Inject, Param, Query, Req, Res, UseGuards } from "@nestjs/common";
import type { FastifyReply, FastifyRequest } from "fastify";

import type { Principal } from "@signal/auth-sdk";
import type { ObjectStore, TenantRecordStore } from "@signal/persistence";

import { RequestPrincipal, SignalAuthGuard } from "../auth.js";
import { OBJECT_STORE, RECORD_STORE } from "../tokens.js";

type BrowserSessionRecord = {
  id: string;
  tenantId: string;
  userId: string;
  taskId: string;
  status: string;
  completedSteps: number;
  artifactIds: string[];
  createdAt: string;
  updatedAt: string;
  lastError: string | null;
};

type BrowserEvidenceRecord = {
  id: string;
  sessionId: string;
  url: string;
  capturedAt: string;
  postActionSummary: string;
  screenshotDigest: string | null;
};

function safeDisplayUrl(value: string): string {
  try {
    const url = new URL(value);
    return `${url.origin}${url.pathname}`;
  } catch {
    return "Browser page";
  }
}

@UseGuards(SignalAuthGuard)
@Controller("v1/browser/sessions")
export class BrowserSessionsController {
  public constructor(
    @Inject(RECORD_STORE) private readonly records: TenantRecordStore,
    @Inject(OBJECT_STORE) private readonly objects: ObjectStore,
  ) {}

  @Get(":id")
  public async get(@RequestPrincipal() principal: Principal, @Param("id") id: string) {
    const session = await this.requireSession(principal, id);
    const latestEvidence = await this.records.runExclusive(
      principal.tenantId,
      async (transaction) =>
        (await transaction.list<BrowserEvidenceRecord>("browser.evidence"))
          .filter((evidence) => evidence.sessionId === id)
          .sort((left, right) => right.capturedAt.localeCompare(left.capturedAt))
          .at(0),
    );
    return {
      id: session.id,
      taskId: session.taskId,
      status: session.status,
      completedSteps: session.completedSteps,
      artifactIds: session.artifactIds,
      createdAt: session.createdAt,
      updatedAt: session.updatedAt,
      lastError: session.lastError,
      latestEvidence:
        latestEvidence === undefined
          ? null
          : {
              id: latestEvidence.id,
              url: safeDisplayUrl(latestEvidence.url),
              capturedAt: latestEvidence.capturedAt,
              postActionSummary: latestEvidence.postActionSummary,
              screenshotDigest: latestEvidence.screenshotDigest,
            },
    };
  }

  @Get(":id/events")
  public async events(@RequestPrincipal() principal: Principal, @Param("id") id: string) {
    await this.requireSession(principal, id);
    const items = await this.records.runExclusive(principal.tenantId, async (transaction) =>
      (
        await transaction.list<{
          sessionId: string;
          sequence: number;
          [key: string]: unknown;
        }>("browser.events")
      )
        .filter((event) => event.sessionId === id)
        .sort((left, right) => left.sequence - right.sequence),
    );
    return { items, nextCursor: null };
  }

  @Get(":id/events/stream")
  public async eventStream(
    @RequestPrincipal() principal: Principal,
    @Param("id") id: string,
    @Query("after") rawAfter: string | undefined,
    @Req() request: FastifyRequest,
    @Res() response: FastifyReply,
  ) {
    await this.requireSession(principal, id);
    let after = Math.max(0, Number(rawAfter ?? request.headers["last-event-id"] ?? 0) || 0);
    response.hijack();
    response.raw.writeHead(200, {
      "content-type": "text/event-stream",
      "cache-control": "no-cache, no-transform",
      connection: "keep-alive",
      "x-accel-buffering": "no",
    });
    let closed = false;
    request.raw.once("close", () => {
      closed = true;
    });
    response.raw.write(": connected\n\n");
    while (!closed) {
      const events = await this.records.runExclusive(principal.tenantId, async (transaction) =>
        (
          await transaction.list<{
            sessionId: string;
            sequence: number;
            [key: string]: unknown;
          }>("browser.events")
        )
          .filter((event) => event.sessionId === id && event.sequence > after)
          .sort((left, right) => left.sequence - right.sequence),
      );
      for (const event of events) {
        response.raw.write(
          `id: ${event.sequence}\nevent: browser\ndata: ${JSON.stringify(event)}\n\n`,
        );
        after = event.sequence;
      }
      const session = await this.requireSession(principal, id);
      if (["SUCCEEDED", "FAILED"].includes(session.status)) {
        response.raw.write(
          `event: terminal\ndata: ${JSON.stringify({ status: session.status })}\n\n`,
        );
        break;
      }
      await new Promise<void>((resolve) => setTimeout(resolve, 750));
    }
    response.raw.end();
  }

  @Get(":id/evidence/:evidenceId/screenshot")
  public async screenshot(
    @RequestPrincipal() principal: Principal,
    @Param("id") id: string,
    @Param("evidenceId") evidenceId: string,
    @Res() response: FastifyReply,
  ) {
    await this.requireSession(principal, id);
    const evidence = await this.records.runExclusive(principal.tenantId, (transaction) =>
      transaction.get<{ sessionId: string; screenshotKey: string }>("browser.evidence", evidenceId),
    );
    if (evidence === undefined || evidence.sessionId !== id) {
      throw new Error("Browser evidence was not found.");
    }
    const screenshot = await this.objects.get(evidence.screenshotKey);
    if (screenshot === undefined) throw new Error("Browser screenshot was not found.");
    response.header("content-type", "image/png");
    response.header("cache-control", "private, no-store");
    return response.send(Buffer.from(screenshot.body));
  }

  private async requireSession(principal: Principal, id: string): Promise<BrowserSessionRecord> {
    const session = await this.records.runExclusive(principal.tenantId, (transaction) =>
      transaction.get<BrowserSessionRecord>("browser.sessions", id),
    );
    if (
      session === undefined ||
      session.tenantId !== principal.tenantId ||
      session.userId !== principal.userId
    ) {
      throw new Error("Browser session was not found.");
    }
    return session;
  }
}
