import * as SecureStore from "expo-secure-store";

import { signalApi } from "../api/client";
import { executeDeviceCommand } from "./executor";
import { ensureDeviceRegistered, registeredDevice } from "./registration";

let running: Promise<void> | undefined;

export function runPendingDeviceCommands(): Promise<void> {
  if (running !== undefined) return running;
  running = (async () => {
    let identity = await registeredDevice();
    if (identity === null) {
      await ensureDeviceRegistered();
      identity = await registeredDevice();
    }
    if (identity === null) return;
    const account = await signalApi.getAccount();
    const pending = await signalApi.pendingDeviceCommands(identity.deviceId);
    if (pending.serverPublicKey !== identity.serverPublicKey) {
      await SecureStore.setItemAsync("signal.device.server-public-key", pending.serverPublicKey);
      identity = { ...identity, serverPublicKey: pending.serverPublicKey };
    }
    for (const command of pending.items) {
      const result = await executeDeviceCommand(
        command,
        { deviceId: identity.deviceId, userId: account.id },
        identity.serverPublicKey,
      );
      await signalApi.submitDeviceCommandResult(result);
    }
  })().finally(() => {
    running = undefined;
  });
  return running;
}
