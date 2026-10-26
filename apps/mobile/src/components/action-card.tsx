import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import * as Haptics from "expo-haptics";
import * as Linking from "expo-linking";
import { Check, ExternalLink, KeyRound, Link2, ShieldAlert, X } from "lucide-react-native";
import { useEffect, useRef, useState } from "react";
import { Alert, Image, Modal, Pressable, Text, TextInput, View } from "react-native";

import type { ActionRequest, ActionResponseInput } from "@signal/contracts";
import { signalColors, signalRadius, signalSpacing } from "@signal/ui";

import { signalApi } from "../api/client";
import { useAuth } from "../auth/auth-provider";

function displayMaterial(value: unknown): string {
  const raw = typeof value === "string" ? value : JSON.stringify(value);
  return raw.replaceAll(/([/:@._-])/g, "$1\u200B").replaceAll(/(\S{24})/g, "$1\u200B");
}

function invalidateAction(queryClient: ReturnType<typeof useQueryClient>, action: ActionRequest) {
  return Promise.all([
    queryClient.invalidateQueries({ queryKey: ["task", action.taskId] }),
    queryClient.invalidateQueries({ queryKey: ["actions"] }),
  ]);
}

function ActionFrame({ action, children }: { action: ActionRequest; children: React.ReactNode }) {
  return (
    <View
      accessibilityLabel={`${action.type}: ${action.title}`}
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
          {action.risk} · {action.type.replaceAll("_", " ")}
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
      {children}
    </View>
  );
}

function SecureInputCard({ action }: { action: ActionRequest }) {
  const queryClient = useQueryClient();
  const auth = useAuth();
  const [open, setOpen] = useState(false);
  const value = useRef("");
  const submit = useMutation({
    mutationFn: async () => {
      if (value.current.length === 0) throw new Error("Enter the requested value.");
      if (action.requiresRecentAuth) await auth.reauthenticate();
      const secret = await signalApi.submitSecureInput(action.id, value.current);
      value.current = "";
      return signalApi.respondToAction(action, {
        response: "SUBMIT",
        materialDigest: action.materialDigest,
        authenticationProofHandle: secret.authenticationProofHandle,
      });
    },
    onSuccess: async () => {
      setOpen(false);
      await invalidateAction(queryClient, action);
    },
    onError: (error: Error) => Alert.alert("Secure input not submitted", error.message),
  });
  return (
    <ActionFrame action={action}>
      <Pressable
        onPress={() => setOpen(true)}
        style={{
          marginTop: signalSpacing.lg,
          height: 48,
          borderRadius: signalRadius.md,
          backgroundColor: signalColors.lime,
          flexDirection: "row",
          alignItems: "center",
          justifyContent: "center",
          gap: 8,
        }}
      >
        <KeyRound color={signalColors.ink} size={18} />
        <Text style={{ color: signalColors.ink, fontWeight: "800" }}>Open secure input</Text>
      </Pressable>
      <Modal visible={open} animationType="slide" transparent onRequestClose={() => setOpen(false)}>
        <View style={{ flex: 1, justifyContent: "flex-end", backgroundColor: "#071A2080" }}>
          <View
            style={{
              backgroundColor: signalColors.surface,
              borderTopLeftRadius: 26,
              borderTopRightRadius: 26,
              padding: signalSpacing.xl,
              paddingBottom: 48,
            }}
          >
            <Text style={{ color: signalColors.ink, fontSize: 22, fontWeight: "800" }}>
              {action.title}
            </Text>
            <Text style={{ color: signalColors.inkMuted, lineHeight: 20, marginTop: 7 }}>
              The value is encrypted immediately. It is never added to the task trace, model
              context, memory, or ordinary logs.
            </Text>
            <TextInput
              autoFocus
              secureTextEntry
              accessibilityLabel="Secure value"
              onChangeText={(next) => {
                value.current = next;
              }}
              autoCapitalize="none"
              autoCorrect={false}
              style={{
                borderWidth: 1,
                borderColor: signalColors.line,
                borderRadius: signalRadius.md,
                height: 52,
                paddingHorizontal: signalSpacing.md,
                marginTop: signalSpacing.lg,
                color: signalColors.ink,
              }}
            />
            <View style={{ flexDirection: "row", gap: 8, marginTop: signalSpacing.md }}>
              <Pressable
                onPress={() => setOpen(false)}
                style={{ flex: 1, height: 48, alignItems: "center", justifyContent: "center" }}
              >
                <Text style={{ color: signalColors.inkMuted, fontWeight: "700" }}>Cancel</Text>
              </Pressable>
              <Pressable
                disabled={submit.isPending}
                onPress={() => submit.mutate()}
                style={{
                  flex: 1.5,
                  height: 48,
                  borderRadius: signalRadius.md,
                  backgroundColor: signalColors.teal,
                  alignItems: "center",
                  justifyContent: "center",
                }}
              >
                <Text style={{ color: signalColors.surface, fontWeight: "800" }}>
                  {submit.isPending ? "Encrypting…" : "Submit securely"}
                </Text>
              </Pressable>
            </View>
          </View>
        </View>
      </Modal>
    </ActionFrame>
  );
}

function ConnectionActionCard({ action }: { action: ActionRequest }) {
  const queryClient = useQueryClient();
  const provider =
    typeof action.materialPayload["provider"] === "string"
      ? action.materialPayload["provider"]
      : "google";
  const toolkit =
    typeof action.materialPayload["toolkit"] === "string"
      ? action.materialPayload["toolkit"]
      : provider;
  const scopes = Array.isArray(action.materialPayload["scopes"])
    ? action.materialPayload["scopes"].filter((scope): scope is string => typeof scope === "string")
    : ["openid", "profile", "email"];
  const connections = useQuery({
    queryKey: ["connections"],
    queryFn: signalApi.listConnections,
    refetchInterval: 2_000,
  });
  const connected = (connections.data?.items ?? []).some(
    (connection) =>
      connection.provider === provider &&
      connection.toolkit === toolkit &&
      connection.status === "ACTIVE" &&
      scopes.every((scope) => connection.scopes.includes(scope)),
  );
  const automaticResumeAttempted = useRef(false);
  const resume = useMutation({
    mutationFn: () =>
      signalApi.respondToAction(action, {
        response: "SUBMIT",
        materialDigest: action.materialDigest,
      }),
    onSuccess: async () => {
      await invalidateAction(queryClient, action);
    },
    onError: (error: Error) => Alert.alert("Task not resumed", error.message),
  });
  const connect = useMutation({
    mutationFn: () =>
      signalApi.linkConnection({
        provider,
        toolkit,
        requestedScopes: scopes,
        originatingTaskId: action.taskId,
        returnDeepLink: `signal://tasks/${action.taskId}/actions/${action.id}`,
      }),
    onSuccess: ({ alreadyConnected, redirectUrl }) => {
      if (alreadyConnected === true) {
        automaticResumeAttempted.current = true;
        resume.mutate();
        return;
      }
      void Linking.openURL(redirectUrl);
    },
    onError: (error: Error) => Alert.alert("Connection not started", error.message),
  });
  useEffect(() => {
    if (!connected || resume.isPending || automaticResumeAttempted.current) return;
    automaticResumeAttempted.current = true;
    resume.mutate();
  }, [connected, resume]);
  return (
    <ActionFrame action={action}>
      <Text style={{ color: "#829A94", fontSize: 12, marginTop: signalSpacing.md }}>
        Provider: {provider} · Requested scopes: {scopes.join(", ")}
      </Text>
      <Pressable
        disabled={connect.isPending || resume.isPending}
        onPress={() => (connected ? resume.mutate() : connect.mutate())}
        style={{
          height: 48,
          borderRadius: signalRadius.md,
          marginTop: signalSpacing.lg,
          backgroundColor: signalColors.lime,
          flexDirection: "row",
          alignItems: "center",
          justifyContent: "center",
          gap: 8,
        }}
      >
        <Link2 color={signalColors.ink} size={18} />
        <Text style={{ color: signalColors.ink, fontWeight: "800" }}>
          {resume.isPending
            ? "Resuming…"
            : connected
              ? "Continue task"
              : connect.isPending
                ? "Opening…"
                : `Connect ${provider}`}
        </Text>
      </Pressable>
    </ActionFrame>
  );
}

function ChoiceActionCard({ action }: { action: ActionRequest }) {
  const queryClient = useQueryClient();
  const auth = useAuth();
  const respond = useMutation({
    mutationFn: async (selectedOptionId: string) => {
      if (action.requiresRecentAuth) await auth.reauthenticate();
      return signalApi.respondToAction(action, {
        response: "SUBMIT",
        materialDigest: action.materialDigest,
        selectedOptionId,
      });
    },
    onSuccess: () => invalidateAction(queryClient, action),
    onError: (error: Error) => Alert.alert("Choice not recorded", error.message),
  });
  return (
    <ActionFrame action={action}>
      <View style={{ gap: 8, marginTop: signalSpacing.lg }}>
        {action.options.map((option) => (
          <Pressable
            key={option.id}
            onPress={() => respond.mutate(option.id)}
            style={{
              padding: signalSpacing.md,
              borderRadius: signalRadius.md,
              borderWidth: 1,
              borderColor: option.destructive ? "#A64B45" : "#45615C",
            }}
          >
            <Text style={{ color: signalColors.surface, fontWeight: "800" }}>{option.label}</Text>
            <Text style={{ color: "#9CB2AC", fontSize: 12, marginTop: 3 }}>
              {option.description}
            </Text>
          </Pressable>
        ))}
      </View>
    </ActionFrame>
  );
}

function TakeoverActionCard({ action }: { action: ActionRequest }) {
  const queryClient = useQueryClient();
  const auth = useAuth();
  const sessionId = action.materialPayload["sessionId"];
  const session = useQuery({
    queryKey: ["browser-session", sessionId],
    queryFn: () => signalApi.getBrowserSession(String(sessionId)),
    enabled: typeof sessionId === "string",
    refetchInterval: 1_500,
  });
  const events = useQuery({
    queryKey: ["browser-events", sessionId],
    queryFn: () => signalApi.getBrowserEvents(String(sessionId)),
    enabled: typeof sessionId === "string",
    refetchInterval: 1_500,
  });
  const evidence = session.data?.latestEvidence;
  const screenshot = useQuery({
    queryKey: ["browser-screenshot", sessionId, evidence?.id],
    queryFn: () => signalApi.getBrowserScreenshotSource(String(sessionId), String(evidence?.id)),
    enabled: typeof sessionId === "string" && evidence !== null && evidence !== undefined,
  });
  const respond = useMutation({
    mutationFn: async (response: "APPROVE" | "REJECT") => {
      if (response === "APPROVE" && action.requiresRecentAuth) await auth.reauthenticate();
      return signalApi.respondToAction(action, {
        response,
        materialDigest: action.materialDigest,
      });
    },
    onSuccess: () => invalidateAction(queryClient, action),
    onError: (error: Error) => Alert.alert("Browser response failed", error.message),
  });
  return (
    <ActionFrame action={action}>
      <Text style={{ color: "#9CB2AC", marginTop: signalSpacing.md }}>
        {session.data === undefined
          ? "Loading protected session…"
          : `${session.data.status.replaceAll("_", " ")} · ${session.data.completedSteps} step(s) observed`}
      </Text>
      <Text style={{ color: "#78918A", fontSize: 12, marginTop: 5 }}>
        {events.data?.items.length ?? 0} durable observation event(s)
      </Text>
      {evidence !== null && evidence !== undefined ? (
        <View style={{ marginTop: signalSpacing.md, gap: 7 }}>
          {screenshot.data === undefined ? null : (
            <Image
              accessibilityLabel="Current protected browser state"
              resizeMode="contain"
              source={screenshot.data}
              style={{
                width: "100%",
                height: 210,
                borderRadius: signalRadius.md,
                backgroundColor: "#0A1715",
              }}
            />
          )}
          <Text selectable style={{ color: signalColors.surface, fontSize: 12, fontWeight: "700" }}>
            {evidence.url}
          </Text>
          <Text style={{ color: "#9CB2AC", fontSize: 12, lineHeight: 17 }} numberOfLines={4}>
            {evidence.postActionSummary}
          </Text>
          <Text style={{ color: "#78918A", fontSize: 11 }}>
            Captured {new Date(evidence.capturedAt).toLocaleString()}
          </Text>
        </View>
      ) : null}
      <Pressable
        disabled={respond.isPending || typeof sessionId !== "string"}
        onPress={() => respond.mutate("APPROVE")}
        style={{
          height: 48,
          marginTop: signalSpacing.lg,
          borderRadius: signalRadius.md,
          backgroundColor: signalColors.lime,
          flexDirection: "row",
          alignItems: "center",
          justifyContent: "center",
          gap: 8,
        }}
      >
        <ExternalLink color={signalColors.ink} size={18} />
        <Text style={{ color: signalColors.ink, fontWeight: "800" }}>
          Resume from reviewed state
        </Text>
      </Pressable>
      <Pressable
        onPress={() => respond.mutate("REJECT")}
        style={{ alignSelf: "center", marginTop: 14 }}
      >
        <Text style={{ color: "#E59A91", fontWeight: "700" }}>Stop this browser session</Text>
      </Pressable>
    </ActionFrame>
  );
}

export function ActionCard({ action }: { action: ActionRequest }) {
  if (action.type === "SECURE_INPUT") return <SecureInputCard action={action} />;
  if (action.type === "CONNECTION_REQUIRED") return <ConnectionActionCard action={action} />;
  if (action.type === "CHOICE" || action.type === "MISSING_INFORMATION") {
    return <ChoiceActionCard action={action} />;
  }
  if (action.type === "BROWSER_TAKEOVER" || action.type === "MFA_OR_CAPTCHA") {
    return <TakeoverActionCard action={action} />;
  }
  return <ApprovalActionCard action={action} />;
}

function ApprovalActionCard({ action }: { action: ActionRequest }) {
  const queryClient = useQueryClient();
  const auth = useAuth();
  const candidateId = action.materialPayload["candidateId"];
  const [showGeneratedReview, setShowGeneratedReview] = useState(false);
  const generated = useQuery({
    queryKey: ["generated-capability", candidateId],
    queryFn: () => signalApi.getGeneratedCapability(String(candidateId)),
    enabled: typeof candidateId === "string",
  });
  const respond = useMutation({
    mutationFn: async (response: ActionResponseInput["response"]) => {
      await Haptics.notificationAsync(
        response === "APPROVE"
          ? Haptics.NotificationFeedbackType.Success
          : Haptics.NotificationFeedbackType.Warning,
      );
      if ((response === "APPROVE" || response === "SUBMIT") && action.requiresRecentAuth) {
        await auth.reauthenticate();
      }
      return signalApi.respondToAction(action, {
        response,
        materialDigest: action.materialDigest,
      });
    },
    onSuccess: async () => invalidateAction(queryClient, action),
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
      {typeof candidateId === "string" ? (
        <View style={{ marginTop: signalSpacing.md }}>
          <Pressable
            onPress={() => setShowGeneratedReview((visible) => !visible)}
            style={{
              borderWidth: 1,
              borderColor: "#45615C",
              borderRadius: signalRadius.sm,
              padding: 10,
            }}
          >
            <Text style={{ color: signalColors.lime, fontWeight: "800", textAlign: "center" }}>
              {showGeneratedReview
                ? "Hide code and gate report"
                : "Inspect code diff and gate report"}
            </Text>
          </Pressable>
          {showGeneratedReview ? (
            <View
              style={{
                backgroundColor: "#06161A",
                borderRadius: signalRadius.sm,
                padding: 10,
                marginTop: 8,
                maxHeight: 360,
              }}
            >
              <Text style={{ color: "#9CB2AC", fontSize: 11, fontWeight: "800" }}>
                OFFICIAL SOURCES
              </Text>
              {(generated.data?.sources ?? []).map((source) => (
                <Text
                  key={source.url}
                  selectable
                  style={{ color: "#BDD0CA", fontSize: 10, marginTop: 4 }}
                >
                  {source.url}
                  {"\n"}
                  {source.contentHash}
                </Text>
              ))}
              <Text style={{ color: "#9CB2AC", fontSize: 11, fontWeight: "800", marginTop: 10 }}>
                GATES
              </Text>
              {(generated.data?.stages ?? []).map((stage) => (
                <Text
                  key={stage.stage}
                  style={{
                    color: stage.result?.passed ? signalColors.lime : "#E59A91",
                    fontSize: 10,
                    marginTop: 3,
                  }}
                >
                  {stage.result?.passed ? "✓" : "×"} {stage.stage} — {stage.result?.summary}
                </Text>
              ))}
              <Text style={{ color: "#9CB2AC", fontSize: 11, fontWeight: "800", marginTop: 10 }}>
                GENERATED FILES
              </Text>
              {(generated.data?.files ?? []).map((file) => (
                <View key={file.path} style={{ marginTop: 7 }}>
                  <Text style={{ color: signalColors.lime, fontSize: 10, fontWeight: "800" }}>
                    + {file.path}
                  </Text>
                  <Text
                    selectable
                    style={{
                      color: "#BDD0CA",
                      fontFamily: "monospace",
                      fontSize: 9,
                      lineHeight: 13,
                    }}
                  >
                    {file.content.slice(0, 4_000)}
                  </Text>
                </View>
              ))}
            </View>
          ) : null}
        </View>
      ) : null}
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
