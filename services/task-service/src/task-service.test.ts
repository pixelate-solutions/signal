import { describe, expect, it } from "vitest";

import type { Principal } from "@signal/auth-sdk";
import { verifyEventChain } from "@signal/event-sdk";

import { InMemoryTaskStore, SignalTaskService, StaleActionError } from "./index.js";

function harness() {
  let id = 0;
  let now = new Date("2026-07-18T12:00:00.000Z");
  const store = new InMemoryTaskStore();
  const service = new SignalTaskService(
    store,
    { now: () => now },
    { next: (prefix) => `${prefix}_demo${String(++id).padStart(8, "0")}` },
  );
  const principal: Principal = {
    subject: "local|demo",
    tenantId: "ten_demo0001",
    userId: "usr_demo0001",
    roles: ["owner"],
    scopes: ["tasks:write"],
    sessionId: "ses_demo0001",
    authenticatedAt: "2026-07-18T11:59:00.000Z",
    expiresAt: "2026-07-19T00:00:00.000Z",
    deviceId: null,
  };
  return {
    store,
    service,
    principal,
    setNow(value: string) {
      now = new Date(value);
    },
  };
}

async function createTask(h: ReturnType<typeof harness>) {
  const conversation = await h.service.createConversation(h.principal, { title: "Carrier" });
  return h.service.sendMessage(
    h.principal,
    conversation.id,
    { content: [{ type: "text", text: "Change package 4831 to Friday and verify it." }] },
    "message-key-0001",
  );
}

describe("authoritative task service", () => {
  it("deduplicates message creation", async () => {
    const h = harness();
    const conversation = await h.service.createConversation(h.principal, {});
    const input = { content: [{ type: "text" as const, text: "Research this." }] };
    const first = await h.service.sendMessage(h.principal, conversation.id, input, "stable-key-1");
    const second = await h.service.sendMessage(h.principal, conversation.id, input, "stable-key-1");
    expect(second.replayed).toBe(true);
    expect(second.task.id).toBe(first.task.id);
  });

  it("serializes concurrent events into a valid monotonic digest chain", async () => {
    const h = harness();
    const { task } = await createTask(h);
    await Promise.all(
      Array.from({ length: 20 }, (_, index) =>
        h.service.recordEvent(h.principal, {
          taskId: task.id,
          type: "tool.discovery_started",
          actor: { type: "agent", id: "agent-demo" },
          visibility: "user",
          summary: `Discovery ${index}`,
          details: {},
          secretFields: [],
          evidenceIds: [],
        }),
      ),
    );
    const events = await h.service.getEvents(h.principal, task.id, 0, 100);
    expect(events.map((event) => event.sequence)).toEqual(
      Array.from({ length: events.length }, (_, index) => index + 1),
    );
    expect(verifyEventChain(events)).toBe(true);
  });

  it("binds approval to exact material terms", async () => {
    const h = harness();
    const { task } = await createTask(h);
    await h.service.transition(h.principal, task.id, "PLANNING", {
      type: "workflow",
      id: task.workflowId,
    });
    await h.service.transition(h.principal, task.id, "RUNNING", {
      type: "workflow",
      id: task.workflowId,
    });
    const action = await h.service.createActionRequest(h.principal, task.id, {
      type: "APPROVAL",
      title: "Change delivery date?",
      description: "Change package 4831 to Friday.",
      materialPayload: { package: "4831", date: "Friday" },
      risk: "R2",
      expiresAt: new Date("2026-07-18T13:00:00.000Z"),
    });
    await expect(
      h.service.respondToAction(h.principal, action.id, {
        response: "APPROVE",
        materialDigest: "sha256:" + "0".repeat(64),
      }),
    ).rejects.toBeInstanceOf(StaleActionError);
    expect((await h.service.getTask(h.principal, task.id)).state).toBe("WAITING_USER");
  });

  it("keeps a digest-bound action pending until distinct approvers reach quorum", async () => {
    let id = 0;
    const store = new InMemoryTaskStore();
    const service = new SignalTaskService(
      store,
      { now: () => new Date("2026-07-18T12:00:00.000Z") },
      { next: (prefix) => `${prefix}_quorum${String(++id).padStart(8, "0")}` },
      {
        eligibleApproverUserIds: async () => ["usr_demo0001", "usr_admin0001"],
      },
    );
    const owner = harness().principal;
    const admin: Principal = {
      ...owner,
      subject: "local|admin",
      userId: "usr_admin0001",
      roles: ["administrator"],
      sessionId: "ses_admin0001",
    };
    const conversation = await service.createConversation(owner, { title: "Quorum" });
    const { task } = await service.sendMessage(
      owner,
      conversation.id,
      { content: [{ type: "text", text: "Perform an irreversible action." }] },
      "message-quorum-0001",
    );
    await service.transition(owner, task.id, "PLANNING", {
      type: "workflow",
      id: task.workflowId,
    });
    await service.transition(owner, task.id, "RUNNING", {
      type: "workflow",
      id: task.workflowId,
    });
    const action = await service.createActionRequest(owner, task.id, {
      type: "APPROVAL",
      title: "Approve irreversible action?",
      description: "Two distinct administrators must approve these exact terms.",
      materialPayload: { operation: "irreversible" },
      risk: "R4",
      approvalThreshold: 2,
      expiresAt: new Date("2026-07-18T13:00:00.000Z"),
    });
    await service.respondToAction(owner, action.id, {
      response: "APPROVE",
      materialDigest: action.materialDigest,
    });
    expect((await service.getActionRequest(owner, action.id)).state).toBe("PENDING");
    expect((await service.getTask(owner, task.id)).state).toBe("WAITING_USER");
    await service.respondToAction(admin, action.id, {
      response: "APPROVE",
      materialDigest: action.materialDigest,
    });
    expect(await service.getActionRequest(owner, action.id)).toMatchObject({
      state: "RESPONDED",
      approvalThreshold: 2,
      approvedUserIds: ["usr_demo0001", "usr_admin0001"],
    });
    expect((await service.getTask(owner, task.id)).state).toBe("RUNNING");
  });

  it("refuses completion without independent evidence", async () => {
    const h = harness();
    const { task } = await createTask(h);
    await h.service.transition(h.principal, task.id, "PLANNING", {
      type: "workflow",
      id: task.workflowId,
    });
    await h.service.transition(h.principal, task.id, "RUNNING", {
      type: "workflow",
      id: task.workflowId,
    });
    await expect(h.service.complete(h.principal, task.id)).rejects.toThrow(
      "mandatory verification",
    );
    await h.service.updateCriterion(h.principal, task.id, "criterion_outcome", "PASSED", [
      "evd_demo0001",
    ]);
    await expect(h.service.complete(h.principal, task.id)).resolves.toMatchObject({
      state: "COMPLETED",
    });
    const events = await h.service.getEvents(h.principal, task.id);
    expect(events.at(-1)).toMatchObject({
      type: "task.completed",
      evidenceIds: ["evd_demo0001"],
    });
  });

  it("denies cross-tenant reads", async () => {
    const h = harness();
    const { task } = await createTask(h);
    const intruder = { ...h.principal, tenantId: "ten_other0001", userId: "usr_other0001" };
    await expect(h.service.getTask(intruder, task.id)).rejects.toThrow("another tenant");
  });

  it("emergency-stops every active task in the tenant", async () => {
    const h = harness();
    const { task } = await createTask(h);
    const stopped = await h.service.emergencyStop(h.principal, "User requested stop");
    expect(stopped.map((item) => item.id)).toContain(task.id);
    expect((await h.service.getTask(h.principal, task.id)).state).toBe("CANCELLED");
  });
});
