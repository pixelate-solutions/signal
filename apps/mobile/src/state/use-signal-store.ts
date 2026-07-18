import AsyncStorage from "@react-native-async-storage/async-storage";
import { create } from "zustand";

const ACTIVE_CONVERSATION_KEY = "signal.active-conversation";
const ACTIVE_TASK_KEY = "signal.active-task";

type SignalUiState = {
  hydrated: boolean;
  activeConversationId: string | null;
  activeTaskId: string | null;
  historyOpen: boolean;
  setActiveConversation(id: string | null): void;
  setActiveTask(id: string | null): void;
  setHistoryOpen(open: boolean): void;
  hydrate(): Promise<void>;
};

export const useSignalStore = create<SignalUiState>((set) => ({
  hydrated: false,
  activeConversationId: null,
  activeTaskId: null,
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
  setHistoryOpen: (open) => set({ historyOpen: open }),
  hydrate: async () => {
    const [activeConversationId, activeTaskId] = await Promise.all([
      AsyncStorage.getItem(ACTIVE_CONVERSATION_KEY),
      AsyncStorage.getItem(ACTIVE_TASK_KEY),
    ]);
    set({ hydrated: true, activeConversationId, activeTaskId });
  },
}));
