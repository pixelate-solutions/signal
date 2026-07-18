import { describe, expect, it } from "vitest";

import {
  HarnessCrash,
  runDeterministicTaskHarness,
  type TaskWorkflowCheckpoint,
  type WorkflowActivities,
} from "./index.js";

describe("durable workflow harness", () => {
  it("resumes from a checkpoint without repeating a side effect", async () => {
    const providerState = new Set<string>();
    const executions: string[] = [];
    let saved: TaskWorkflowCheckpoint | undefined;
    const activities: WorkflowActivities = {
      initializeTask: async () => undefined,
      transitionTask: async () => undefined,
      retrieveAndPlan: async () => ({
        steps: [
          {
            id: "read",
            description: "Read provider state",
            desiredCapability: "test.read",
            input: {},
            connectionProvider: null,
            sideEffecting: false,
          },
          {
            id: "write",
            description: "Write provider state",
            desiredCapability: "test.write",
            input: {},
            connectionProvider: null,
            sideEffecting: true,
          },
          {
            id: "verify",
            description: "Read it back",
            desiredCapability: "test.read",
            input: {},
            connectionProvider: null,
            sideEffecting: false,
          },
        ],
        successCriteria: [{ id: "verified", description: "State matches", required: true }],
      }),
      executeStep: async (_taskId, step) => {
        executions.push(step.id);
        if (step.id === "write") {
          providerState.add("completed");
        }
        return { kind: "completed", stepId: step.id, observation: `${step.id} complete` };
      },
      createActionRequest: async () => "act_demo",
      recordInstruction: async () => undefined,
      recordExternalEvent: async () => undefined,
      verifyOutcome: async () => ({
        passed: providerState.has("completed"),
        warnings: [],
        evidenceIds: ["evd_demo0001"],
        summary: "Provider state independently confirmed.",
      }),
      completeTask: async () => undefined,
      failTask: async () => undefined,
      persistCheckpoint: async (_taskId, checkpoint) => {
        saved = structuredClone(checkpoint);
      },
      revokeTaskLeases: async () => undefined,
    };

    try {
      await runDeterministicTaskHarness("tsk_demo0001", activities, undefined, {
        afterIteration: 2,
      });
      throw new Error("Expected a simulated crash");
    } catch (error) {
      expect(error).toBeInstanceOf(HarnessCrash);
      saved = (error as HarnessCrash).checkpoint;
    }
    const result = await runDeterministicTaskHarness("tsk_demo0001", activities, saved);
    expect(result.state).toBe("COMPLETED");
    expect(executions.filter((step) => step === "write")).toHaveLength(1);
  });
});
