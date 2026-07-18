import { fileURLToPath } from "node:url";

import Fastify from "fastify";
import { z } from "zod";

import { assertGeneratedChangesScoped } from "./index.js";

const scopeRequestSchema = z.object({ paths: z.array(z.string()).min(1).max(500) }).strict();

export function createSandboxControllerHost() {
  const app = Fastify({ logger: true, bodyLimit: 512 * 1024 });
  app.get("/health", async () => ({
    status: "ok",
    service: "sandbox-controller",
    execution: "isolated-job-provider-required",
  }));
  app.post("/v1/validate-generated-scope", async (request, reply) => {
    const input = scopeRequestSchema.safeParse(request.body);
    if (!input.success) return reply.code(422).send({ valid: false, error: "invalid request" });
    try {
      assertGeneratedChangesScoped(input.data.paths);
      return { valid: true };
    } catch (error) {
      return reply.code(403).send({
        valid: false,
        error: error instanceof Error ? error.message : "generated scope denied",
      });
    }
  });
  return app;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const app = createSandboxControllerHost();
  await app.listen({ host: "0.0.0.0", port: Number(process.env["PORT"] ?? 3300) });
}
