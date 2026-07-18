import * as Notifications from "expo-notifications";
import * as TaskManager from "expo-task-manager";

import { runPendingDeviceCommands } from "../device/runner";

const BACKGROUND_NOTIFICATION_TASK = "signal-background-notification-v1";

TaskManager.defineTask<Notifications.NotificationTaskPayload>(
  BACKGROUND_NOTIFICATION_TASK,
  async ({ data, error }) => {
    if (error !== undefined) return Notifications.BackgroundNotificationTaskResult.Failed;
    const payload = data as Record<string, unknown>;
    const notification =
      payload["notification"] !== null && typeof payload["notification"] === "object"
        ? (payload["notification"] as Record<string, unknown>)
        : payload;
    const content =
      notification["request"] !== null && typeof notification["request"] === "object"
        ? ((notification["request"] as Record<string, unknown>)["content"] as
            Record<string, unknown> | undefined)
        : undefined;
    const contentData =
      content?.["data"] !== null && typeof content?.["data"] === "object"
        ? (content["data"] as Record<string, unknown>)
        : payload;
    const deepLink = contentData["deepLink"];
    if (typeof deepLink !== "string" || !deepLink.includes("device-commands")) {
      return Notifications.BackgroundNotificationTaskResult.NoData;
    }
    try {
      await runPendingDeviceCommands();
      return Notifications.BackgroundNotificationTaskResult.NewData;
    } catch {
      return Notifications.BackgroundNotificationTaskResult.Failed;
    }
  },
);

void TaskManager.isTaskRegisteredAsync(BACKGROUND_NOTIFICATION_TASK).then((registered) => {
  if (!registered) return Notifications.registerTaskAsync(BACKGROUND_NOTIFICATION_TASK);
  return null;
});
