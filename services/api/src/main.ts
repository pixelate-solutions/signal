import "reflect-metadata";

import { fileURLToPath } from "node:url";

import cors from "@fastify/cors";
import helmet from "@fastify/helmet";
import rateLimit from "@fastify/rate-limit";
import { NestFactory } from "@nestjs/core";
import { FastifyAdapter, type NestFastifyApplication } from "@nestjs/platform-fastify";
import { DocumentBuilder, SwaggerModule } from "@nestjs/swagger";

import { AppModule } from "./app.module.js";
import { SignalExceptionFilter } from "./errors.js";

export async function createApp(): Promise<NestFastifyApplication> {
  const adapter = new FastifyAdapter({
    logger: {
      level: process.env["NODE_ENV"] === "test" ? "silent" : "info",
      redact: [
        "req.headers.authorization",
        "req.headers.cookie",
        "res.headers.set-cookie",
        "*.accessToken",
        "*.refreshToken",
        "*.password",
      ],
    },
    bodyLimit: 64 * 1024 * 1024,
    trustProxy: true,
  });
  adapter
    .getInstance()
    .addContentTypeParser(
      "application/octet-stream",
      { parseAs: "buffer" },
      (_request, body, done) => done(null, body),
    );
  const app = await NestFactory.create<NestFastifyApplication>(AppModule, adapter, {
    bufferLogs: true,
  });
  await app.register(helmet, {
    contentSecurityPolicy: process.env["NODE_ENV"] === "production",
  });
  await app.register(cors, {
    origin:
      process.env["NODE_ENV"] === "production"
        ? [process.env["APP_PUBLIC_URL"] ?? "https://signal.invalid"]
        : true,
    credentials: true,
  });
  await app.register(rateLimit, {
    max: 300,
    timeWindow: "1 minute",
  });
  app.useGlobalFilters(new SignalExceptionFilter());
  app.enableShutdownHooks();

  const swagger = new DocumentBuilder()
    .setTitle("Signal API")
    .setDescription("Durable task, event, action, connection, memory, artifact, and settings API.")
    .setVersion("1.0")
    .addBearerAuth()
    .build();
  SwaggerModule.setup("docs", app, SwaggerModule.createDocument(app, swagger), {
    jsonDocumentUrl: "openapi.json",
  });
  await app.init();
  return app;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const app = await createApp();
  await app.listen(Number(process.env["PORT"] ?? 3000), "0.0.0.0");
}
