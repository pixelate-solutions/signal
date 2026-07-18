import {
  Catch,
  HttpException,
  HttpStatus,
  type ArgumentsHost,
  type ExceptionFilter,
} from "@nestjs/common";
import type { FastifyReply } from "fastify";
import { ZodError } from "zod";

import { ArtifactError } from "@signal/artifact-service";
import { AuthorizationError } from "@signal/auth-sdk";
import { ConnectionNotFoundError } from "@signal/connection-service";
import type { ErrorCode } from "@signal/contracts";
import { MemoryNotFoundError } from "@signal/memory-service";
import { ProhibitedMemoryError } from "@signal/memory-sdk";
import { StaleActionError, TaskConflictError, TaskNotFoundError } from "@signal/task-service";

import { SettingsConflictError } from "./control-plane.js";

function correlationId(): string {
  return `corr_${crypto.randomUUID().replaceAll("-", "")}`;
}

@Catch()
export class SignalExceptionFilter implements ExceptionFilter {
  public catch(exception: unknown, host: ArgumentsHost): void {
    const response = host.switchToHttp().getResponse<FastifyReply>();
    const normalized = this.normalize(exception);
    void response.status(normalized.status).send({
      error: {
        code: normalized.code,
        message: normalized.message,
        retryable: normalized.retryable,
        correlationId: correlationId(),
      },
    });
  }

  private normalize(exception: unknown): {
    status: number;
    code: ErrorCode;
    message: string;
    retryable: boolean;
  } {
    if (exception instanceof TaskNotFoundError) {
      return { status: 404, code: "NOT_FOUND", message: exception.message, retryable: false };
    }
    if (exception instanceof StaleActionError) {
      return { status: 409, code: "STALE_ACTION", message: exception.message, retryable: false };
    }
    if (exception instanceof TaskConflictError) {
      return { status: 409, code: "CONFLICT", message: exception.message, retryable: false };
    }
    if (
      exception instanceof MemoryNotFoundError ||
      exception instanceof ConnectionNotFoundError ||
      (exception instanceof ArtifactError && exception.code === "NOT_FOUND")
    ) {
      return { status: 404, code: "NOT_FOUND", message: exception.message, retryable: false };
    }
    if (exception instanceof SettingsConflictError) {
      return { status: 409, code: "CONFLICT", message: exception.message, retryable: false };
    }
    if (exception instanceof ZodError || exception instanceof ProhibitedMemoryError) {
      return { status: 400, code: "INVALID_REQUEST", message: exception.message, retryable: false };
    }
    if (exception instanceof ArtifactError) {
      if (exception.code === "SCAN_UNAVAILABLE") {
        return {
          status: 503,
          code: "TEMPORARILY_UNAVAILABLE",
          message: exception.message,
          retryable: true,
        };
      }
      return {
        status: exception.code === "FORBIDDEN" ? 403 : 422,
        code: exception.code === "FORBIDDEN" ? "FORBIDDEN" : "INVALID_REQUEST",
        message: exception.message,
        retryable: false,
      };
    }
    if (exception instanceof AuthorizationError) {
      return {
        status: exception.code === "UNAUTHENTICATED" ? 401 : 403,
        code: exception.code,
        message: exception.message,
        retryable: false,
      };
    }
    if (exception instanceof HttpException) {
      const status = exception.getStatus();
      return {
        status,
        code:
          status === HttpStatus.UNAUTHORIZED
            ? "UNAUTHENTICATED"
            : status === HttpStatus.FORBIDDEN
              ? "FORBIDDEN"
              : status === HttpStatus.NOT_FOUND
                ? "NOT_FOUND"
                : "INVALID_REQUEST",
        message: exception.message,
        retryable: false,
      };
    }
    if (exception instanceof Error && exception.message.startsWith("CONNECTION_REQUIRED")) {
      return {
        status: 424,
        code: "CONNECTION_REQUIRED",
        message: exception.message.replace(/^CONNECTION_REQUIRED:\s*/, ""),
        retryable: false,
      };
    }
    return {
      status: 500,
      code: "INTERNAL_ERROR",
      message: "Signal could not complete this request. The incident was recorded.",
      retryable: true,
    };
  }
}
