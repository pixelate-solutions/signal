import { useMutation, useQuery } from "@tanstack/react-query";
import {
  Bell,
  Blocks,
  ChevronRight,
  CircleUserRound,
  Code2,
  Database,
  Fingerprint,
  KeyRound,
  Link2,
  LockKeyhole,
  MemoryStick,
  RadioTower,
  Shield,
  ShieldAlert,
  Smartphone,
} from "lucide-react-native";
import type { LucideIcon } from "lucide-react-native";
import { useState } from "react";
import { Alert, Pressable, ScrollView, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { signalColors, signalRadius, signalSpacing } from "@signal/ui";

import { signalApi, signalApiBaseUrl } from "../api/client";
import { BrandMark } from "../components/brand-mark";
import { SettingsDetail, type SettingsRoute } from "./settings-detail";

type SettingsRowProps = {
  icon: LucideIcon;
  title: string;
  detail: string;
  tone?: "normal" | "danger";
  onPress?: () => void;
};

function SettingsRow({ icon: Icon, title, detail, tone = "normal", onPress }: SettingsRowProps) {
  const accent = tone === "danger" ? signalColors.red : signalColors.teal;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${title}. ${detail}`}
      onPress={onPress}
      style={({ pressed }) => ({
        flexDirection: "row",
        alignItems: "center",
        gap: signalSpacing.md,
        paddingVertical: signalSpacing.md,
        opacity: pressed ? 0.65 : 1,
      })}
    >
      <View
        style={{
          width: 40,
          height: 40,
          borderRadius: 13,
          alignItems: "center",
          justifyContent: "center",
          backgroundColor: tone === "danger" ? signalColors.redSoft : signalColors.tealSoft,
        }}
      >
        <Icon color={accent} size={20} />
      </View>
      <View style={{ flex: 1 }}>
        <Text
          style={{
            color: tone === "danger" ? signalColors.red : signalColors.ink,
            fontWeight: "700",
          }}
        >
          {title}
        </Text>
        <Text style={{ color: signalColors.inkMuted, fontSize: 12, lineHeight: 17, marginTop: 3 }}>
          {detail}
        </Text>
      </View>
      <ChevronRight color={signalColors.inkMuted} size={17} />
    </Pressable>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <View style={{ marginBottom: signalSpacing.xl }}>
      <Text
        style={{
          color: signalColors.inkMuted,
          fontSize: 11,
          fontWeight: "800",
          letterSpacing: 1.1,
          marginLeft: 4,
          marginBottom: signalSpacing.sm,
        }}
      >
        {title.toUpperCase()}
      </Text>
      <View
        style={{
          backgroundColor: signalColors.surface,
          borderRadius: signalRadius.lg,
          borderWidth: 1,
          borderColor: signalColors.line,
          paddingHorizontal: signalSpacing.lg,
        }}
      >
        {children}
      </View>
    </View>
  );
}

export function SettingsScreen() {
  const insets = useSafeAreaInsets();
  const [route, setRoute] = useState<SettingsRoute | null>(null);
  const settings = useQuery({
    queryKey: ["settings"],
    queryFn: signalApi.getSettings,
    retry: false,
  });
  const connections = useQuery({
    queryKey: ["connections"],
    queryFn: signalApi.listConnections,
    retry: false,
  });
  const memories = useQuery({
    queryKey: ["memories"],
    queryFn: signalApi.listMemories,
    retry: false,
  });
  const emergencyStop = useMutation({
    mutationFn: () =>
      signalApi.emergencyStop("Emergency stop initiated from the mobile Settings screen."),
    onSuccess: ({ affectedTaskIds }) =>
      Alert.alert(
        "Privileged work stopped",
        `${affectedTaskIds.length} active task${affectedTaskIds.length === 1 ? " was" : "s were"} moved to a safe state.`,
      ),
    onError: (error: Error) => Alert.alert("Emergency stop failed", error.message),
  });
  const confirmEmergencyStop = () => {
    Alert.alert(
      "Emergency stop all privileged work?",
      "Signal will block new privileged leases and cancel active tasks for this tenant.",
      [
        { text: "Keep running", style: "cancel" },
        {
          text: "Stop privileged work",
          style: "destructive",
          onPress: () => emergencyStop.mutate(),
        },
      ],
    );
  };
  const connectionCount =
    connections.data?.items.filter((item) => item.status === "ACTIVE").length ?? 0;
  const memoryCount = memories.data?.items.filter((item) => item.status === "active").length ?? 0;
  const controlPlane =
    settings.isPending || connections.isPending || memories.isPending
      ? {
          label: "CHECKING",
          accessibilityLabel: "Checking control plane connection",
          foreground: signalColors.inkMuted,
          background: signalColors.canvas,
        }
      : settings.isError || connections.isError || memories.isError
        ? {
            label: "DEGRADED",
            accessibilityLabel: "Control plane connection degraded",
            foreground: signalColors.amber,
            background: signalColors.amberSoft,
          }
        : {
            label: "ONLINE",
            accessibilityLabel: "Control plane connected",
            foreground: signalColors.tealDark,
            background: signalColors.tealSoft,
          };
  return (
    <View style={{ flex: 1, backgroundColor: signalColors.canvas }}>
      <View
        style={{
          paddingTop: insets.top + 8,
          paddingHorizontal: signalSpacing.lg,
          paddingBottom: signalSpacing.md,
          flexDirection: "row",
          alignItems: "center",
          gap: signalSpacing.md,
        }}
      >
        <BrandMark compact />
        <View style={{ flex: 1 }}>
          <Text style={{ color: signalColors.ink, fontWeight: "800", fontSize: 18 }}>SETTINGS</Text>
          <Text style={{ color: signalColors.inkMuted, fontSize: 11, marginTop: 1 }}>
            Authority, data, and connections
          </Text>
        </View>
        <View
          accessibilityLabel={controlPlane.accessibilityLabel}
          style={{
            flexDirection: "row",
            alignItems: "center",
            gap: 6,
            paddingHorizontal: 10,
            paddingVertical: 6,
            backgroundColor: controlPlane.background,
            borderRadius: signalRadius.pill,
          }}
        >
          <View
            style={{
              width: 7,
              height: 7,
              borderRadius: 4,
              backgroundColor: controlPlane.foreground,
            }}
          />
          <Text style={{ color: controlPlane.foreground, fontSize: 10, fontWeight: "800" }}>
            {controlPlane.label}
          </Text>
        </View>
      </View>
      <ScrollView
        contentContainerStyle={{
          paddingHorizontal: signalSpacing.lg,
          paddingTop: signalSpacing.md,
          paddingBottom: insets.bottom + 100,
        }}
      >
        <Pressable
          onPress={() => setRoute("account")}
          style={{
            backgroundColor: signalColors.ink,
            borderRadius: signalRadius.lg,
            padding: signalSpacing.lg,
            marginBottom: signalSpacing.xl,
            flexDirection: "row",
            alignItems: "center",
            gap: signalSpacing.md,
            overflow: "hidden",
          }}
        >
          <View
            style={{
              position: "absolute",
              width: 150,
              height: 150,
              borderRadius: 75,
              right: -35,
              top: -75,
              backgroundColor: "#16413E",
            }}
          />
          <View
            style={{
              width: 50,
              height: 50,
              borderRadius: 25,
              backgroundColor: signalColors.lime,
              alignItems: "center",
              justifyContent: "center",
            }}
          >
            <CircleUserRound color={signalColors.ink} size={27} />
          </View>
          <View style={{ flex: 1 }}>
            <Text style={{ color: signalColors.surface, fontSize: 17, fontWeight: "700" }}>
              Signal operator
            </Text>
            <Text style={{ color: "#AFC5BF", fontSize: 12, marginTop: 4 }}>
              Owner · secured OIDC session
            </Text>
          </View>
          <ChevronRight color="#AFC5BF" size={19} />
        </Pressable>

        <Section title="Account & access">
          <SettingsRow
            icon={KeyRound}
            title="Account and sessions"
            detail="Review active sessions and recent authentication"
            onPress={() => setRoute("account")}
          />
          <SettingsRow
            icon={Link2}
            title="Connections"
            detail={`${connectionCount} active connection${connectionCount === 1 ? "" : "s"} · OAuth credentials stay brokered`}
            onPress={() => setRoute("connections")}
          />
          <SettingsRow
            icon={Fingerprint}
            title="Biometric lock"
            detail={settings.data?.biometricLock ? "Required" : "Not enabled"}
            onPress={() => setRoute("security")}
          />
        </Section>

        <Section title="Authority">
          <SettingsRow
            icon={Shield}
            title="Permissions"
            detail="Capability classes, domains, recipients, and spending limits"
            onPress={() => setRoute("permissions")}
          />
          <SettingsRow
            icon={ShieldAlert}
            title="Approval rules"
            detail="R2 and higher require an exact, digest-bound decision"
            onPress={() => setRoute("approvals")}
          />
          <SettingsRow
            icon={Smartphone}
            title="Device access"
            detail="Foreground-only safe actions · enterprise controls separated"
            onPress={() => setRoute("devices")}
          />
        </Section>

        <Section title="Data & memory">
          <SettingsRow
            icon={MemoryStick}
            title="Memory"
            detail={`${memoryCount} active item${memoryCount === 1 ? "" : "s"} · inspect, correct, forget, or export`}
            onPress={() => setRoute("memory")}
          />
          <SettingsRow
            icon={Database}
            title="Privacy and retention"
            detail={`${settings.data?.retentionDays ?? 365}-day retention · export and deletion controls`}
            onPress={() => setRoute("privacy")}
          />
          <SettingsRow
            icon={LockKeyhole}
            title="Security"
            detail="Secret scan, redaction, audit chain, and recent-auth policy"
            onPress={() => setRoute("security")}
          />
        </Section>

        <Section title="Experience">
          <SettingsRow
            icon={Bell}
            title="Notifications"
            detail="Action requests, quiet hours, and duplicate suppression"
            onPress={() => setRoute("notifications")}
          />
          <SettingsRow
            icon={RadioTower}
            title="Background operation"
            detail="Server tasks continue when this device is offline"
            onPress={() => setRoute("notifications")}
          />
        </Section>

        <Section title="Developer">
          <SettingsRow
            icon={Code2}
            title="Custom integrations"
            detail="Generated adapters are sandboxed, tested, signed, and canaried"
            onPress={() => setRoute("developer")}
          />
          <SettingsRow
            icon={Blocks}
            title="Control plane"
            detail={signalApiBaseUrl}
            onPress={() => setRoute("developer")}
          />
        </Section>

        <Section title="Emergency controls">
          <SettingsRow
            icon={ShieldAlert}
            title="Emergency stop"
            detail="Block new privileged leases and move active tasks to a safe state"
            tone="danger"
            onPress={confirmEmergencyStop}
          />
        </Section>
        <Text style={{ textAlign: "center", color: signalColors.inkMuted, fontSize: 11 }}>
          Signal 0.1.0 · Every material action remains attributable and reviewable.
        </Text>
      </ScrollView>
      <SettingsDetail route={route} onClose={() => setRoute(null)} />
    </View>
  );
}
