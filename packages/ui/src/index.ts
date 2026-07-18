export const signalColors = {
  ink: "#071A20",
  inkMuted: "#52666D",
  canvas: "#F3F6F2",
  surface: "#FFFFFF",
  surfaceRaised: "#FAFCF9",
  line: "#DDE6E0",
  teal: "#0A766B",
  tealDark: "#07564F",
  tealSoft: "#D9EEE8",
  lime: "#C8F15A",
  limeSoft: "#EDF9CB",
  amber: "#A75F00",
  amberSoft: "#FFF0D7",
  red: "#A93636",
  redSoft: "#FBE6E4",
  blue: "#235F8D",
  blueSoft: "#E4EFF8",
  violet: "#694DA5",
  violetSoft: "#EFE9FA",
} as const;

export const signalSpacing = {
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 24,
  xxl: 32,
} as const;

export const signalRadius = {
  sm: 10,
  md: 16,
  lg: 22,
  pill: 999,
} as const;

export type SemanticTone = "neutral" | "active" | "success" | "warning" | "danger";

export function toneColors(tone: SemanticTone): { foreground: string; background: string } {
  switch (tone) {
    case "active":
      return { foreground: signalColors.tealDark, background: signalColors.tealSoft };
    case "success":
      return { foreground: signalColors.tealDark, background: signalColors.limeSoft };
    case "warning":
      return { foreground: signalColors.amber, background: signalColors.amberSoft };
    case "danger":
      return { foreground: signalColors.red, background: signalColors.redSoft };
    default:
      return { foreground: signalColors.inkMuted, background: signalColors.canvas };
  }
}

export function formatShortTime(value: string, locale?: string): string {
  return new Intl.DateTimeFormat(locale, { hour: "numeric", minute: "2-digit" }).format(
    new Date(value),
  );
}
