import { describe, expect, it } from "vitest";

import type { Principal } from "@signal/auth-sdk";

import { PostgresTaskStore } from "./store.js";
import { SignalTaskService } from "./task-service.js";

const databaseUrl = process.env["DATABASE_URL"];
const integration = databaseUrl === undefined ? describe.skip : describe;
const integrationDatabaseUrl = databaseUrl ?? "postgresql://integration-disabled.invalid/signal";

const principal: Principal = {
  subject: "integration|demo",
  tenantId: "ten_demo0001",
  userId: "usr_demo0001",
  roles: ["owner"],
  scopes: ["*"],
  sessionId: "ses_integration0001",
  authenticatedAt: "2026-07-18T12:00:00.000Z",
  expiresAt: "2026-07-18T13:00:00.000Z",
  deviceId: null,
};

integration("PostgreSQL task store", () => {
  it("survives new store instances and serializes concurrent idempotent writes", async () => {
    const initialStore = new PostgresTaskStore(integrationDatabaseUrl);
    const initialService = new SignalTaskService(initialStore);
    const conversation = await initialService.createConversation(principal, {
      title: "Durable integration test",
    });
    await initialStore.close();

    const firstStore = new PostgresTaskStore(integrationDatabaseUrl);
    const secondStore = new PostgresTaskStore(integrationDatabaseUrl);
    const firstService = new SignalTaskService(firstStore);
    const secondService = new SignalTaskService(secondStore);
    const key = `postgres-concurrent-${crypto.randomUUID()}`;
    const input = {
      content: [{ type: "text" as const, text: "Create exactly one durable task." }],
    };
    const [first, second] = await Promise.all([
      firstService.sendMessage(principal, conversation.id, input, key),
      secondService.sendMessage(principal, conversation.id, input, key),
    ]);
    await Promise.all([firstStore.close(), secondStore.close()]);

    expect(first.task.id).toBe(second.task.id);
    expect([first.replayed, second.replayed].sort()).toEqual([false, true]);

    const restoredStore = new PostgresTaskStore(integrationDatabaseUrl);
    const restoredService = new SignalTaskService(restoredStore);
    const restored = await restoredService.getTask(principal, first.task.id);
    const events = await restoredService.getEvents(principal, first.task.id);
    await restoredStore.close();

    expect(restored.state).toBe("QUEUED");
    expect(events.map((event) => event.sequence)).toEqual([1, 2]);
  });
});
