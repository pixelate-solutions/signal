import { z } from "zod";

import { utcTimestampSchema } from "./common.js";

export const settingsSchema = z
  .object({
    version: z.int().nonnegative(),
    locale: z.string().min(2).max(35),
    timezone: z.string().min(1).max(100),
    implicitMemory: z.boolean(),
    biometricLock: z.boolean(),
    quietHours: z
      .object({
        enabled: z.boolean(),
        startLocal: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/),
        endLocal: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/),
      })
      .strict(),
    approvalDefaults: z.record(
      z.enum(["R0", "R1", "R2", "R3", "R4"]),
      z.enum(["DENY", "REQUIRE_APPROVAL", "ALLOW_WITH_LIMITS", "ALLOW"]),
    ),
    disabledCapabilityClasses: z.array(z.string()),
    notifications: z
      .object({
        actionRequired: z.boolean(),
        reminders: z.boolean(),
        taskCompletion: z.boolean(),
        taskFailure: z.boolean(),
        securityEvents: z.boolean(),
      })
      .strict(),
    sensitiveMemory: z.enum(["never", "confirm", "allow_explicit"]),
    modelDataPolicy: z.enum(["minimum_required", "allow_provider_improvement"]),
    processingRegion: z.enum(["automatic", "us", "eu"]),
    developerMode: z.boolean(),
    retentionDays: z.int().min(1).max(3_650),
    updatedAt: utcTimestampSchema,
  })
  .strict();

export const updateSettingsSchema = settingsSchema
  .omit({ updatedAt: true })
  .partial()
  .extend({ expectedVersion: z.int().nonnegative() })
  .strict();

export type Settings = z.infer<typeof settingsSchema>;
