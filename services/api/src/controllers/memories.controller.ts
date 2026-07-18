import {
  Body,
  Controller,
  Delete,
  Get,
  Inject,
  Param,
  Patch,
  Post,
  Query,
  UseGuards,
} from "@nestjs/common";

import type { Principal } from "@signal/auth-sdk";
import type { MemoryService } from "@signal/memory-service";

import { RequestPrincipal, SignalAuthGuard } from "../auth.js";
import { MEMORY_SERVICE } from "../tokens.js";

@UseGuards(SignalAuthGuard)
@Controller("v1/memories")
export class MemoriesController {
  public constructor(@Inject(MEMORY_SERVICE) private readonly memories: MemoryService) {}

  @Get()
  public async list(
    @RequestPrincipal() principal: Principal,
    @Query("includeHistory") includeHistory: string | undefined,
  ) {
    return {
      items: await this.memories.list(principal, includeHistory === "true"),
      nextCursor: null,
    };
  }

  @Post()
  public create(@RequestPrincipal() principal: Principal, @Body() body: unknown) {
    return this.memories.create(principal, body);
  }

  @Patch(":id")
  public update(
    @RequestPrincipal() principal: Principal,
    @Param("id") id: string,
    @Body() body: unknown,
  ) {
    return this.memories.update(principal, id, body);
  }

  @Delete(":id")
  public remove(@RequestPrincipal() principal: Principal, @Param("id") id: string) {
    return this.memories.delete(principal, id);
  }
}
