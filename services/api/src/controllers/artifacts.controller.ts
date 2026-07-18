import {
  Body,
  Controller,
  Get,
  Headers,
  Inject,
  Param,
  Post,
  Put,
  Query,
  Res,
  UseGuards,
} from "@nestjs/common";
import type { FastifyReply } from "fastify";

import type { Principal } from "@signal/auth-sdk";
import type { ArtifactService } from "@signal/artifact-service";

import { RequestPrincipal, SignalAuthGuard } from "../auth.js";
import { ARTIFACT_SERVICE } from "../tokens.js";

@Controller("v1/uploads")
export class UploadPartsController {
  public constructor(@Inject(ARTIFACT_SERVICE) private readonly artifacts: ArtifactService) {}

  @Put(":id/parts/:part")
  public putPart(
    @Param("id") id: string,
    @Param("part") part: string,
    @Query("token") token: string | undefined,
    @Body() body: Buffer,
    @Res({ passthrough: true }) response: FastifyReply,
  ) {
    const etag = this.artifacts.putPart(id, token ?? "", Number(part), body);
    response.header("etag", etag);
    return { received: true, etag };
  }
}

@UseGuards(SignalAuthGuard)
@Controller("v1/uploads")
export class UploadsController {
  public constructor(@Inject(ARTIFACT_SERVICE) private readonly artifacts: ArtifactService) {}

  @Post()
  public create(@RequestPrincipal() principal: Principal, @Body() body: unknown) {
    return this.artifacts.createUpload(principal, body);
  }

  @Post(":id/complete")
  public complete(
    @RequestPrincipal() principal: Principal,
    @Param("id") id: string,
    @Headers("idempotency-key") _idempotencyKey: string | undefined,
    @Body() body: unknown,
  ) {
    return this.artifacts.completeUpload(principal, id, body);
  }
}

@UseGuards(SignalAuthGuard)
@Controller("v1/artifacts")
export class ArtifactsController {
  public constructor(@Inject(ARTIFACT_SERVICE) private readonly artifacts: ArtifactService) {}

  @Get(":id")
  public get(@RequestPrincipal() principal: Principal, @Param("id") id: string) {
    return this.artifacts.get(principal, id);
  }

  @Get(":id/versions")
  public versions(@RequestPrincipal() principal: Principal, @Param("id") id: string) {
    return { items: this.artifacts.versions(principal, id), nextCursor: null };
  }

  @Get(":id/content")
  public content(
    @RequestPrincipal() principal: Principal,
    @Param("id") id: string,
    @Res() response: FastifyReply,
  ) {
    const artifact = this.artifacts.get(principal, id);
    response.header("content-type", artifact.mimeType);
    response.header(
      "content-disposition",
      `attachment; filename*=UTF-8''${encodeURIComponent(artifact.originalName)}`,
    );
    return response.send(Buffer.from(this.artifacts.bytes(principal, id)));
  }
}
