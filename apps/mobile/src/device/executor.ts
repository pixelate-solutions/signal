import AsyncStorage from "@react-native-async-storage/async-storage";
import { fromByteArray, toByteArray } from "base64-js";
import * as Calendar from "expo-calendar/next";
import * as Contacts from "expo-contacts/next";
import * as Crypto from "expo-crypto";
import * as DocumentPicker from "expo-document-picker";
import * as ImagePicker from "expo-image-picker";
import * as IntentLauncher from "expo-intent-launcher";
import * as Linking from "expo-linking";
import * as LocalAuthentication from "expo-local-authentication";
import * as Location from "expo-location";
import * as SecureStore from "expo-secure-store";
import * as SMS from "expo-sms";
import { Alert, AppState, Platform } from "react-native";
import nacl from "tweetnacl";

import {
  deviceCommandSchema,
  deviceCommandResultSchema,
  type DeviceCommand,
  type DeviceCommandResult,
} from "@signal/contracts";

import {
  reviewedAndroidIntent,
  reviewedAppIntentUrl,
  reviewedInstalledAppProbes,
} from "./intent-policy";

const DEVICE_SECRET_KEY = "signal.device.signing-secret";
const DEVICE_PUBLIC_KEY = "signal.device.signing-public";
const USED_NONCES_KEY = "signal.device.used-nonces";
const encoder = new TextEncoder();

export const supportedDeviceActions: DeviceCommand["actionType"][] = [
  "open_url",
  "app_intent",
  "android_intent",
  "select_contact",
  "calendar_upsert",
  "compose_message",
  "select_file",
  "capture_document",
  "foreground_location",
  "biometric_auth",
  "home_action",
  "create_signal_note",
];

function canonical(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  return `{${Object.entries(value as Record<string, unknown>)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, item]) => `${JSON.stringify(key)}:${canonical(item)}`)
    .join(",")}}`;
}

function base64UrlEncode(value: Uint8Array): string {
  return fromByteArray(value).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/, "");
}

function base64UrlDecode(value: string): Uint8Array {
  const normalized = value.replaceAll("-", "+").replaceAll("_", "/");
  return toByteArray(normalized.padEnd(Math.ceil(normalized.length / 4) * 4, "="));
}

async function keys(): Promise<nacl.SignKeyPair> {
  const [storedSecret, storedPublic] = await Promise.all([
    SecureStore.getItemAsync(DEVICE_SECRET_KEY),
    SecureStore.getItemAsync(DEVICE_PUBLIC_KEY),
  ]);
  if (storedSecret !== null && storedPublic !== null) {
    return { secretKey: base64UrlDecode(storedSecret), publicKey: base64UrlDecode(storedPublic) };
  }
  nacl.setPRNG((target, length) => {
    target.set(Crypto.getRandomBytes(length));
  });
  const created = nacl.sign.keyPair();
  await Promise.all([
    SecureStore.setItemAsync(DEVICE_SECRET_KEY, base64UrlEncode(created.secretKey), {
      keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
    }),
    SecureStore.setItemAsync(DEVICE_PUBLIC_KEY, base64UrlEncode(created.publicKey)),
  ]);
  return created;
}

export async function devicePublicKey(): Promise<string> {
  return base64UrlEncode((await keys()).publicKey);
}

async function confirm(title: string, description: string): Promise<boolean> {
  return new Promise((resolve) => {
    Alert.alert(title, description, [
      { text: "Cancel", style: "cancel", onPress: () => resolve(false) },
      { text: "Continue", onPress: () => resolve(true) },
    ]);
  });
}

async function enforceEnvelope(
  command: DeviceCommand,
  identity: { deviceId: string; userId: string },
) {
  if (command.deviceId !== identity.deviceId || command.userId !== identity.userId) {
    throw new Error("Device command identity does not match this installation.");
  }
  const now = Date.now();
  if (
    new Date(command.issuedAt).getTime() > now + 60_000 ||
    new Date(command.expiresAt).getTime() <= now
  ) {
    throw new Error("Device command is not currently valid.");
  }
  if (command.requiresForeground && AppState.currentState !== "active") {
    throw new Error("Device command requires the app in the foreground.");
  }
  const used = new Set(
    JSON.parse((await AsyncStorage.getItem(USED_NONCES_KEY)) ?? "[]") as string[],
  );
  if (used.has(command.nonce)) throw new Error("Device command nonce was already used.");
  used.add(command.nonce);
  await AsyncStorage.setItem(USED_NONCES_KEY, JSON.stringify([...used].slice(-500)));
}

function verifyServer(command: DeviceCommand, serverPublicKey: string): void {
  const { serverSignature, ...material } = command;
  const valid = nacl.sign.detached.verify(
    encoder.encode(canonical(material)),
    base64UrlDecode(serverSignature),
    base64UrlDecode(serverPublicKey),
  );
  if (!valid) throw new Error("Device command server signature is invalid.");
}

function stringField(payload: Record<string, unknown>, field: string, fallback = ""): string {
  const value = payload[field];
  return typeof value === "string" ? value : fallback;
}

function dateField(payload: Record<string, unknown>, field: string): Date {
  const value = stringField(payload, field);
  const date = new Date(value);
  if (value.length === 0 || Number.isNaN(date.getTime())) {
    throw new Error(`Device command requires a valid ${field} timestamp.`);
  }
  return date;
}

async function perform(command: DeviceCommand): Promise<{
  status: DeviceCommandResult["status"];
  result: Record<string, unknown>;
}> {
  const payload = command.payload;
  switch (command.actionType) {
    case "open_url":
    case "app_intent": {
      if (
        command.actionType === "app_intent" &&
        stringField(payload, "operation") === "check_installed_apps"
      ) {
        const probes = reviewedInstalledAppProbes(Platform.OS, payload["candidate_bundle_ids"]);
        if (probes.length === 0) {
          return {
            status: "UNSUPPORTED",
            result: {
              operation: "check_installed_apps",
              reason: "No requested app identifier is declared for this platform.",
            },
          };
        }
        const matches: Array<{ identifier: string; label: string }> = [];
        for (const probe of probes) {
          if (await Linking.canOpenURL(probe.url).catch(() => false)) {
            matches.push({ identifier: probe.identifier, label: probe.label });
          }
        }
        return {
          status: "SUCCEEDED",
          result: {
            operation: "check_installed_apps",
            installed: matches.length > 0,
            matches,
            checkedIdentifiers: probes.map((probe) => probe.identifier),
            platform: Platform.OS,
          },
        };
      }
      let url: string;
      try {
        url = reviewedAppIntentUrl(stringField(payload, "url"));
      } catch (error) {
        return {
          status: "UNSUPPORTED",
          result: {
            reason: error instanceof Error ? error.message : "Undeclared app integration.",
          },
        };
      }
      if (!(await Linking.canOpenURL(url))) {
        return { status: "UNSUPPORTED", result: { reason: "No declared handler is available." } };
      }
      await Linking.openURL(url);
      return { status: "SUCCEEDED", result: { opened: true, scheme: url.split(":")[0] } };
    }
    case "android_intent": {
      if (Platform.OS !== "android") {
        return { status: "UNSUPPORTED", result: { reason: "Android intent requires Android." } };
      }
      let intent: ReturnType<typeof reviewedAndroidIntent>;
      try {
        intent = reviewedAndroidIntent({
          action: stringField(payload, "action", "android.intent.action.VIEW"),
          url: stringField(payload, "url"),
          managedEnterprise: process.env.EXPO_PUBLIC_APP_VARIANT === "managed_enterprise",
        });
      } catch (error) {
        return {
          status: "UNSUPPORTED",
          result: { reason: error instanceof Error ? error.message : "Undeclared Android intent." },
        };
      }
      await IntentLauncher.startActivityAsync(intent.action, {
        ...(intent.data === undefined ? {} : { data: intent.data }),
      });
      return { status: "SUCCEEDED", result: { opened: true, action: intent.action } };
    }
    case "select_contact": {
      const permission = await Contacts.requestPermissionsAsync();
      if (!permission.granted) return { status: "PERMISSION_DENIED", result: {} };
      const contact = await Contacts.Contact.presentPicker();
      if (contact === null) return { status: "CANCELLED", result: {} };
      const name = await contact.getFullName();
      return { status: "SUCCEEDED", result: { contactId: contact.id, name } };
    }
    case "calendar_upsert": {
      const permission = await Calendar.requestCalendarPermissions();
      if (!permission.granted) return { status: "PERMISSION_DENIED", result: {} };
      const calendars = await Calendar.getCalendars(Calendar.EntityTypes.EVENT);
      const calendar = calendars.find((candidate) => candidate.allowsModifications);
      if (calendar === undefined)
        return { status: "UNSUPPORTED", result: { reason: "No writable calendar." } };
      const event = await calendar.createEvent({
        title: stringField(payload, "title", "Signal event"),
        startDate: dateField(payload, "start"),
        endDate: dateField(payload, "end"),
        ...(typeof payload["timezone"] === "string" ? { timeZone: payload["timezone"] } : {}),
        notes: "Created after an approved Signal device command.",
      });
      return { status: "SUCCEEDED", result: { eventId: event.id, calendarId: calendar.id } };
    }
    case "compose_message": {
      if (!(await SMS.isAvailableAsync()))
        return { status: "UNSUPPORTED", result: { reason: "Compose UI unavailable." } };
      const recipients = Array.isArray(payload["recipients"])
        ? payload["recipients"].filter(
            (recipient): recipient is string => typeof recipient === "string",
          )
        : [];
      const composed = await SMS.sendSMSAsync(recipients, stringField(payload, "message"));
      return {
        status: composed.result === "sent" ? "SUCCEEDED" : "CANCELLED",
        result: { composeResult: composed.result },
      };
    }
    case "select_file": {
      const selected = await DocumentPicker.getDocumentAsync({ copyToCacheDirectory: true });
      return selected.canceled
        ? { status: "CANCELLED", result: {} }
        : {
            status: "SUCCEEDED",
            result: {
              uri: selected.assets[0]?.uri ?? null,
              name: selected.assets[0]?.name ?? null,
            },
          };
    }
    case "capture_document": {
      const permission = await ImagePicker.requestCameraPermissionsAsync();
      if (!permission.granted) return { status: "PERMISSION_DENIED", result: {} };
      const captured = await ImagePicker.launchCameraAsync({
        mediaTypes: ["images"],
        quality: 0.95,
      });
      return captured.canceled
        ? { status: "CANCELLED", result: {} }
        : { status: "SUCCEEDED", result: { uri: captured.assets[0]?.uri ?? null } };
    }
    case "foreground_location": {
      const permission = await Location.requestForegroundPermissionsAsync();
      if (!permission.granted) return { status: "PERMISSION_DENIED", result: {} };
      const location = await Location.getCurrentPositionAsync({
        accuracy: Location.Accuracy.Balanced,
      });
      return {
        status: "SUCCEEDED",
        result: {
          latitude: location.coords.latitude,
          longitude: location.coords.longitude,
          accuracy: location.coords.accuracy,
        },
      };
    }
    case "biometric_auth": {
      const authentication = await LocalAuthentication.authenticateAsync({
        promptMessage: "Approve Signal device action",
      });
      return {
        status: authentication.success ? "SUCCEEDED" : "CANCELLED",
        result: { authenticated: authentication.success },
      };
    }
    case "create_signal_note": {
      const noteId = `note_${command.commandId}`;
      await SecureStore.setItemAsync(noteId, stringField(payload, "text"), {
        keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
      });
      return { status: "SUCCEEDED", result: { noteId, store: "signal_secure_notes" } };
    }
    case "home_action":
      return {
        status: "UNSUPPORTED",
        result: { reason: "A commissioned Matter/Home provider is not configured on this device." },
      };
  }
}

export async function executeDeviceCommand(
  rawCommand: unknown,
  identity: { deviceId: string; userId: string },
  serverPublicKey: string,
): Promise<DeviceCommandResult> {
  const command = deviceCommandSchema.parse(rawCommand);
  verifyServer(command, serverPublicKey);
  await enforceEnvelope(command, identity);
  if (
    command.requiresConfirmation &&
    !(await confirm(
      "Signal device action",
      `${command.actionType.replaceAll("_", " ")} for task ${command.taskId}`,
    ))
  ) {
    return signResult(command.commandId, "CANCELLED", { confirmed: false });
  }
  try {
    const outcome = await perform(command);
    return signResult(command.commandId, outcome.status, outcome.result);
  } catch (error) {
    return signResult(command.commandId, "FAILED", {
      message: error instanceof Error ? error.message : "Device action failed.",
      platform: Platform.OS,
    });
  }
}

async function signResult(
  commandId: string,
  status: DeviceCommandResult["status"],
  result: Record<string, unknown>,
): Promise<DeviceCommandResult> {
  const evidenceDigest = await Crypto.digestStringAsync(
    Crypto.CryptoDigestAlgorithm.SHA256,
    canonical({ commandId, status, result }),
  );
  const material = {
    commandId,
    status,
    result,
    evidenceDigest: `sha256:${evidenceDigest}`,
    completedAt: new Date().toISOString(),
  };
  const signature = nacl.sign.detached(
    encoder.encode(canonical(material)),
    (await keys()).secretKey,
  );
  return deviceCommandResultSchema.parse({
    ...material,
    deviceSignature: base64UrlEncode(signature),
  });
}
