import {
  Body,
  Controller,
  Get,
  Headers,
  Inject,
  Param,
  Post,
  Query,
  Sse,
  UseGuards,
  type MessageEvent,
} from "@nestjs/common";
import { ApiBearerAuth, ApiOperation, ApiTags } from "@nestjs/swagger";
import { Observable } from "rxjs";

import type { Principal } from "@signal/auth-sdk";
import { eventDeltaQuerySchema, taskInstructionSchema, type TaskState } from "@signal/contracts";
import type { SignalTaskService } from "@signal/task-service";

import { RequestPrincipal, SignalAuthGuard } from "../auth.js";
import type { TaskRuntime } from "../task-runtime.js";
import { TASK_RUNTIME, TASK_SERVICE } from "../tokens.js";

@ApiTags("tasks")
@ApiBearerAuth()
@UseGuards(SignalAuthGuard)
@Controller("v1/tasks")
export class TasksController {
  public constructor(
    @Inject(TASK_SERVICE) private readonly tasks: SignalTaskService,
    @Inject(TASK_RUNTIME) private readonly runtime: TaskRuntime,
  ) {}

  @Get()
  @ApiOperation({ summary: "Search tenant-scoped tasks" })
  public async search(
    @RequestPrincipal() principal: Principal,
    @Query("query") query: string | undefined,
    @Query("state") state: string | undefined,
  ) {
    const allowedStates = new Set([
      "CREATED",
      "QUEUED",
      "PLANNING",
      "RUNNING",
      "WAITING_EXTERNAL",
      "WAITING_USER",
      "RETRY_SCHEDULED",
      "PAUSED",
      "COMPLETED",
      "COMPLETED_WITH_WARNINGS",
      "FAILED",
      "CANCELLED",
    ] as const);
    const states = (state ?? "")
      .split(",")
      .filter((candidate): candidate is TaskState => allowedStates.has(candidate as TaskState));
    return {
      items: await this.tasks.searchTasks(principal, query ?? "", states),
      nextCursor: null,
    };
  }

  @Get(":id")
  @ApiOperation({ summary: "Get an authoritative task snapshot" })
  public get(@RequestPrincipal() principal: Principal, @Param("id") id: string) {
    return this.tasks.getTaskDetail(principal, id);
  }

  @Get(":id/events")
  @ApiOperation({ summary: "Delta-sync ordered task events" })
  public async events(
    @RequestPrincipal() principal: Principal,
    @Param("id") id: string,
    @Query() query: Record<string, string | undefined>,
  ) {
    const parsed = eventDeltaQuerySchema.parse(query);
    return {
      items: await this.tasks.getEvents(principal, id, parsed.after, parsed.limit),
      nextCursor: null,
    };
  }

  @Sse(":id/stream")
  @ApiOperation({ summary: "Stream ordered task events with replay" })
  public stream(
    @RequestPrincipal() principal: Principal,
    @Param("id") id: string,
    @Headers("last-event-id") lastEventId: string | undefined,
    @Query("after") afterQuery: string | undefined,
  ): Observable<MessageEvent> {
    const after = Number.parseInt(afterQuery ?? lastEventId ?? "0", 10);
    return new Observable<MessageEvent>((subscriber) => {
      let unsubscribe: () => void = () => undefined;
      void this.tasks
        .getEvents(principal, id, Number.isFinite(after) ? after : 0, 1_000)
        .then((events) => {
          for (const event of events) {
            subscriber.next({ id: String(event.sequence), type: event.type, data: event });
          }
          unsubscribe = this.tasks.subscribe(id, (event) => {
            subscriber.next({ id: String(event.sequence), type: event.type, data: event });
          });
        })
        .catch((error: unknown) => subscriber.error(error));
      return () => unsubscribe();
    });
  }

  @Post(":id/pause")
  public async pause(
    @RequestPrincipal() principal: Principal,
    @Param("id") id: string,
    @Headers("idempotency-key") key: string | undefined,
  ) {
    const task = await this.tasks.control(principal, id, "pause", key ?? "");
    await this.runtime.control(task, "pause");
    return task;
  }

  @Post(":id/resume")
  public async resume(
    @RequestPrincipal() principal: Principal,
    @Param("id") id: string,
    @Headers("idempotency-key") key: string | undefined,
  ) {
    const task = await this.tasks.control(principal, id, "resume", key ?? "");
    await this.runtime.control(task, "resume");
    return task;
  }

  @Post(":id/cancel")
  public async cancel(
    @RequestPrincipal() principal: Principal,
    @Param("id") id: string,
    @Headers("idempotency-key") key: string | undefined,
  ) {
    const task = await this.tasks.control(principal, id, "cancel", key ?? "");
    await this.runtime.control(task, "cancel");
    return task;
  }

  @Post(":id/instructions")
  public async instruct(
    @RequestPrincipal() principal: Principal,
    @Param("id") id: string,
    @Body() body: unknown,
  ) {
    const input = taskInstructionSchema.parse(body);
    await this.tasks.recordEvent(principal, {
      taskId: id,
      type: "task.plan_created",
      actor: { type: "user", id: principal.userId },
      visibility: "user",
      summary: "Your updated instruction was recorded for replanning.",
      details: { instruction: input.instruction },
      secretFields: [],
      evidenceIds: [],
    });
    const task = await this.tasks.getTask(principal, id);
    await this.runtime.instruct(task, input.instruction);
    return task;
  }
}
