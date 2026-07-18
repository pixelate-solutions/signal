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
  public async putPart(
    @Param("id") id: string,
    @Param("part") part: string,
    @Query("token") token: string | undefined,
    @Body() body: Buffer,
    @Res({ passthrough: true }) response: FastifyReply,
  ) {
    const etag = await this.artifacts.putPart(id, token ?? "", Number(part), body);
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
  public async versions(@RequestPrincipal() principal: Principal, @Param("id") id: string) {
    return { items: await this.artifacts.versions(principal, id), nextCursor: null };
  }

  @Post(":id/versions")
  public createVersion(
    @RequestPrincipal() principal: Principal,
    @Param("id") id: string,
    @Body() body: unknown,
  ) {
    return this.artifacts.createVersion(principal, id, body);
  }

  @Post(":id/process")
  public process(@RequestPrincipal() principal: Principal, @Param("id") id: string) {
    return this.artifacts.process(principal, id);
  }

  @Get(":id/representation")
  public representation(@RequestPrincipal() principal: Principal, @Param("id") id: string) {
    return this.artifacts.representation(principal, id);
  }

  @Get(":id/preview")
  public async preview(
    @RequestPrincipal() principal: Principal,
    @Param("id") id: string,
    @Res() response: FastifyReply,
  ) {
    response.header("content-type", "image/jpeg");
    response.header("cache-control", "private, max-age=300");
    return response.send(Buffer.from(await this.artifacts.preview(principal, id)));
  }

  @Get(":id/content")
  public async content(
    @RequestPrincipal() principal: Principal,
    @Param("id") id: string,
    @Res() response: FastifyReply,
  ) {
    const artifact = await this.artifacts.get(principal, id);
    response.header("content-type", artifact.mimeType);
    response.header(
      "content-disposition",
      `attachment; filename*=UTF-8''${encodeURIComponent(artifact.originalName)}`,
    );
    return response.send(Buffer.from(await this.artifacts.bytes(principal, id)));
  }
}
