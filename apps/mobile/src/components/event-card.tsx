import {
  AlertCircle,
  Check,
  ChevronDown,
  Clock3,
  Route,
  ShieldCheck,
  Sparkles,
  Wrench,
} from "lucide-react-native";
import { useState } from "react";
import { Pressable, Text, View } from "react-native";

import type { TaskEvent } from "@signal/contracts";
import { renderEventCard, type EventCardTone } from "@signal/event-sdk/renderer";
import { formatShortTime, signalColors, signalRadius, signalSpacing } from "@signal/ui";

const palette: Record<EventCardTone, { accent: string; tint: string }> = {
  neutral: { accent: signalColors.inkMuted, tint: signalColors.surfaceRaised },
  progress: { accent: signalColors.blue, tint: signalColors.blueSoft },
  success: { accent: signalColors.teal, tint: signalColors.limeSoft },
  warning: { accent: signalColors.amber, tint: signalColors.amberSoft },
  danger: { accent: signalColors.red, tint: signalColors.redSoft },
  action: { accent: signalColors.violet, tint: signalColors.violetSoft },
};

function Icon({ event, color }: { event: TaskEvent; color: string }) {
  const props = { color, size: 18, strokeWidth: 2.2 };
  if (event.type.startsWith("tool.")) return <Wrench {...props} />;
  if (event.type.startsWith("verification.")) return <ShieldCheck {...props} />;
  if (event.type === "route.changed") return <Route {...props} />;
  if (event.type.includes("wait") || event.type.includes("retry")) return <Clock3 {...props} />;
  if (event.type.endsWith("failed")) return <AlertCircle {...props} />;
  if (event.type.endsWith("succeeded") || event.type === "task.completed") {
    return <Check {...props} />;
  }
  return <Sparkles {...props} />;
}

export function TaskEventCard({ event, last }: { event: TaskEvent; last: boolean }) {
  const [expanded, setExpanded] = useState(false);
  const card = renderEventCard(event);
  const colors = palette[card.tone];
  const details = Object.entries(event.details).filter(
    ([key]) => !event.secretFields.includes(key) && key !== "userMessage",
  );
  return (
    <View style={{ flexDirection: "row", alignItems: "stretch" }}>
      <View style={{ width: 34, alignItems: "center" }}>
        <View
          style={{
            width: 30,
            height: 30,
            borderRadius: 15,
            alignItems: "center",
            justifyContent: "center",
            backgroundColor: colors.tint,
            borderWidth: 1,
            borderColor: `${colors.accent}30`,
          }}
        >
          <Icon event={event} color={colors.accent} />
        </View>
        {!last && <View style={{ flex: 1, width: 1, backgroundColor: signalColors.line }} />}
      </View>
      <Pressable
        disabled={!card.expandable}
        onPress={() => setExpanded((value) => !value)}
        accessibilityRole={card.expandable ? "button" : undefined}
        accessibilityLabel={`${card.eyebrow}. ${card.title}`}
        style={({ pressed }) => ({
          flex: 1,
          marginLeft: signalSpacing.sm,
          marginBottom: last ? 0 : signalSpacing.lg,
          borderRadius: signalRadius.md,
          borderWidth: 1,
          borderColor: signalColors.line,
          backgroundColor: pressed ? colors.tint : signalColors.surface,
          padding: signalSpacing.md,
        })}
      >
        <View style={{ flexDirection: "row", alignItems: "center", gap: signalSpacing.sm }}>
          <Text
            style={{
              flex: 1,
              color: colors.accent,
              fontSize: 10,
              fontWeight: "800",
              letterSpacing: 1,
              textTransform: "uppercase",
            }}
          >
            {card.eyebrow}
          </Text>
          <Text style={{ color: signalColors.inkMuted, fontSize: 11 }}>
            {formatShortTime(event.occurredAt)}
          </Text>
          {card.expandable && (
            <ChevronDown
              color={signalColors.inkMuted}
              size={14}
              style={{ transform: [{ rotate: expanded ? "180deg" : "0deg" }] }}
            />
          )}
        </View>
        <Text
          style={{
            marginTop: 5,
            color: signalColors.ink,
            fontSize: 15,
            lineHeight: 21,
            fontWeight: "600",
          }}
        >
          {card.title}
        </Text>
        {card.body.length > 0 && (
          <Text style={{ color: signalColors.inkMuted, marginTop: 5, lineHeight: 20 }}>
            {card.body}
          </Text>
        )}
        {expanded && details.length > 0 && (
          <View
            style={{
              marginTop: signalSpacing.md,
              borderTopWidth: 1,
              borderTopColor: signalColors.line,
              paddingTop: signalSpacing.sm,
              gap: 5,
            }}
          >
            {details.map(([key, value]) => (
              <Text
                key={key}
                style={{ color: signalColors.inkMuted, fontSize: 12, lineHeight: 18 }}
              >
                <Text style={{ fontWeight: "700" }}>{key.replaceAll("_", " ")}: </Text>
                {typeof value === "string" ? value : JSON.stringify(value)}
              </Text>
            ))}
            {event.evidenceIds.length > 0 && (
              <Text style={{ color: signalColors.teal, fontSize: 12, fontWeight: "700" }}>
                {event.evidenceIds.length} immutable evidence reference
                {event.evidenceIds.length === 1 ? "" : "s"}
              </Text>
            )}
          </View>
        )}
      </Pressable>
    </View>
  );
}
