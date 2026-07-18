import { Controller, Get, Inject, NotFoundException } from "@nestjs/common";

import type { DevelopmentPushSink } from "@signal/notification-service";

import { DEVELOPMENT_PUSH_SINK } from "../tokens.js";

@Controller("v1/development")
export class DevelopmentController {
  public constructor(
    @Inject(DEVELOPMENT_PUSH_SINK) private readonly pushSink: DevelopmentPushSink,
  ) {}

  @Get("push")
  public pushes() {
    if (process.env["NODE_ENV"] === "production") throw new NotFoundException();
    return { items: this.pushSink.messages, nextCursor: null };
  }
}
