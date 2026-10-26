const appIntentSchemes = new Set(["https:", "http:", "mailto:", "sms:", "smsto:", "tel:", "geo:"]);

const installedAppProbes: Record<
  "ios" | "android",
  ReadonlyMap<string, { label: string; url: string }>
> = {
  ios: new Map([
    ["com.apple.mobilenotes", { label: "Apple Notes", url: "mobilenotes://" }],
    ["com.microsoft.Office.OneNote", { label: "Microsoft OneNote", url: "onenote://" }],
    ["com.evernote.iPhone.Evernote", { label: "Evernote", url: "evernote://" }],
    ["notion.id", { label: "Notion", url: "notion://" }],
  ]),
  android: new Map([
    ["com.google.android.keep", { label: "Google Keep", url: "comgooglekeep://" }],
    ["com.microsoft.office.onenote", { label: "Microsoft OneNote", url: "onenote://" }],
    ["com.evernote", { label: "Evernote", url: "evernote://" }],
    ["notion.id", { label: "Notion", url: "notion://" }],
  ]),
};

export type InstalledAppProbe = {
  identifier: string;
  label: string;
  url: string;
};

export function reviewedInstalledAppProbes(
  platform: "ios" | "android" | "web" | "windows" | "macos",
  candidates: unknown,
): InstalledAppProbe[] {
  if (platform !== "ios" && platform !== "android") return [];
  const requested = Array.isArray(candidates)
    ? candidates.filter((candidate): candidate is string => typeof candidate === "string")
    : [];
  const allowlist = installedAppProbes[platform];
  const seen = new Set<string>();
  return requested.slice(0, 50).flatMap((identifier) => {
    if (seen.has(identifier)) return [];
    seen.add(identifier);
    const probe = allowlist.get(identifier);
    return probe === undefined ? [] : [{ identifier, ...probe }];
  });
}

const consumerAndroidActions = new Map<string, ReadonlySet<string>>([
  ["android.intent.action.VIEW", new Set(["https:", "http:", "geo:"])],
  ["android.intent.action.SENDTO", new Set(["mailto:", "sms:", "smsto:"])],
  ["android.intent.action.DIAL", new Set(["tel:"])],
]);

const enterpriseAndroidActions = new Map<string, ReadonlySet<string | null>>([
  ["android.settings.APPLICATION_DETAILS_SETTINGS", new Set(["package:"])],
  ["android.settings.WIFI_SETTINGS", new Set([null])],
]);

function parsedUrl(raw: string): URL {
  if (raw.length === 0 || raw.length > 2_048 || /[\r\n\0]/.test(raw)) {
    throw new Error("Intent URL is empty or malformed.");
  }
  const url = new URL(raw);
  if (url.username.length > 0 || url.password.length > 0) {
    throw new Error("Intent URLs cannot contain embedded credentials.");
  }
  return url;
}

export function reviewedAppIntentUrl(raw: string): string {
  const url = parsedUrl(raw);
  if (!appIntentSchemes.has(url.protocol)) {
    throw new Error(`The ${url.protocol} app integration is not declared in this build.`);
  }
  return url.toString();
}

export function reviewedAndroidIntent(input: {
  action: string;
  url: string;
  managedEnterprise: boolean;
}): { action: string; data?: string } {
  const consumerSchemes = consumerAndroidActions.get(input.action);
  const enterpriseSchemes = input.managedEnterprise
    ? enterpriseAndroidActions.get(input.action)
    : undefined;
  const allowedSchemes = consumerSchemes ?? enterpriseSchemes;
  if (allowedSchemes === undefined) {
    throw new Error("The Android intent action is not declared in this build.");
  }
  if (input.url.length === 0) {
    if (!allowedSchemes.has(null)) throw new Error("This Android intent requires a declared URL.");
    return { action: input.action };
  }
  const url = parsedUrl(input.url);
  if (!allowedSchemes.has(url.protocol)) {
    throw new Error(`The ${url.protocol} URL is not allowed for ${input.action}.`);
  }
  return { action: input.action, data: url.toString() };
}
