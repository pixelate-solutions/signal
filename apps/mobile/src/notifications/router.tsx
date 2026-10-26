import { useQueryClient } from "@tanstack/react-query";
import * as Linking from "expo-linking";
import * as Notifications from "expo-notifications";
import { useEffect } from "react";
import { Alert, Platform } from "react-native";

import { signalApi } from "../api/client";
import { useSignalStore } from "../state/use-signal-store";
import { runPendingDeviceCommands } from "../device/runner";
import { deepLinkSegments } from "./deep-link";

const handledInvitations = new Set<string>();

async function route(url: string, queryClient: ReturnType<typeof useQueryClient>): Promise<void> {
  const parsed = Linking.parse(url);
  const segments = deepLinkSegments(parsed.hostname, parsed.path);
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
  if (segments.includes("connections") || actionId?.startsWith("act_") === true) {
    await queryClient.invalidateQueries({ queryKey: ["connections"] });
  }
  if (segments.includes("device-commands")) {
    void runPendingDeviceCommands();
  }
  if (taskId?.startsWith("tsk_") === true) {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ["task", taskId] }),
      queryClient.invalidateQueries({ queryKey: ["actions"] }),
    ]);
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
    const link = Linking.addEventListener("url", ({ url }) => void route(url, queryClient));
    void Linking.getInitialURL().then((initialUrl) => {
      if (initialUrl !== null) void route(initialUrl, queryClient);
    });
    if (Platform.OS === "web") return () => link.remove();

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
    const notification = Notifications.getLastNotificationResponse();
    if (notification !== null) {
      routeResponse(notification, queryClient);
      Notifications.clearLastNotificationResponse();
    }
    return () => {
      received.remove();
      response.remove();
      link.remove();
    };
  }, [queryClient]);
  return null;
}
