import { z } from "zod";

import { actionRequestSchema } from "./actions.js";
import { conversationSchema, messageSchema } from "./conversations.js";
import { pageSchema } from "./common.js";
import { taskEventSchema } from "./events.js";
import { taskSchema } from "./tasks.js";

export const conversationDetailSchema = z
  .object({
    conversation: conversationSchema,
    messages: z.array(messageSchema),
    tasks: z.array(taskSchema),
    pendingActions: z.array(actionRequestSchema),
  })
  .strict();

export const taskDetailSchema = z
  .object({
    task: taskSchema,
    recentEvents: z.array(taskEventSchema),
    pendingActions: z.array(actionRequestSchema),
  })
  .strict();

export const conversationPageSchema = pageSchema(conversationSchema);
export const eventPageSchema = pageSchema(taskEventSchema);

export const healthSchema = z
  .object({
    status: z.enum(["ok", "degraded", "unhealthy"]),
    service: z.string(),
    version: z.string(),
    checks: z.record(z.string(), z.enum(["ok", "degraded", "unhealthy"])),
  })
  .strict();
