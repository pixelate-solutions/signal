import "react-native-gesture-handler";

import { createBottomTabNavigator } from "@react-navigation/bottom-tabs";
import { DefaultTheme, NavigationContainer } from "@react-navigation/native";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MessageCircle, SlidersHorizontal } from "lucide-react-native";
import { useEffect } from "react";
import { Platform, StatusBar, Text } from "react-native";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import { SafeAreaProvider } from "react-native-safe-area-context";

import { signalColors } from "@signal/ui";

import { ChatScreen } from "./src/screens/chat-screen";
import { ensureDeviceRegistered } from "./src/device/registration";
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

export default function App() {
  const hydrate = useSignalStore((state) => state.hydrate);
  useEffect(() => {
    void hydrate();
    void ensureDeviceRegistered().catch(() => {
      // Device actions remain unavailable until the authenticated control plane can register this key.
    });
  }, [hydrate]);
  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <SafeAreaProvider>
        <QueryClientProvider client={queryClient}>
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
            <SignalTabs />
          </NavigationContainer>
        </QueryClientProvider>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}
