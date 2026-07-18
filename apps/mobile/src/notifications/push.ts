import * as Device from "expo-device";
import * as Notifications from "expo-notifications";
import { Platform } from "react-native";

Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowBanner: true,
    shouldShowList: true,
    shouldPlaySound: false,
    shouldSetBadge: false,
  }),
});

export async function nativePushToken(): Promise<string | null> {
  if ((Platform.OS !== "ios" && Platform.OS !== "android") || !Device.isDevice) return null;
  if (Platform.OS === "android") {
    await Notifications.setNotificationChannelAsync("action-required", {
      name: "Action required",
      importance: Notifications.AndroidImportance.HIGH,
      lockscreenVisibility: Notifications.AndroidNotificationVisibility.PRIVATE,
      vibrationPattern: [0, 180, 120, 180],
    });
  }
  const existing = await Notifications.getPermissionsAsync();
  const permission =
    existing.status === Notifications.PermissionStatus.GRANTED
      ? existing
      : await Notifications.requestPermissionsAsync({
          ios: { allowAlert: true, allowBadge: true, allowSound: true },
        });
  if (permission.status !== Notifications.PermissionStatus.GRANTED) return null;
  const token = await Notifications.getDevicePushTokenAsync();
  return typeof token.data === "string" ? token.data : JSON.stringify(token.data);
}
