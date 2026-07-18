import AsyncStorage from "@react-native-async-storage/async-storage";
import { useQuery } from "@tanstack/react-query";
import * as LocalAuthentication from "expo-local-authentication";
import { useCallback, useEffect, useRef, useState } from "react";
import { ActivityIndicator, AppState, Platform, Pressable, Text, View } from "react-native";

import { signalColors, signalRadius, signalSpacing } from "@signal/ui";

import { signalApi } from "../api/client";
import { useAuth } from "./auth-provider";

const BIOMETRIC_LOCK_KEY = "signal.biometric-lock-enabled.v1";
const RELOCK_AFTER_MS = 15_000;

export async function cacheBiometricLock(enabled: boolean): Promise<void> {
  await AsyncStorage.setItem(BIOMETRIC_LOCK_KEY, enabled ? "true" : "false");
}

export function BiometricLockGate({ children }: { children: React.ReactNode }) {
  const auth = useAuth();
  const settings = useQuery({
    queryKey: ["settings"],
    queryFn: signalApi.getSettings,
    retry: 1,
  });
  const [localEnabled, setLocalEnabled] = useState<boolean | null>(null);
  const [enabled, setEnabled] = useState<boolean | null>(null);
  const [unlocked, setUnlocked] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const authenticating = useRef(false);
  const backgroundedAt = useRef<number | null>(null);
  const enabledRef = useRef(false);

  useEffect(() => {
    void AsyncStorage.getItem(BIOMETRIC_LOCK_KEY).then((value) => {
      setLocalEnabled(value === "true");
    });
  }, []);

  useEffect(() => {
    if (Platform.OS === "web") {
      setEnabled(false);
      return;
    }
    if (settings.data !== undefined) {
      setEnabled(settings.data.biometricLock);
      void cacheBiometricLock(settings.data.biometricLock);
      return;
    }
    if (settings.isError && localEnabled !== null) setEnabled(localEnabled);
  }, [localEnabled, settings.data, settings.isError]);

  useEffect(() => {
    enabledRef.current = enabled === true;
    if (enabled === false) {
      setError(null);
      setUnlocked(true);
    } else if (enabled === true) {
      setUnlocked(false);
    }
  }, [enabled]);

  const authenticate = useCallback(async () => {
    if (!enabledRef.current || authenticating.current) return;
    authenticating.current = true;
    setError(null);
    try {
      const [hardware, enrolled] = await Promise.all([
        LocalAuthentication.hasHardwareAsync(),
        LocalAuthentication.isEnrolledAsync(),
      ]);
      if (!hardware || !enrolled) {
        setError("Enroll Face ID, Touch ID, fingerprint, or a device credential to unlock Signal.");
        return;
      }
      const result = await LocalAuthentication.authenticateAsync({
        promptMessage: "Unlock Signal",
        cancelLabel: "Cancel",
        disableDeviceFallback: false,
      });
      setUnlocked(result.success);
      if (!result.success) setError("Signal remains locked.");
    } catch (authenticationError) {
      setUnlocked(false);
      setError(
        authenticationError instanceof Error
          ? authenticationError.message
          : "Device authentication was unavailable.",
      );
    } finally {
      authenticating.current = false;
    }
  }, []);

  useEffect(() => {
    if (enabled === true && !unlocked) void authenticate();
  }, [authenticate, enabled, unlocked]);

  useEffect(() => {
    const subscription = AppState.addEventListener("change", (state) => {
      if (state === "background" || state === "inactive") {
        backgroundedAt.current ??= Date.now();
        return;
      }
      if (state === "active") {
        const elapsed = Date.now() - (backgroundedAt.current ?? Date.now());
        backgroundedAt.current = null;
        if (enabledRef.current && elapsed >= RELOCK_AFTER_MS) {
          setUnlocked(false);
          void authenticate();
        }
      }
    });
    return () => subscription.remove();
  }, [authenticate]);

  if (enabled === false || unlocked) return children;
  return (
    <View
      style={{
        flex: 1,
        alignItems: "center",
        justifyContent: "center",
        gap: signalSpacing.md,
        padding: signalSpacing.xl,
        backgroundColor: signalColors.canvas,
      }}
    >
      {enabled === null ? <ActivityIndicator color={signalColors.teal} /> : null}
      <Text style={{ color: signalColors.ink, fontSize: 22, fontWeight: "900" }}>
        {enabled === null ? "Securing Signal…" : "Signal is locked"}
      </Text>
      {error !== null ? (
        <Text style={{ color: signalColors.inkMuted, textAlign: "center", lineHeight: 20 }}>
          {error}
        </Text>
      ) : null}
      {enabled === true ? (
        <>
          <Pressable
            accessibilityRole="button"
            onPress={() => void authenticate()}
            style={{
              minWidth: 180,
              alignItems: "center",
              paddingVertical: 12,
              borderRadius: signalRadius.pill,
              backgroundColor: signalColors.teal,
            }}
          >
            <Text style={{ color: signalColors.surface, fontWeight: "800" }}>Unlock</Text>
          </Pressable>
          <Pressable accessibilityRole="button" onPress={() => void auth.signOut()}>
            <Text style={{ color: signalColors.inkMuted, fontWeight: "700" }}>Sign out</Text>
          </Pressable>
        </>
      ) : null}
    </View>
  );
}
