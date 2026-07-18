import { describe, expect, it } from "vitest";

import { GeneratedAdapterPipeline, adapterStages, assertGeneratedChangesScoped } from "./index.js";

describe("generated adapter pipeline", () => {
  it("blocks protected path changes before sandbox execution", () => {
    expect(() => assertGeneratedChangesScoped(["services/api/src/backdoor.ts"])).toThrow(
      "protected path",
    );
  });

  it("surfaces the first failed test and succeeds only after the regression is fixed", async () => {
    const pipeline = new GeneratedAdapterPipeline();
    const first = await pipeline.execute({
      packagePaths: ["integrations/generated/example/status/1.0.0/src/index.ts"],
      runStage: async (stage) => ({
        passed: stage !== "unit-tests",
        summary: stage === "unit-tests" ? "Required field was omitted." : "passed",
        evidenceDigest: `sha256:${"a".repeat(64)}`,
      }),
      rollback: async () => undefined,
    });
    expect(first.status).toBe("FAILED");
    expect(first.stages.at(-1)?.stage).toBe("unit-tests");

    const fixed = await pipeline.execute({
      packagePaths: ["integrations/generated/example/status/1.0.0/src/index.ts"],
      runStage: async (stage) => ({
        passed: true,
        summary: `${stage} passed with the required field regression test`,
        evidenceDigest: `sha256:${"b".repeat(64)}`,
      }),
      rollback: async () => undefined,
    });
    expect(fixed.status).toBe("DEPLOYED");
    expect(fixed.stages).toHaveLength(adapterStages.length);
  });

  it("rolls back a failed tenant canary", async () => {
    let rolledBack = false;
    const result = await new GeneratedAdapterPipeline().execute({
      packagePaths: ["integrations/generated/example/status/1.0.0/manifest.json"],
      runStage: async (stage) => ({
        passed: stage !== "tenant-canary",
        summary: "fixture",
        evidenceDigest: `sha256:${"c".repeat(64)}`,
      }),
      rollback: async () => {
        rolledBack = true;
      },
    });
    expect(result.status).toBe("ROLLED_BACK");
    expect(rolledBack).toBe(true);
  });
});
