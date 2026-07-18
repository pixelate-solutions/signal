import { useMutation, useQueryClient } from "@tanstack/react-query";
import * as Haptics from "expo-haptics";
import { Check, ShieldAlert, X } from "lucide-react-native";
import { Alert, Pressable, Text, View } from "react-native";

import type { ActionRequest, ActionResponseInput } from "@signal/contracts";
import { signalColors, signalRadius, signalSpacing } from "@signal/ui";

import { signalApi } from "../api/client";

function displayMaterial(value: unknown): string {
  const raw = typeof value === "string" ? value : JSON.stringify(value);
  return raw.replaceAll(/([/:@._-])/g, "$1\u200B").replaceAll(/(\S{24})/g, "$1\u200B");
}

export function ActionCard({ action }: { action: ActionRequest }) {
  const queryClient = useQueryClient();
  const respond = useMutation({
    mutationFn: async (response: ActionResponseInput["response"]) => {
      await Haptics.notificationAsync(
        response === "APPROVE"
          ? Haptics.NotificationFeedbackType.Success
          : Haptics.NotificationFeedbackType.Warning,
      );
      return signalApi.respondToAction(action, {
        response,
        materialDigest: action.materialDigest,
      });
    },
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["task", action.taskId] }),
        queryClient.invalidateQueries({ queryKey: ["actions"] }),
      ]);
    },
    onError: (error: Error) => Alert.alert("Decision not recorded", error.message),
  });
  return (
    <View
      accessibilityLabel={`Approval request: ${action.title}`}
      style={{
        backgroundColor: signalColors.ink,
        borderRadius: signalRadius.lg,
        padding: signalSpacing.lg,
        marginBottom: signalSpacing.lg,
        overflow: "hidden",
      }}
    >
      <View
        style={{
          position: "absolute",
          width: 130,
          height: 130,
          borderRadius: 65,
          backgroundColor: "#12433E",
          right: -45,
          top: -55,
        }}
      />
      <View style={{ flexDirection: "row", alignItems: "center", gap: signalSpacing.sm }}>
        <ShieldAlert color={signalColors.lime} size={19} />
        <Text
          style={{ color: signalColors.lime, fontSize: 11, fontWeight: "800", letterSpacing: 1 }}
        >
          {action.risk} · REVIEW REQUIRED
        </Text>
      </View>
      <Text
        style={{
          color: signalColors.surface,
          fontSize: 20,
          lineHeight: 26,
          fontWeight: "700",
          marginTop: signalSpacing.md,
        }}
      >
        {action.title}
      </Text>
      <Text style={{ color: "#BDD0CA", lineHeight: 20, marginTop: signalSpacing.sm }}>
        {action.description}
      </Text>
      <View
        style={{
          backgroundColor: "#102B30",
          borderRadius: signalRadius.sm,
          padding: signalSpacing.md,
          marginTop: signalSpacing.md,
          gap: 6,
        }}
      >
        {Object.entries(action.materialPayload).map(([key, value]) => (
          <View key={key} style={{ flexDirection: "row", gap: signalSpacing.sm }}>
            <Text style={{ color: "#829A94", width: 72, fontSize: 12 }}>{key}</Text>
            <Text
              style={{
                color: signalColors.surface,
                flex: 1,
                flexShrink: 1,
                minWidth: 0,
                fontSize: 12,
                fontWeight: "600",
              }}
            >
              {displayMaterial(value)}
            </Text>
          </View>
        ))}
      </View>
      <Text style={{ color: "#829A94", fontSize: 11, marginTop: signalSpacing.sm }}>
        Expires{" "}
        {new Date(action.expiresAt).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}
        {action.requiresRecentAuth ? " · Recent authentication required" : ""}
      </Text>
      <View style={{ flexDirection: "row", gap: signalSpacing.sm, marginTop: signalSpacing.lg }}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Reject action"
          disabled={respond.isPending}
          onPress={() => respond.mutate("REJECT")}
          style={({ pressed }) => ({
            flex: 1,
            height: 47,
            borderRadius: signalRadius.md,
            borderWidth: 1,
            borderColor: "#45615C",
            alignItems: "center",
            justifyContent: "center",
            flexDirection: "row",
            gap: 7,
            opacity: pressed || respond.isPending ? 0.65 : 1,
          })}
        >
          <X color={signalColors.surface} size={17} />
          <Text style={{ color: signalColors.surface, fontWeight: "700" }}>Reject</Text>
        </Pressable>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Approve exact action"
          disabled={respond.isPending}
          onPress={() => respond.mutate("APPROVE")}
          style={({ pressed }) => ({
            flex: 1.35,
            height: 47,
            borderRadius: signalRadius.md,
            backgroundColor: signalColors.lime,
            alignItems: "center",
            justifyContent: "center",
            flexDirection: "row",
            gap: 7,
            opacity: pressed || respond.isPending ? 0.75 : 1,
          })}
        >
          <Check color={signalColors.ink} size={18} />
          <Text style={{ color: signalColors.ink, fontWeight: "800" }}>
            {respond.isPending ? "Recording…" : "Approve once"}
          </Text>
        </Pressable>
      </View>
    </View>
  );
}
