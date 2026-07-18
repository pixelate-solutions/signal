import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Pause, Play, Square } from "lucide-react-native";
import { Alert, Pressable, Text, View } from "react-native";

import type { Task } from "@signal/contracts";
import { signalColors, signalRadius, signalSpacing } from "@signal/ui";

import { signalApi } from "../api/client";
import { StatusPill } from "./status-pill";

export function TaskHeader({ task }: { task: Task }) {
  const queryClient = useQueryClient();
  const control = useMutation({
    mutationFn: (action: "pause" | "resume" | "cancel") => signalApi.controlTask(task.id, action),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["task", task.id] }),
    onError: (error: Error) => Alert.alert("Task control failed", error.message),
  });
  const passed = task.successCriteria.filter((criterion) => criterion.status === "PASSED").length;
  const total = task.successCriteria.length;
  const isPaused = task.state === "PAUSED";
  const isTerminal = ["COMPLETED", "COMPLETED_WITH_WARNINGS", "FAILED", "CANCELLED"].includes(
    task.state,
  );
  return (
    <View
      style={{
        backgroundColor: signalColors.surface,
        borderRadius: signalRadius.lg,
        borderWidth: 1,
        borderColor: signalColors.line,
        padding: signalSpacing.lg,
        marginBottom: signalSpacing.xl,
      }}
    >
      <View style={{ flexDirection: "row", alignItems: "flex-start", gap: signalSpacing.md }}>
        <View style={{ flex: 1 }}>
          <StatusPill state={task.state} />
          <Text
            numberOfLines={3}
            style={{
              color: signalColors.ink,
              fontSize: 19,
              lineHeight: 25,
              fontWeight: "700",
              marginTop: signalSpacing.md,
            }}
          >
            {task.objective}
          </Text>
        </View>
        {!isTerminal && (
          <View style={{ flexDirection: "row", gap: 6 }}>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={isPaused ? "Resume task" : "Pause task"}
              onPress={() => control.mutate(isPaused ? "resume" : "pause")}
              style={({ pressed }) => ({
                width: 38,
                height: 38,
                borderRadius: 19,
                alignItems: "center",
                justifyContent: "center",
                backgroundColor: pressed ? signalColors.tealSoft : signalColors.canvas,
              })}
            >
              {isPaused ? (
                <Play size={17} color={signalColors.teal} fill={signalColors.teal} />
              ) : (
                <Pause size={17} color={signalColors.inkMuted} />
              )}
            </Pressable>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Cancel task"
              onPress={() =>
                Alert.alert("Cancel this task?", "In-flight leases will be revoked safely.", [
                  { text: "Keep running", style: "cancel" },
                  {
                    text: "Cancel task",
                    style: "destructive",
                    onPress: () => control.mutate("cancel"),
                  },
                ])
              }
              style={({ pressed }) => ({
                width: 38,
                height: 38,
                borderRadius: 19,
                alignItems: "center",
                justifyContent: "center",
                backgroundColor: pressed ? signalColors.redSoft : signalColors.canvas,
              })}
            >
              <Square size={15} color={signalColors.red} fill={signalColors.red} />
            </Pressable>
          </View>
        )}
      </View>
      <View style={{ marginTop: signalSpacing.lg }}>
        <View style={{ flexDirection: "row", justifyContent: "space-between" }}>
          <Text style={{ color: signalColors.inkMuted, fontSize: 11, fontWeight: "700" }}>
            VERIFICATION
          </Text>
          <Text style={{ color: signalColors.inkMuted, fontSize: 11 }}>
            {passed} of {total} checks passed
          </Text>
        </View>
        <View
          style={{
            height: 5,
            borderRadius: 3,
            backgroundColor: signalColors.line,
            marginTop: 7,
            overflow: "hidden",
          }}
        >
          <View
            style={{
              height: "100%",
              width: `${total === 0 ? 0 : (passed / total) * 100}%`,
              borderRadius: 3,
              backgroundColor: signalColors.teal,
            }}
          />
        </View>
      </View>
    </View>
  );
}
