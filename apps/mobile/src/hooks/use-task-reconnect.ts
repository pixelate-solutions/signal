import AsyncStorage from "@react-native-async-storage/async-storage";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import { AppState } from "react-native";
import EventSource from "react-native-sse";

import { taskEventTypeSchema, type TaskEvent } from "@signal/contracts";

import { signalApi, signalApiBaseUrl } from "../api/client";
import { getValidAccessToken } from "../auth/token-store";
import { useSignalStore } from "../state/use-signal-store";
import type { TaskDetail } from "../types";

const sequenceKey = (taskId: string): string => `signal.task.${taskId}.sequence`;

function mergeEvents(current: TaskEvent[], incoming: TaskEvent[]): TaskEvent[] {
  const bySequence = new Map(current.map((event) => [event.sequence, event]));
  for (const event of incoming) bySequence.set(event.sequence, event);
  return [...bySequence.values()].sort((left, right) => left.sequence - right.sequence);
}

export function useTaskReconnect(taskId: string | null) {
  const queryClient = useQueryClient();
  const [missedCount, setMissedCount] = useState(0);
  const lastSequence = useRef(0);
  const detail = useQuery({
    queryKey: ["task", taskId],
    enabled: taskId !== null,
    queryFn: async () => {
      const snapshot = await signalApi.getTask(taskId ?? "");
      const stored = Number.parseInt(
        (await AsyncStorage.getItem(sequenceKey(taskId ?? ""))) ?? "0",
        10,
      );
      const newest = snapshot.recentEvents.at(-1)?.sequence ?? snapshot.task.lastSequence;
      if (stored > 0 && newest > stored) setMissedCount(newest - stored);
      lastSequence.current = newest;
      await AsyncStorage.setItem(sequenceKey(taskId ?? ""), String(newest));
      return snapshot;
    },
    refetchInterval: 15_000,
  });

  useEffect(() => {
    if (taskId === null) return undefined;
    let closed = false;
    let stream: EventSource<TaskEvent["type"]> | undefined;

    const applyEvents = (events: TaskEvent[]) => {
      if (events.length === 0) return;
      const newest = events.at(-1)?.sequence ?? lastSequence.current;
      lastSequence.current = Math.max(lastSequence.current, newest);
      void AsyncStorage.setItem(sequenceKey(taskId), String(lastSequence.current));
      queryClient.setQueryData<TaskDetail>(["task", taskId], (current) =>
        current === undefined
          ? current
          : {
              ...current,
              task: { ...current.task, lastSequence: lastSequence.current },
              recentEvents: mergeEvents(current.recentEvents, events),
            },
      );
      void queryClient.invalidateQueries({ queryKey: ["task", taskId] });
      void queryClient.invalidateQueries({ queryKey: ["actions"] });
    };

    const poll = async () => {
      try {
        const delta = await signalApi.getEvents(taskId, lastSequence.current);
        if (!closed) applyEvents(delta.items);
      } catch {
        // The query error surface reports connection status; polling remains best-effort.
      }
    };

    const connect = async () => {
      const [accessToken, tenantId] = await Promise.all([
        getValidAccessToken(),
        Promise.resolve(useSignalStore.getState().activeTenantId),
      ]);
      if (closed) return;
      stream = new EventSource<TaskEvent["type"]>(
        `${signalApiBaseUrl}/v1/tasks/${encodeURIComponent(taskId)}/stream?after=${String(lastSequence.current)}`,
        {
          headers: {
            accept: "text/event-stream",
            ...(accessToken === null ? {} : { authorization: `Bearer ${accessToken}` }),
            ...(tenantId === null ? {} : { "x-signal-tenant-id": tenantId }),
          },
        },
      );
      const receive = (message: { data: string | null }) => {
        try {
          applyEvents([JSON.parse(String(message.data)) as TaskEvent]);
        } catch {
          // Ignore malformed public events and recover from the authoritative delta endpoint.
        }
      };
      stream.addEventListener("message", receive);
      for (const eventType of taskEventTypeSchema.options) {
        stream.addEventListener(eventType, receive);
      }
      stream.addEventListener("error", () => void poll());
    };
    void connect().catch(() => {
      // Some platform runtimes do not expose streaming fetch; polling is the fallback.
    });
    const pollTimer = setInterval(() => void poll(), 3_000);
    const appState = AppState.addEventListener("change", (state) => {
      if (state === "active") void poll();
    });
    return () => {
      closed = true;
      stream?.close();
      clearInterval(pollTimer);
      appState.remove();
    };
  }, [queryClient, taskId]);

  return { ...detail, missedCount, dismissMissed: () => setMissedCount(0) };
}
