import * as SecureStore from "expo-secure-store";
import { Platform } from "react-native";

import { signalApi } from "../api/client";
import { nativePushToken } from "../notifications/push";
import { devicePublicKey, supportedDeviceActions } from "./executor";

const DEVICE_ID_KEY = "signal.device.id";
const SERVER_PUBLIC_KEY = "signal.device.server-public-key";

export async function ensureDeviceRegistered(): Promise<string | null> {
  if (Platform.OS !== "ios" && Platform.OS !== "android") return null;
  const pushToken = await nativePushToken().catch(() => null);
  const registration = await signalApi.registerDevice({
    platform: Platform.OS,
    appVariant:
      process.env.EXPO_PUBLIC_APP_VARIANT === "managed_enterprise"
        ? "managed_enterprise"
        : "consumer",
    displayName: `${Platform.OS === "ios" ? "iOS" : "Android"} Signal device`,
    publicKey: await devicePublicKey(),
    pushToken,
    capabilities: supportedDeviceActions,
  });
  await Promise.all([
    SecureStore.setItemAsync(DEVICE_ID_KEY, registration.id, {
      keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
    }),
    SecureStore.setItemAsync(SERVER_PUBLIC_KEY, registration.serverPublicKey),
  ]);
  return registration.id;
}

export async function registeredDevice(): Promise<{
  deviceId: string;
  serverPublicKey: string;
} | null> {
  const [deviceId, serverPublicKey] = await Promise.all([
    SecureStore.getItemAsync(DEVICE_ID_KEY),
    SecureStore.getItemAsync(SERVER_PUBLIC_KEY),
  ]);
  return deviceId === null || serverPublicKey === null ? null : { deviceId, serverPublicKey };
}
