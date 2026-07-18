import { Text, View } from "react-native";

import type { TaskState } from "@signal/contracts";
import { signalRadius, signalSpacing, toneColors, type SemanticTone } from "@signal/ui";

const terminalSuccess: readonly TaskState[] = ["COMPLETED", "COMPLETED_WITH_WARNINGS"];
const active: readonly TaskState[] = ["QUEUED", "PLANNING", "RUNNING"];

function stateTone(state: TaskState): SemanticTone {
  if (terminalSuccess.includes(state)) return "success";
  if (state === "FAILED" || state === "CANCELLED") return "danger";
  if (state.startsWith("WAITING") || state === "RETRY_SCHEDULED" || state === "PAUSED") {
    return "warning";
  }
  return active.includes(state) ? "active" : "neutral";
}

export function StatusPill({ state }: { state: TaskState }) {
  const colors = toneColors(stateTone(state));
  return (
    <View
      accessibilityLabel={`Task status ${state.toLowerCase().replaceAll("_", " ")}`}
      style={{
        alignSelf: "flex-start",
        flexDirection: "row",
        alignItems: "center",
        gap: signalSpacing.sm,
        backgroundColor: colors.background,
        borderRadius: signalRadius.pill,
        paddingHorizontal: 11,
        paddingVertical: 6,
      }}
    >
      <View style={{ width: 7, height: 7, borderRadius: 4, backgroundColor: colors.foreground }} />
      <Text
        style={{
          color: colors.foreground,
          fontSize: 11,
          fontWeight: "800",
          letterSpacing: 0.8,
        }}
      >
        {state.replaceAll("_", " ")}
      </Text>
    </View>
  );
}
