import { describe, expect, it } from "vitest";

import {
  objectiveAllowsSignalTestState,
  recoverPersistedPlan,
  verifiedExecutionSummary,
} from "./activities.js";

describe("development provider scope", () => {
  it("allows objectives that explicitly target the isolated development environment", () => {
    expect(objectiveAllowsSignalTestState("Verify the local Signal environment health")).toBe(true);
    expect(objectiveAllowsSignalTestState("Observe the deterministic test provider state")).toBe(
      true,
    );
  });

  it("does not let fixture evidence satisfy an external email objective", () => {
    expect(objectiveAllowsSignalTestState('Email admin@example.com "Hello from Signal"')).toBe(
      false,
    );
    expect(objectiveAllowsSignalTestState("Test sending an email to admin@example.com")).toBe(
      false,
    );
  });
});

describe("durable plan recovery", () => {
  it("reuses a structurally valid persisted plan", () => {
    expect(
      recoverPersistedPlan({
        steps: [
          {
            id: "send",
            description: "Send the message",
            desiredCapability: "google.gmail.send_email",
            input: { recipient_email: "admin@pixelate.solutions" },
            connectionProvider: "google",
            sideEffecting: true,
          },
        ],
        successCriteria: [
          { id: "sent", description: "The sent message is independently observed", required: true },
        ],
        userSummary: "Previously compiled plan",
      }),
    ).toMatchObject({
      steps: [{ id: "send", desiredCapability: "google.gmail.send_email" }],
      successCriteria: [{ id: "sent", required: true }],
    });
  });

  it("rejects malformed persisted plan data", () => {
    expect(recoverPersistedPlan({ steps: [{ id: 42 }], successCriteria: [] })).toBeNull();
  });
});

describe("verified outcome summary", () => {
  it("uses the newest verified execution result as the final outcome", () => {
    expect(
      verifiedExecutionSummary([
        {
          recordedAt: "2026-07-19T12:00:00.000Z",
          result: { sanitizedMessage: "The phone query started." },
        },
        {
          recordedAt: "2026-07-19T12:00:01.000Z",
          result: { sanitizedMessage: "No supported notes app is installed on the phone." },
        },
      ]),
    ).toBe("No supported notes app is installed on the phone.");
  });
});
