import { KeyRound, ShieldCheck } from "lucide-react-native";
import { ActivityIndicator, Pressable, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { signalColors, signalRadius, signalSpacing } from "@signal/ui";

import { useAuth } from "../auth/auth-provider";
import { BrandMark } from "../components/brand-mark";

export function AuthScreen() {
  const insets = useSafeAreaInsets();
  const auth = useAuth();
  if (auth.status === "loading") {
    return (
      <View
        style={{
          flex: 1,
          alignItems: "center",
          justifyContent: "center",
          backgroundColor: signalColors.canvas,
        }}
      >
        <BrandMark />
        <ActivityIndicator color={signalColors.teal} style={{ marginTop: signalSpacing.xl }} />
      </View>
    );
  }
  return (
    <View
      style={{
        flex: 1,
        backgroundColor: signalColors.ink,
        paddingTop: insets.top + signalSpacing.xl,
        paddingBottom: insets.bottom + signalSpacing.lg,
        paddingHorizontal: signalSpacing.xl,
      }}
    >
      <BrandMark />
      <View style={{ flex: 1, justifyContent: "center" }}>
        <View
          style={{
            alignSelf: "flex-start",
            borderRadius: signalRadius.pill,
            backgroundColor: "#16413E",
            paddingHorizontal: 12,
            paddingVertical: 7,
            flexDirection: "row",
            alignItems: "center",
            gap: 7,
          }}
        >
          <ShieldCheck color={signalColors.lime} size={16} />
          <Text style={{ color: signalColors.lime, fontSize: 11, fontWeight: "800" }}>
            PRIVATE BY DESIGN
          </Text>
        </View>
        <Text
          style={{
            color: signalColors.surface,
            fontSize: 42,
            lineHeight: 47,
            fontWeight: "900",
            marginTop: signalSpacing.lg,
          }}
        >
          Work keeps moving.{"\n"}You keep control.
        </Text>
        <Text
          style={{ color: "#AFC5BF", fontSize: 16, lineHeight: 24, marginTop: signalSpacing.lg }}
        >
          Sign in to your durable Signal workspace. Credentials remain with your identity provider;
          every material action stays reviewable.
        </Text>
        {auth.error === null ? null : (
          <Text style={{ color: "#FFAAA1", marginTop: signalSpacing.md }}>{auth.error}</Text>
        )}
      </View>
      <Pressable
        accessibilityRole="button"
        onPress={() => void auth.signIn()}
        style={({ pressed }) => ({
          height: 56,
          borderRadius: signalRadius.md,
          backgroundColor: signalColors.lime,
          alignItems: "center",
          justifyContent: "center",
          flexDirection: "row",
          gap: 10,
          opacity: pressed ? 0.75 : 1,
        })}
      >
        <KeyRound color={signalColors.ink} size={20} />
        <Text style={{ color: signalColors.ink, fontWeight: "900", fontSize: 16 }}>Sign in</Text>
      </Pressable>
      <Pressable
        accessibilityRole="button"
        onPress={() => void auth.signUp()}
        style={({ pressed }) => ({
          height: 52,
          borderRadius: signalRadius.md,
          borderWidth: 1,
          borderColor: "#45615A",
          alignItems: "center",
          justifyContent: "center",
          marginTop: signalSpacing.sm,
          opacity: pressed ? 0.7 : 1,
        })}
      >
        <Text style={{ color: signalColors.surface, fontWeight: "800" }}>Create account</Text>
      </Pressable>
      <Pressable onPress={() => void auth.recoverAccount()} style={{ paddingVertical: 16 }}>
        <Text style={{ color: "#AFC5BF", textAlign: "center", fontWeight: "700" }}>
          Recover access
        </Text>
      </Pressable>
    </View>
  );
}
