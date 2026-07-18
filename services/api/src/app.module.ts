import { Module } from "@nestjs/common";

import { ArtifactService, ClamAvScanner } from "@signal/artifact-service";
import { ConnectionManager } from "@signal/connection-service";
import { MemoryService } from "@signal/memory-service";
import { DevelopmentPushSink, NotificationService } from "@signal/notification-service";
import { InMemoryTaskStore, PostgresTaskStore, SignalTaskService } from "@signal/task-service";

import { SignalAuthGuard } from "./auth.js";
import { ActionsController } from "./controllers/actions.controller.js";
import {
  ArtifactsController,
  UploadPartsController,
  UploadsController,
} from "./controllers/artifacts.controller.js";
import {
  ConnectionCallbackController,
  ConnectionsController,
} from "./controllers/connections.controller.js";
import { ConversationsController } from "./controllers/conversations.controller.js";
import { DevicesController } from "./controllers/devices.controller.js";
import { DevelopmentController } from "./controllers/development.controller.js";
import { HealthController } from "./controllers/health.controller.js";
import { MemoriesController } from "./controllers/memories.controller.js";
import { OpsController } from "./controllers/ops.controller.js";
import { SecurityController } from "./controllers/security.controller.js";
import { SettingsController } from "./controllers/settings.controller.js";
import { TasksController } from "./controllers/tasks.controller.js";
import { DeviceRegistry, SettingsManager } from "./control-plane.js";
import { DemoTaskRuntime } from "./demo-runtime.js";
import {
  ARTIFACT_SERVICE,
  CONNECTION_MANAGER,
  DEVELOPMENT_PUSH_SINK,
  DEMO_RUNTIME,
  DEVICE_REGISTRY,
  MEMORY_SERVICE,
  NOTIFICATION_SERVICE,
  SETTINGS_MANAGER,
  TASK_SERVICE,
} from "./tokens.js";

@Module({
  controllers: [
    HealthController,
    ConversationsController,
    TasksController,
    ActionsController,
    SecurityController,
    UploadPartsController,
    UploadsController,
    ArtifactsController,
    MemoriesController,
    SettingsController,
    ConnectionsController,
    ConnectionCallbackController,
    DevicesController,
    OpsController,
    DevelopmentController,
  ],
  providers: [
    SignalAuthGuard,
    {
      provide: ARTIFACT_SERVICE,
      useFactory: () =>
        new ArtifactService(
          process.env["APP_PUBLIC_URL"] ?? "http://localhost:3000",
          undefined,
          new ClamAvScanner(process.env["CLAMAV_HOST"] ?? "localhost"),
        ),
    },
    { provide: MEMORY_SERVICE, useFactory: () => new MemoryService() },
    { provide: SETTINGS_MANAGER, useFactory: () => new SettingsManager() },
    { provide: DEVICE_REGISTRY, useFactory: () => new DeviceRegistry() },
    { provide: DEVELOPMENT_PUSH_SINK, useFactory: () => new DevelopmentPushSink() },
    {
      provide: NOTIFICATION_SERVICE,
      inject: [DEVELOPMENT_PUSH_SINK],
      useFactory: (sink: DevelopmentPushSink) => new NotificationService(sink),
    },
    {
      provide: CONNECTION_MANAGER,
      useFactory: () =>
        new ConnectionManager({
          publicBaseUrl: process.env["APP_PUBLIC_URL"] ?? "http://localhost:3000",
          demoMode: process.env["DEMO_MODE"] === "true" || process.env["NODE_ENV"] === "test",
          ...(process.env["COMPOSIO_API_KEY"] === undefined
            ? {}
            : { composioApiKey: process.env["COMPOSIO_API_KEY"] }),
          ...(process.env["COMPOSIO_CALLBACK_URL"] === undefined
            ? {}
            : { composioCallbackUrl: process.env["COMPOSIO_CALLBACK_URL"] }),
        }),
    },
    {
      provide: TASK_SERVICE,
      useFactory: () => {
        if (process.env["NODE_ENV"] === "test") {
          return new SignalTaskService(new InMemoryTaskStore());
        }
        const databaseUrl = process.env["DATABASE_URL"];
        if (databaseUrl === undefined) {
          throw new Error("DATABASE_URL is required for durable task execution.");
        }
        return new SignalTaskService(new PostgresTaskStore(databaseUrl));
      },
    },
    {
      provide: DEMO_RUNTIME,
      inject: [TASK_SERVICE, NOTIFICATION_SERVICE],
      useFactory: (tasks: SignalTaskService, notifications: NotificationService) =>
        new DemoTaskRuntime(tasks, notifications),
    },
  ],
})
export class AppModule {}
