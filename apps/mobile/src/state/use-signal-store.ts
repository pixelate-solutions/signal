import AsyncStorage from "@react-native-async-storage/async-storage";
import { create } from "zustand";

const ACTIVE_CONVERSATION_KEY = "signal.active-conversation";
const ACTIVE_TASK_KEY = "signal.active-task";
const ACTIVE_TENANT_KEY = "signal.active-tenant";

type SignalUiState = {
  hydrated: boolean;
  activeConversationId: string | null;
  activeTaskId: string | null;
  activeTenantId: string | null;
  pendingActionId: string | null;
  historyOpen: boolean;
  setActiveConversation(id: string | null): void;
  setActiveTask(id: string | null): void;
  setActiveTenant(id: string | null): void;
  routeToTask(taskId: string, actionId: string | null): void;
  clearPendingAction(): void;
  setHistoryOpen(open: boolean): void;
  hydrate(): Promise<void>;
};

export const useSignalStore = create<SignalUiState>((set) => ({
  hydrated: false,
  activeConversationId: null,
  activeTaskId: null,
  activeTenantId: null,
  pendingActionId: null,
  historyOpen: false,
  setActiveConversation: (id) => {
    set({ activeConversationId: id });
    void (id === null
      ? AsyncStorage.removeItem(ACTIVE_CONVERSATION_KEY)
      : AsyncStorage.setItem(ACTIVE_CONVERSATION_KEY, id));
  },
  setActiveTask: (id) => {
    set({ activeTaskId: id });
    void (id === null
      ? AsyncStorage.removeItem(ACTIVE_TASK_KEY)
      : AsyncStorage.setItem(ACTIVE_TASK_KEY, id));
  },
  setActiveTenant: (id) => {
    set({ activeTenantId: id, activeConversationId: null, activeTaskId: null });
    void Promise.all([
      id === null
        ? AsyncStorage.removeItem(ACTIVE_TENANT_KEY)
        : AsyncStorage.setItem(ACTIVE_TENANT_KEY, id),
      AsyncStorage.removeItem(ACTIVE_CONVERSATION_KEY),
      AsyncStorage.removeItem(ACTIVE_TASK_KEY),
    ]);
  },
  routeToTask: (taskId, actionId) => {
    set({ activeTaskId: taskId, pendingActionId: actionId, historyOpen: false });
    void AsyncStorage.setItem(ACTIVE_TASK_KEY, taskId);
  },
  clearPendingAction: () => set({ pendingActionId: null }),
  setHistoryOpen: (open) => set({ historyOpen: open }),
  hydrate: async () => {
    const [activeConversationId, activeTaskId, activeTenantId] = await Promise.all([
      AsyncStorage.getItem(ACTIVE_CONVERSATION_KEY),
      AsyncStorage.getItem(ACTIVE_TASK_KEY),
      AsyncStorage.getItem(ACTIVE_TENANT_KEY),
    ]);
    set({ hydrated: true, activeConversationId, activeTaskId, activeTenantId });
  },
}));
