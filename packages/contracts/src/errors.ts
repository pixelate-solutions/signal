import { z } from "zod";

import { correlationIdSchema } from "./ids.js";

export const errorCodeSchema = z.enum([
  "INVALID_REQUEST",
  "UNAUTHENTICATED",
  "FORBIDDEN",
  "NOT_FOUND",
  "CONFLICT",
  "STALE_ACTION",
  "CONNECTION_REQUIRED",
  "POLICY_DENIED",
  "PROVIDER_RESTRICTED",
  "RATE_LIMITED",
  "TEMPORARILY_UNAVAILABLE",
  "INTERNAL_ERROR",
]);

export const apiErrorSchema = z
  .object({
    error: z
      .object({
        code: errorCodeSchema,
        message: z.string().min(1).max(2_000),
        retryable: z.boolean(),
        correlationId: correlationIdSchema,
      })
      .strict(),
  })
  .strict();

export type ErrorCode = z.infer<typeof errorCodeSchema>;
export type ApiError = z.infer<typeof apiErrorSchema>;
