import { fileURLToPath } from "node:url";

import { NativeConnection, Worker } from "@temporalio/worker";

import type { WorkflowActivities } from "./types.js";

export type WorkerDependencies = {
  activities: WorkflowActivities;
  onReady?: () => void;
};

export async function runWorker(dependencies: WorkerDependencies): Promise<void> {
  const connection = await NativeConnection.connect({
    address: process.env["TEMPORAL_ADDRESS"] ?? "localhost:7233",
  });
  const worker = await Worker.create({
    connection,
    namespace: process.env["TEMPORAL_NAMESPACE"] ?? "default",
    taskQueue: process.env["TEMPORAL_TASK_QUEUE_TASKS"] ?? "signal-tasks",
    workflowsPath: fileURLToPath(new URL("./workflows.js", import.meta.url)),
    activities: dependencies.activities,
  });
  dependencies.onReady?.();
  await worker.run();
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  console.error(
    "The workflow worker requires injected activity implementations. Start it through the production composition root.",
  );
  process.exitCode = 1;
}
