import { useQueryClient } from "@tanstack/react-query";
import * as Linking from "expo-linking";
import * as Notifications from "expo-notifications";
import { useEffect } from "react";
import { Alert } from "react-native";

import { signalApi } from "../api/client";
import { useSignalStore } from "../state/use-signal-store";
import { runPendingDeviceCommands } from "../device/runner";

const handledInvitations = new Set<string>();

async function route(url: string, queryClient: ReturnType<typeof useQueryClient>): Promise<void> {
  const parsed = Linking.parse(url);
  const segments = (parsed.path ?? "").split("/").filter(Boolean);
  const invitationToken = parsed.queryParams?.["token"];
  const invitationTenant = parsed.queryParams?.["tenantId"];
  if (
    (parsed.hostname === "invite" || segments.includes("invite")) &&
    typeof invitationToken === "string" &&
    typeof invitationTenant === "string" &&
    !handledInvitations.has(invitationToken)
  ) {
    handledInvitations.add(invitationToken);
    try {
      const membership = await signalApi.acceptOrganizationInvitation(
        invitationTenant,
        invitationToken,
      );
      useSignalStore.getState().setActiveTenant(membership.tenantId);
      queryClient.clear();
      Alert.alert("Invitation accepted", `You are now using ${membership.name}.`);
    } catch (error) {
      handledInvitations.delete(invitationToken);
      Alert.alert(
        "Invitation not accepted",
        error instanceof Error ? error.message : "The invitation could not be accepted.",
      );
    }
    return;
  }
  const taskIndex = segments.indexOf("tasks");
  const actionIndex = segments.indexOf("actions");
  const taskId = taskIndex >= 0 ? segments[taskIndex + 1] : undefined;
  const actionId = actionIndex >= 0 ? segments[actionIndex + 1] : undefined;
  if (segments.includes("device-commands")) {
    void runPendingDeviceCommands();
  }
  if (taskId?.startsWith("tsk_") === true) {
    useSignalStore.getState().routeToTask(taskId, actionId ?? null);
  }
}

function routeResponse(
  response: Notifications.NotificationResponse,
  queryClient: ReturnType<typeof useQueryClient>,
): void {
  const data = response.notification.request.content.data ?? {};
  const deepLink = data["deepLink"];
  if (typeof deepLink === "string") void route(deepLink, queryClient);
}

export function NotificationRouter() {
  const queryClient = useQueryClient();
  useEffect(() => {
    const received = Notifications.addNotificationReceivedListener((notification) => {
      void queryClient.invalidateQueries({ queryKey: ["actions"] });
      const data = notification.request.content.data ?? {};
      if (typeof data["deepLink"] === "string" && data["deepLink"].includes("device-commands")) {
        void runPendingDeviceCommands();
      }
    });
    const response = Notifications.addNotificationResponseReceivedListener((notification) => {
      routeResponse(notification, queryClient);
      void queryClient.invalidateQueries({ queryKey: ["actions"] });
    });
    const link = Linking.addEventListener("url", ({ url }) => void route(url, queryClient));
    const notification = Notifications.getLastNotificationResponse();
    if (notification !== null) {
      routeResponse(notification, queryClient);
      Notifications.clearLastNotificationResponse();
    }
    void Linking.getInitialURL().then((initialUrl) => {
      if (initialUrl !== null) void route(initialUrl, queryClient);
    });
    return () => {
      received.remove();
      response.remove();
      link.remove();
    };
  }, [queryClient]);
  return null;
}
