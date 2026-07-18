import * as SecureStore from "expo-secure-store";
import { Platform } from "react-native";

import { signalApi } from "../api/client";
import { devicePublicKey, supportedDeviceActions } from "./executor";

const DEVICE_ID_KEY = "signal.device.id";

export async function ensureDeviceRegistered(): Promise<string | null> {
  if (Platform.OS !== "ios" && Platform.OS !== "android") return null;
  const existing = await SecureStore.getItemAsync(DEVICE_ID_KEY);
  if (existing !== null) return existing;
  const registration = await signalApi.registerDevice({
    platform: Platform.OS,
    appVariant: "consumer",
    displayName: `${Platform.OS === "ios" ? "iOS" : "Android"} Signal device`,
    publicKey: await devicePublicKey(),
    pushTokenHandle: null,
    capabilities: supportedDeviceActions,
  });
  await SecureStore.setItemAsync(DEVICE_ID_KEY, registration.id, {
    keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
  });
  return registration.id;
}
