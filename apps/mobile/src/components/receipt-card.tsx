import { CheckCircle2, ReceiptText, ShieldCheck } from "lucide-react-native";
import { Text, View } from "react-native";

import type { Task, TaskEvent } from "@signal/contracts";
import { signalColors, signalRadius, signalSpacing } from "@signal/ui";

import { isQuestionObjective, receiptOutcome } from "./receipt-summary";

export function ReceiptCard({ task, events }: { task: Task; events: readonly TaskEvent[] }) {
  if (task.state !== "COMPLETED" && task.state !== "COMPLETED_WITH_WARNINGS") return null;
  const toolEvents = events.filter((event) => event.type === "tool.execution_succeeded");
  const evidence = new Set(events.flatMap((event) => event.evidenceIds));
  const verified = task.successCriteria.filter((criterion) => criterion.status === "PASSED");
  const question = isQuestionObjective(task.objective);
  const outcome = receiptOutcome(task, events);
  return (
    <View
      accessibilityLabel="Verified task receipt"
      style={{
        backgroundColor: signalColors.limeSoft,
        borderWidth: 1,
        borderColor: "#B9D89A",
        borderRadius: signalRadius.lg,
        padding: signalSpacing.lg,
        marginTop: signalSpacing.lg,
      }}
    >
      <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
        <ReceiptText color={signalColors.tealDark} size={20} />
        <Text style={{ color: signalColors.tealDark, fontWeight: "900", letterSpacing: 0.7 }}>
          {question ? "VERIFIED ANSWER" : "VERIFIED RECEIPT"}
        </Text>
      </View>
      <Text
        style={{
          color: signalColors.ink,
          fontSize: 18,
          lineHeight: 24,
          fontWeight: "800",
          marginTop: 12,
        }}
      >
        {outcome}
      </Text>
      <View style={{ gap: 7, marginTop: signalSpacing.md }}>
        <View style={{ flexDirection: "row", alignItems: "center", gap: 7 }}>
          <CheckCircle2 color={signalColors.teal} size={16} />
          <Text style={{ color: signalColors.inkMuted, fontSize: 12 }}>
            {toolEvents.length} material tool action{toolEvents.length === 1 ? "" : "s"} completed
          </Text>
        </View>
        <View style={{ flexDirection: "row", alignItems: "center", gap: 7 }}>
          <ShieldCheck color={signalColors.teal} size={16} />
          <Text style={{ color: signalColors.inkMuted, fontSize: 12 }}>
            {verified.length} required criterion verified · {evidence.size} evidence reference
            {evidence.size === 1 ? "" : "s"}
          </Text>
        </View>
      </View>
      <Text style={{ color: signalColors.inkMuted, fontSize: 10, marginTop: 12 }}>
        Task {task.id} · completed{" "}
        {task.completedAt === null ? "now" : new Date(task.completedAt).toLocaleString()}
      </Text>
    </View>
  );
}
