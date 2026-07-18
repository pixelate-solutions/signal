import { View } from "react-native";

import { signalColors } from "@signal/ui";

export function BrandMark({ compact = false }: { compact?: boolean }) {
  const size = compact ? 34 : 44;
  return (
    <View
      accessibilityElementsHidden
      style={{
        width: size,
        height: size,
        borderRadius: size / 2,
        backgroundColor: signalColors.ink,
        alignItems: "center",
        justifyContent: "center",
        overflow: "hidden",
      }}
    >
      <View
        style={{
          width: size * 0.48,
          height: size * 0.48,
          borderRadius: size,
          borderWidth: compact ? 2.5 : 3,
          borderColor: signalColors.lime,
        }}
      />
      <View
        style={{
          position: "absolute",
          width: size * 0.12,
          height: size * 0.12,
          borderRadius: size,
          backgroundColor: signalColors.lime,
        }}
      />
    </View>
  );
}
