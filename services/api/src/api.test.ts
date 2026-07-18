import type { NestFastifyApplication } from "@nestjs/platform-fastify";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { createApp } from "./main.js";

async function eventually<T>(read: () => Promise<T>, accept: (value: T) => boolean): Promise<T> {
  const deadline = Date.now() + 2_000;
  let value = await read();
  while (!accept(value) && Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 10));
    value = await read();
  }
  expect(accept(value)).toBe(true);
  return value;
}

describe("Signal API vertical slice", () => {
  let app: NestFastifyApplication;

  beforeAll(async () => {
    process.env["NODE_ENV"] = "test";
    process.env["DEMO_MODE"] = "true";
    app = await createApp();
  });

  afterAll(async () => {
    await app.close();
  });

  it("Scenario A: survives an offline client, deep-links to approval, resumes, and verifies", async () => {
    const conversation = await app.inject({
      method: "POST",
      url: "/v1/conversations",
      payload: { title: "Demo objective" },
    });
    expect(conversation.statusCode).toBe(201);
    const conversationId = conversation.json().id as string;
    const first = await app.inject({
      method: "POST",
      url: `/v1/conversations/${conversationId}/messages`,
      headers: { "idempotency-key": "api-message-key-1" },
      payload: {
        content: [{ type: "text", text: "Complete and verify the local demonstration." }],
      },
    });
    const second = await app.inject({
      method: "POST",
      url: `/v1/conversations/${conversationId}/messages`,
      headers: { "idempotency-key": "api-message-key-1" },
      payload: {
        content: [{ type: "text", text: "Complete and verify the local demonstration." }],
      },
    });
    expect(first.statusCode).toBe(201);
    expect(second.json()).toMatchObject({ replayed: true });
    const taskId = first.json().task.id as string;

    // The client is now considered killed/offline: no client state participates while the
    // backend advances to its durable authority boundary.
    const waiting = await eventually(
      async () =>
        app.inject({
          method: "GET",
          url: `/v1/tasks/${taskId}`,
        }),
      (response) => response.json().task.state === "WAITING_USER",
    );
    const action = waiting.json().pendingActions[0] as {
      id: string;
      materialDigest: string;
      state: string;
    };
    expect(action.state).toBe("PENDING");

    const pushes = await eventually(
      async () => app.inject({ method: "GET", url: "/v1/development/push" }),
      (response) =>
        (response.json().items as { message: { actionRequestId: string } }[]).some(
          (item) => item.message.actionRequestId === action.id,
        ),
    );
    const push = (
      pushes.json().items as {
        message: { actionRequestId: string; deepLink: string; body: string };
      }[]
    ).find((item) => item.message.actionRequestId === action.id);
    expect(push?.message.deepLink).toBe(`signal://tasks/${taskId}/actions/${action.id}`);
    expect(JSON.stringify(push)).not.toContain("verified");

    const approved = await app.inject({
      method: "POST",
      url: `/v1/action-requests/${action.id}/respond`,
      payload: { response: "APPROVE", materialDigest: action.materialDigest },
    });
    expect(approved.statusCode).toBe(201);

    const completed = await eventually(
      async () => app.inject({ method: "GET", url: `/v1/tasks/${taskId}` }),
      (response) => response.json().task.state === "COMPLETED",
    );
    expect(completed.json().task.successCriteria).toEqual([
      expect.objectContaining({ status: "PASSED" }),
    ]);

    const events = await app.inject({ method: "GET", url: `/v1/tasks/${taskId}/events?after=0` });
    expect(events.statusCode).toBe(200);
    const eventItems = events.json().items as { sequence: number; type: string }[];
    const sequences = eventItems.map((event) => event.sequence);
    expect(sequences).toEqual(sequences.map((_value, index) => index + 1));
    expect(eventItems.map((event) => event.type)).toEqual(
      expect.arrayContaining([
        "approval.requested",
        "approval.responded",
        "verification.started",
        "verification.succeeded",
        "task.completed",
      ]),
    );
  });

  it("returns a stable error envelope", async () => {
    const response = await app.inject({ method: "GET", url: "/v1/tasks/tsk_missing000/events" });
    expect(response.statusCode).toBe(404);
    expect(response.json()).toMatchObject({
      error: { code: "NOT_FOUND", retryable: false },
    });
    expect(response.json().error.correlationId).toMatch(/^corr_/);
  });
});
