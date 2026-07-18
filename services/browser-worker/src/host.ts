import { fileURLToPath } from "node:url";

import Fastify from "fastify";
import { z } from "zod";

import {
  BrowserOperator,
  PlaywrightEngine,
  browserModeSchema,
  browserStepSchema,
} from "./index.js";

const requestSchema = z
  .object({
    tenantId: z.string().min(8),
    taskId: z.string().min(8),
    allowlist: z.array(z.string().min(1)).min(1).max(50),
    mode: browserModeSchema,
    steps: z.array(browserStepSchema).min(1).max(100),
    approvedFinalActionDigest: z.string().optional(),
  })
  .strict();

export function createBrowserWorkerHost() {
  const app = Fastify({ logger: true, bodyLimit: 2 * 1024 * 1024 });
  app.addHook("onRequest", async (request, reply) => {
    if (request.url === "/health") return;
    const expected = process.env["INTERNAL_SERVICE_TOKEN"];
    if (
      process.env["NODE_ENV"] === "production" &&
      (expected === undefined || request.headers["x-signal-service-token"] !== expected)
    ) {
      await reply.code(401).send({ error: "internal authentication required" });
    }
  });
  app.get("/health", async () => ({ status: "ok", service: "browser-worker" }));
  app.post("/v1/run", async (request, reply) => {
    const parsed = requestSchema.safeParse(request.body);
    if (!parsed.success)
      return reply.code(422).send({ error: "invalid browser job", issues: parsed.error.issues });
    const engine = await PlaywrightEngine.launch({
      allowlist: parsed.data.allowlist,
      ...(process.env["CHROMIUM_EXECUTABLE_PATH"] === undefined
        ? {}
        : { executablePath: process.env["CHROMIUM_EXECUTABLE_PATH"] }),
    });
    const operator = new BrowserOperator(
      engine,
      async () => {
        throw new Error(
          "CONNECTION_REQUIRED: browser secret handles require the credential broker.",
        );
      },
      {
        event: async (type, detail) => {
          request.log.info({ eventType: type, taskId: detail["taskId"] }, "browser audit event");
        },
      },
    );
    const { approvedFinalActionDigest, ...job } = parsed.data;
    return operator.execute({
      ...job,
      ...(approvedFinalActionDigest === undefined ? {} : { approvedFinalActionDigest }),
    });
  });
  return app;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const app = createBrowserWorkerHost();
  await app.listen({ host: "0.0.0.0", port: Number(process.env["PORT"] ?? 3200) });
}
