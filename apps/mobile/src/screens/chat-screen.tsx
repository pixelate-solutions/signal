import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { randomUUID } from "expo-crypto";
import { LinearGradient } from "expo-linear-gradient";
import {
  Archive,
  ChevronRight,
  Menu,
  Plus,
  Radio,
  RefreshCw,
  Search,
  ShieldAlert,
  X,
} from "lucide-react-native";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Modal,
  Pressable,
  RefreshControl,
  ScrollView,
  Text,
  TextInput,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import type { Conversation } from "@signal/contracts";
import { signalColors, signalRadius, signalSpacing } from "@signal/ui";

import { signalApi } from "../api/client";
import { uploadAttachment, type LocalAttachment } from "../api/upload";
import { ActionCard } from "../components/action-card";
import { ArtifactCard } from "../components/artifact-card";
import { BrandMark } from "../components/brand-mark";
import { Composer } from "../components/composer";
import { TaskEventCard } from "../components/event-card";
import { TaskHeader } from "../components/task-header";
import { ReceiptCard } from "../components/receipt-card";
import { useTaskReconnect } from "../hooks/use-task-reconnect";
import { useSignalStore } from "../state/use-signal-store";

function HistorySheet({ conversations }: { conversations: Conversation[] }) {
  const insets = useSafeAreaInsets();
  const open = useSignalStore((state) => state.historyOpen);
  const activeId = useSignalStore((state) => state.activeConversationId);
  const setOpen = useSignalStore((state) => state.setHistoryOpen);
  const setConversation = useSignalStore((state) => state.setActiveConversation);
  const setTask = useSignalStore((state) => state.setActiveTask);
  const [search, setSearch] = useState("");
  const matchingTasks = useQuery({
    queryKey: ["task-search", search],
    queryFn: () => signalApi.searchTasks(search),
    enabled: search.trim().length > 0,
  });
  const matchingConversationIds = new Set(
    (matchingTasks.data?.items ?? []).map((task) => task.conversationId),
  );
  const filteredConversations =
    search.trim().length === 0
      ? conversations
      : conversations.filter(
          (conversation) =>
            conversation.title.toLocaleLowerCase().includes(search.trim().toLocaleLowerCase()) ||
            matchingConversationIds.has(conversation.id),
        );
  return (
    <Modal visible={open} animationType="slide" transparent onRequestClose={() => setOpen(false)}>
      <Pressable
        accessibilityLabel="Close conversation history"
        onPress={() => setOpen(false)}
        style={{ flex: 1, backgroundColor: "#071A2075", justifyContent: "flex-end" }}
      >
        <Pressable
          onPress={(event) => event.stopPropagation()}
          style={{
            backgroundColor: signalColors.canvas,
            borderTopLeftRadius: 28,
            borderTopRightRadius: 28,
            maxHeight: "78%",
            paddingBottom: Math.max(insets.bottom, signalSpacing.lg),
          }}
        >
          <View
            style={{
              flexDirection: "row",
              alignItems: "center",
              paddingHorizontal: signalSpacing.xl,
              paddingTop: signalSpacing.lg,
              paddingBottom: signalSpacing.md,
            }}
          >
            <View style={{ flex: 1 }}>
              <Text style={{ color: signalColors.ink, fontSize: 22, fontWeight: "800" }}>
                Conversations
              </Text>
              <Text style={{ color: signalColors.inkMuted, marginTop: 3 }}>
                Durable history from the server
              </Text>
            </View>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Close"
              onPress={() => setOpen(false)}
              style={{ width: 40, height: 40, alignItems: "center", justifyContent: "center" }}
            >
              <X color={signalColors.ink} />
            </Pressable>
          </View>
          <View
            style={{
              marginHorizontal: signalSpacing.lg,
              marginBottom: signalSpacing.sm,
              height: 44,
              borderRadius: signalRadius.md,
              borderWidth: 1,
              borderColor: signalColors.line,
              backgroundColor: signalColors.surface,
              flexDirection: "row",
              alignItems: "center",
              paddingHorizontal: signalSpacing.md,
              gap: 8,
            }}
          >
            <Search color={signalColors.inkMuted} size={17} />
            <TextInput
              value={search}
              onChangeText={setSearch}
              placeholder="Search tasks and conversations"
              placeholderTextColor={signalColors.inkMuted}
              style={{ flex: 1, color: signalColors.ink }}
            />
          </View>
          <ScrollView contentContainerStyle={{ padding: signalSpacing.lg, gap: signalSpacing.sm }}>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Start a new conversation"
              onPress={() => {
                setConversation(null);
                setTask(null);
                setOpen(false);
              }}
              style={{
                flexDirection: "row",
                alignItems: "center",
                gap: signalSpacing.md,
                backgroundColor: signalColors.ink,
                borderRadius: signalRadius.md,
                padding: signalSpacing.lg,
              }}
            >
              <Plus color={signalColors.lime} size={20} />
              <Text style={{ color: signalColors.surface, fontWeight: "700", flex: 1 }}>
                New objective
              </Text>
              <ChevronRight color="#8FA6A0" size={18} />
            </Pressable>
            {filteredConversations.map((conversation) => (
              <Pressable
                key={conversation.id}
                accessibilityRole="button"
                accessibilityState={{ selected: activeId === conversation.id }}
                onPress={() => {
                  setConversation(conversation.id);
                  setTask(null);
                  setOpen(false);
                }}
                style={({ pressed }) => ({
                  flexDirection: "row",
                  alignItems: "center",
                  gap: signalSpacing.md,
                  backgroundColor:
                    activeId === conversation.id
                      ? signalColors.tealSoft
                      : pressed
                        ? signalColors.surfaceRaised
                        : signalColors.surface,
                  borderWidth: 1,
                  borderColor: activeId === conversation.id ? "#9ED1C4" : signalColors.line,
                  borderRadius: signalRadius.md,
                  padding: signalSpacing.lg,
                })}
              >
                <Archive
                  color={activeId === conversation.id ? signalColors.teal : signalColors.inkMuted}
                  size={19}
                />
                <View style={{ flex: 1 }}>
                  <Text numberOfLines={1} style={{ color: signalColors.ink, fontWeight: "700" }}>
                    {conversation.title}
                  </Text>
                  <Text style={{ color: signalColors.inkMuted, fontSize: 12, marginTop: 3 }}>
                    {new Date(conversation.updatedAt).toLocaleDateString()}
                  </Text>
                </View>
                <ChevronRight color={signalColors.inkMuted} size={17} />
              </Pressable>
            ))}
          </ScrollView>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

function EmptyState() {
  return (
    <View style={{ alignItems: "center", paddingTop: 48, paddingHorizontal: signalSpacing.lg }}>
      <LinearGradient
        colors={[signalColors.ink, "#123F3C"]}
        style={{
          width: 104,
          height: 104,
          borderRadius: 52,
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        <Radio color={signalColors.lime} size={42} strokeWidth={1.7} />
      </LinearGradient>
      <Text
        style={{
          color: signalColors.ink,
          fontSize: 28,
          lineHeight: 34,
          fontWeight: "800",
          textAlign: "center",
          marginTop: signalSpacing.xl,
        }}
      >
        Name the outcome.{"\n"}Signal keeps working.
      </Text>
      <Text
        style={{
          color: signalColors.inkMuted,
          fontSize: 15,
          lineHeight: 22,
          textAlign: "center",
          marginTop: signalSpacing.md,
          maxWidth: 340,
        }}
      >
        Start a durable task, leave the app, and return to an exact record of what happened and what
        still needs you.
      </Text>
      <View
        style={{
          marginTop: signalSpacing.xl,
          flexDirection: "row",
          gap: signalSpacing.sm,
          flexWrap: "wrap",
          justifyContent: "center",
        }}
      >
        {["Approval before action", "Independent verification", "Evidence retained"].map(
          (label) => (
            <View
              key={label}
              style={{
                backgroundColor: signalColors.surface,
                borderWidth: 1,
                borderColor: signalColors.line,
                borderRadius: signalRadius.pill,
                paddingHorizontal: 11,
                paddingVertical: 7,
              }}
            >
              <Text style={{ color: signalColors.inkMuted, fontSize: 11, fontWeight: "600" }}>
                {label}
              </Text>
            </View>
          ),
        )}
      </View>
    </View>
  );
}

export function ChatScreen() {
  const insets = useSafeAreaInsets();
  const queryClient = useQueryClient();
  const scroll = useRef<ScrollView>(null);
  const hydrated = useSignalStore((state) => state.hydrated);
  const activeConversationId = useSignalStore((state) => state.activeConversationId);
  const activeTaskId = useSignalStore((state) => state.activeTaskId);
  const setConversation = useSignalStore((state) => state.setActiveConversation);
  const setTask = useSignalStore((state) => state.setActiveTask);
  const setHistoryOpen = useSignalStore((state) => state.setHistoryOpen);

  const conversations = useQuery({
    queryKey: ["conversations"],
    queryFn: signalApi.listConversations,
  });
  const conversation = useQuery({
    queryKey: ["conversation", activeConversationId],
    enabled: activeConversationId !== null,
    queryFn: () => signalApi.getConversation(activeConversationId ?? ""),
  });
  const task = useTaskReconnect(activeTaskId);

  useEffect(() => {
    if (hydrated && activeConversationId === null && (conversations.data?.items.length ?? 0) > 0) {
      setConversation(conversations.data?.items[0]?.id ?? null);
    }
  }, [activeConversationId, conversations.data?.items, hydrated, setConversation]);

  useEffect(() => {
    if (activeTaskId !== null || conversation.data === undefined) return;
    setTask(conversation.data.tasks.at(-1)?.id ?? null);
  }, [activeTaskId, conversation.data, setTask]);

  const currentTask = task.data?.task;
  const visibleEvents = useMemo(
    () => (task.data?.recentEvents ?? []).filter((event) => event.visibility === "user"),
    [task.data?.recentEvents],
  );
  const pendingActions = task.data?.pendingActions ?? conversation.data?.pendingActions ?? [];
  const artifactIds = useMemo(
    () => [
      ...new Set(
        (conversation.data?.messages ?? []).flatMap((message) =>
          message.content.flatMap((block) => (block.type === "artifact" ? [block.artifactId] : [])),
        ),
      ),
    ],
    [conversation.data?.messages],
  );

  useEffect(() => {
    if (pendingActions.length > 0) {
      const timer = setTimeout(() => scroll.current?.scrollTo({ y: 0, animated: true }), 120);
      return () => clearTimeout(timer);
    }
    if (visibleEvents.length > 0) {
      const timer = setTimeout(() => scroll.current?.scrollToEnd({ animated: true }), 120);
      return () => clearTimeout(timer);
    }
    return undefined;
  }, [pendingActions.length, visibleEvents.length]);

  const send = useMutation({
    mutationFn: async ({ text, attachments }: { text: string; attachments: LocalAttachment[] }) => {
      const activeConversation =
        activeConversationId === null
          ? await signalApi.createConversation(text.slice(0, 72))
          : { id: activeConversationId };
      const uploaded = await Promise.all(attachments.map(uploadAttachment));
      const result = await signalApi.sendMessage(
        activeConversation.id,
        text,
        uploaded.map((artifact) => artifact.id),
        randomUUID(),
      );
      return { conversationId: activeConversation.id, taskId: result.task.id };
    },
    onSuccess: async ({ conversationId, taskId }) => {
      setConversation(conversationId);
      setTask(taskId);
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["conversations"] }),
        queryClient.invalidateQueries({ queryKey: ["conversation", conversationId] }),
        queryClient.invalidateQueries({ queryKey: ["task", taskId] }),
      ]);
    },
    onError: (error: Error) => Alert.alert("Task not started", error.message),
  });

  const refresh = async () => {
    await Promise.all([conversations.refetch(), conversation.refetch(), task.refetch()]);
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
          <Text
            style={{
              color: signalColors.ink,
              fontWeight: "800",
              fontSize: 18,
              letterSpacing: -0.4,
            }}
          >
            SIGNAL
          </Text>
          <Text style={{ color: signalColors.inkMuted, fontSize: 11, marginTop: 1 }}>
            {currentTask === undefined
              ? "Persistent operator"
              : `Task · ${currentTask.state.toLowerCase()}`}
          </Text>
        </View>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Open conversation history"
          onPress={() => setHistoryOpen(true)}
          style={({ pressed }) => ({
            width: 42,
            height: 42,
            borderRadius: 21,
            alignItems: "center",
            justifyContent: "center",
            backgroundColor: pressed ? signalColors.tealSoft : signalColors.surface,
            borderWidth: 1,
            borderColor: signalColors.line,
          })}
        >
          <Menu color={signalColors.ink} size={20} />
        </Pressable>
      </View>

      <ScrollView
        ref={scroll}
        style={{ flex: 1 }}
        contentContainerStyle={{ padding: signalSpacing.lg, paddingBottom: signalSpacing.xxl }}
        keyboardShouldPersistTaps="handled"
        refreshControl={
          <RefreshControl
            refreshing={task.isRefetching}
            onRefresh={() => void refresh()}
            tintColor={signalColors.teal}
          />
        }
      >
        {task.missedCount > 0 && (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={`Dismiss summary of ${task.missedCount} events while away`}
            onPress={task.dismissMissed}
            style={{
              flexDirection: "row",
              alignItems: "center",
              gap: signalSpacing.sm,
              backgroundColor: signalColors.blueSoft,
              borderRadius: signalRadius.md,
              padding: signalSpacing.md,
              marginBottom: signalSpacing.lg,
            }}
          >
            <RefreshCw color={signalColors.blue} size={17} />
            <Text style={{ color: signalColors.blue, flex: 1, fontSize: 13, fontWeight: "600" }}>
              {task.missedCount} event{task.missedCount === 1 ? "" : "s"} happened while you were
              away.
            </Text>
            <X color={signalColors.blue} size={15} />
          </Pressable>
        )}
        {currentTask === undefined && task.isLoading ? (
          <ActivityIndicator color={signalColors.teal} style={{ marginTop: 80 }} />
        ) : currentTask === undefined ? (
          <EmptyState />
        ) : (
          <>
            <TaskHeader task={currentTask} />
            {pendingActions.map((action) => (
              <ActionCard key={action.id} action={action} />
            ))}
            {artifactIds.length > 0 && (
              <View style={{ marginBottom: signalSpacing.lg }}>
                <Text style={{ color: signalColors.ink, fontWeight: "800", marginBottom: 8 }}>
                  Task files
                </Text>
                {artifactIds.map((artifactId) => (
                  <ArtifactCard key={artifactId} artifactId={artifactId} />
                ))}
              </View>
            )}
            <View
              style={{ flexDirection: "row", alignItems: "center", marginBottom: signalSpacing.lg }}
            >
              <Text style={{ color: signalColors.ink, fontSize: 14, fontWeight: "800", flex: 1 }}>
                Execution record
              </Text>
              <View style={{ flexDirection: "row", alignItems: "center", gap: 5 }}>
                <View
                  style={{
                    width: 7,
                    height: 7,
                    borderRadius: 4,
                    backgroundColor: signalColors.teal,
                  }}
                />
                <Text style={{ color: signalColors.inkMuted, fontSize: 11 }}>Live · ordered</Text>
              </View>
            </View>
            {visibleEvents.map((event, index) => (
              <TaskEventCard
                key={event.eventId}
                event={event}
                last={index === visibleEvents.length - 1}
              />
            ))}
            <ReceiptCard task={currentTask} events={visibleEvents} />
            {task.isError && (
              <View
                style={{
                  flexDirection: "row",
                  gap: signalSpacing.sm,
                  backgroundColor: signalColors.redSoft,
                  borderRadius: signalRadius.md,
                  padding: signalSpacing.md,
                  marginTop: signalSpacing.lg,
                }}
              >
                <ShieldAlert color={signalColors.red} size={18} />
                <Text style={{ color: signalColors.red, flex: 1 }}>
                  Live state is temporarily unavailable. Signal will reconcile from the server when
                  the connection returns.
                </Text>
              </View>
            )}
          </>
        )}
      </ScrollView>

      <View
        style={{
          paddingHorizontal: signalSpacing.lg,
          paddingTop: signalSpacing.sm,
          paddingBottom: Math.max(insets.bottom, signalSpacing.md),
          backgroundColor: signalColors.canvas,
        }}
      >
        <Composer
          sending={send.isPending}
          onSend={(text, attachments) =>
            send.mutateAsync({ text, attachments }).then(() => undefined)
          }
        />
      </View>
      <HistorySheet conversations={conversations.data?.items ?? []} />
    </View>
  );
}
