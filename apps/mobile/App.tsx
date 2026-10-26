import "react-native-gesture-handler";
import "./src/notifications/background";

import { createBottomTabNavigator } from "@react-navigation/bottom-tabs";
import { DefaultTheme, NavigationContainer } from "@react-navigation/native";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import * as Notifications from "expo-notifications";
import { MessageCircle, SlidersHorizontal } from "lucide-react-native";
import { useEffect } from "react";
import { AppState, Platform, StatusBar, Text } from "react-native";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import { SafeAreaProvider } from "react-native-safe-area-context";

import { signalColors } from "@signal/ui";

import { AuthProvider, useAuth } from "./src/auth/auth-provider";
import { BiometricLockGate } from "./src/auth/biometric-lock";
import { ChatScreen } from "./src/screens/chat-screen";
import { ensureDeviceRegistered } from "./src/device/registration";
import { runPendingDeviceCommands } from "./src/device/runner";
import { AuthScreen } from "./src/screens/auth-screen";
import { NotificationRouter } from "./src/notifications/router";
import { SettingsScreen } from "./src/screens/settings-screen";
import { useSignalStore } from "./src/state/use-signal-store";

type RootTabs = {
  Chat: undefined;
  Settings: undefined;
};

const Tabs = createBottomTabNavigator<RootTabs>();
const queryClient = new QueryClient({
  defaultOptions: {
    queries: { retry: 2, staleTime: 2_000, networkMode: "offlineFirst" },
    mutations: { networkMode: "online" },
  },
});

function SignalTabs() {
  return (
    <Tabs.Navigator
      screenOptions={({ route }) => ({
        headerShown: false,
        tabBarActiveTintColor: signalColors.teal,
        tabBarInactiveTintColor: "#748680",
        tabBarStyle: {
          height: Platform.OS === "ios" ? 84 : 66,
          paddingTop: 7,
          borderTopColor: signalColors.line,
          backgroundColor: signalColors.surface,
        },
        tabBarLabel: ({ color, focused }) => (
          <Text
            style={{ color, fontSize: 11, fontWeight: focused ? "800" : "600", marginBottom: 5 }}
          >
            {route.name}
          </Text>
        ),
        tabBarIcon: ({ color, focused }) =>
          route.name === "Chat" ? (
            <MessageCircle color={color} size={22} strokeWidth={focused ? 2.6 : 2} />
          ) : (
            <SlidersHorizontal color={color} size={22} strokeWidth={focused ? 2.6 : 2} />
          ),
      })}
    >
      <Tabs.Screen name="Chat" component={ChatScreen} />
      <Tabs.Screen name="Settings" component={SettingsScreen} />
    </Tabs.Navigator>
  );
}

function AuthenticatedSignal() {
  const hydrate = useSignalStore((state) => state.hydrate);
  useEffect(() => {
    void hydrate().catch(() => {
      // A storage read failure should not prevent the authenticated shell from loading.
    });
    if (Platform.OS === "web") return undefined;
    const registerDevice = () => {
      void ensureDeviceRegistered().catch(() => {
        // Device actions remain unavailable until the authenticated control plane can register this key.
      });
    };
    const pollDeviceCommands = () => {
      void runPendingDeviceCommands().catch(() => {
        // The next foreground or interval poll retries after transient API/network failures.
      });
    };
    registerDevice();
    pollDeviceCommands();
    const interval = setInterval(() => {
      if (AppState.currentState === "active") pollDeviceCommands();
    }, 5_000);
    const appState = AppState.addEventListener("change", (state) => {
      if (state === "active") pollDeviceCommands();
    });
    const pushRotation = Notifications.addPushTokenListener(() => {
      registerDevice();
    });
    return () => {
      clearInterval(interval);
      appState.remove();
      pushRotation.remove();
    };
  }, [hydrate]);
  return (
    <NavigationContainer
      theme={{
        ...DefaultTheme,
        colors: {
          ...DefaultTheme.colors,
          primary: signalColors.teal,
          background: signalColors.canvas,
          card: signalColors.surface,
          text: signalColors.ink,
          border: signalColors.line,
        },
      }}
    >
      <StatusBar barStyle="dark-content" backgroundColor={signalColors.canvas} />
      <NotificationRouter />
      <SignalTabs />
    </NavigationContainer>
  );
}

function AuthGate() {
  const auth = useAuth();
  useEffect(() => {
    if (auth.status !== "signed_out") return;
    queryClient.clear();
    useSignalStore.getState().setActiveTenant(null);
  }, [auth.status]);
  return auth.status === "signed_in" ? (
    <BiometricLockGate>
      <AuthenticatedSignal />
    </BiometricLockGate>
  ) : (
    <AuthScreen />
  );
}

export default function App() {
  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <SafeAreaProvider>
        <AuthProvider>
          <QueryClientProvider client={queryClient}>
            <AuthGate />
          </QueryClientProvider>
        </AuthProvider>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}
