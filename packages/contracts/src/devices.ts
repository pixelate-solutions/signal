import { z } from "zod";

import { publicJsonValueSchema, sha256DigestSchema, utcTimestampSchema } from "./common.js";
import { commandIdSchema, deviceIdSchema, taskIdSchema, userIdSchema } from "./ids.js";
import { taskRiskSchema } from "./tasks.js";

export const deviceCommandSchema = z
  .object({
    commandId: commandIdSchema,
    taskId: taskIdSchema,
    userId: userIdSchema,
    deviceId: deviceIdSchema,
    actionType: z.enum([
      "open_url",
      "app_intent",
      "android_intent",
      "select_contact",
      "calendar_upsert",
      "compose_message",
      "select_file",
      "capture_document",
      "foreground_location",
      "biometric_auth",
      "home_action",
      "create_signal_note",
    ]),
    payload: z.record(z.string(), publicJsonValueSchema),
    requiredPermission: z.string().min(1).max(200),
    riskClass: taskRiskSchema,
    requiresForeground: z.boolean(),
    requiresConfirmation: z.boolean(),
    issuedAt: utcTimestampSchema,
    expiresAt: utcTimestampSchema,
    nonce: z.string().min(32).max(256),
    serverSignature: z.string().min(64).max(1_024),
  })
  .strict();

export const deviceRegistrationSchema = z
  .object({
    platform: z.enum(["ios", "android"]),
    appVariant: z.enum(["consumer", "managed_enterprise"]),
    displayName: z.string().min(1).max(200),
    publicKey: z.string().min(32).max(4_096),
    pushTokenHandle: z.string().min(8).max(500).nullable(),
    capabilities: z.array(deviceCommandSchema.shape.actionType).max(100),
  })
  .strict();

export const deviceCommandResultSchema = z
  .object({
    commandId: commandIdSchema,
    status: z.enum([
      "SUCCEEDED",
      "UNSUPPORTED",
      "PERMISSION_DENIED",
      "OFFLINE",
      "EXPIRED",
      "CANCELLED",
      "FAILED",
    ]),
    result: z.record(z.string(), publicJsonValueSchema),
    evidenceDigest: sha256DigestSchema.nullable(),
    completedAt: utcTimestampSchema,
    deviceSignature: z.string().min(64).max(1_024),
  })
  .strict();

export type DeviceCommand = z.infer<typeof deviceCommandSchema>;
export type DeviceRegistration = z.infer<typeof deviceRegistrationSchema>;
export type DeviceCommandResult = z.infer<typeof deviceCommandResultSchema>;
