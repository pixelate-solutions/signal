import type { ConfigContext, ExpoConfig } from "expo/config";

import base from "./app.json";

function requiredProductionValue(name: string, productionBuild: boolean): string | undefined {
  const value = process.env[name]?.trim();
  if (productionBuild && (value === undefined || value.length === 0)) {
    throw new Error(`${name} must be configured in the EAS production environment.`);
  }
  return value;
}

function assertHttps(name: string, value: string | undefined, productionBuild: boolean): void {
  if (!productionBuild || value === undefined) return;
  const parsed = new URL(value);
  if (parsed.protocol !== "https:")
    throw new Error(`${name} must use HTTPS for production builds.`);
}

export default ({ config }: ConfigContext): ExpoConfig => {
  const profile = process.env["EAS_BUILD_PROFILE"];
  const productionBuild = profile === "production" || profile === "enterprise";
  const managed = process.env["EXPO_PUBLIC_APP_VARIANT"] === "managed_enterprise";
  const source = base.expo as ExpoConfig;
  const apiUrl =
    requiredProductionValue("EXPO_PUBLIC_API_URL", productionBuild) ??
    (source.extra?.["apiUrl"] as string | undefined);
  const oidcIssuer = requiredProductionValue("EXPO_PUBLIC_OIDC_ISSUER", productionBuild);
  const oidcClientId = requiredProductionValue("EXPO_PUBLIC_OIDC_CLIENT_ID", productionBuild);
  const oidcRedirectUri = process.env["EXPO_PUBLIC_OIDC_REDIRECT_URI"] ?? "signal://oauth/callback";
  const easProjectId = requiredProductionValue("EAS_PROJECT_ID", productionBuild);
  const linkHost = process.env["EXPO_PUBLIC_LINK_HOST"]?.trim() || "signal.pixelate.solutions";
  assertHttps("EXPO_PUBLIC_API_URL", apiUrl, productionBuild);
  assertHttps("EXPO_PUBLIC_OIDC_ISSUER", oidcIssuer, productionBuild);
  if (productionBuild && oidcRedirectUri !== "signal://oauth/callback") {
    throw new Error("EXPO_PUBLIC_OIDC_REDIRECT_URI must be signal://oauth/callback in production.");
  }
  if (!/^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/i.test(linkHost)) {
    throw new Error("EXPO_PUBLIC_LINK_HOST must be a valid DNS hostname.");
  }
  return {
    ...config,
    ...source,
    name: managed ? "Signal Enterprise" : source.name,
    slug: managed ? "signal-enterprise" : source.slug,
    scheme: source.scheme,
    ios: {
      ...source.ios,
      bundleIdentifier: managed
        ? "solutions.pixelate.signal.enterprise"
        : "solutions.pixelate.signal",
      associatedDomains: [`applinks:${linkHost}`],
    },
    android: {
      ...source.android,
      package: managed ? "solutions.pixelate.signal.enterprise" : "solutions.pixelate.signal",
      intentFilters: [
        {
          action: "VIEW",
          autoVerify: true,
          data: [{ scheme: "https", host: linkHost, pathPrefix: "/app" }],
          category: ["BROWSABLE", "DEFAULT"],
        },
      ],
    },
    extra: {
      ...source.extra,
      appVariant: managed ? "managed_enterprise" : "consumer",
      apiUrl,
      oidcIssuer,
      oidcClientId,
      oidcRedirectUri,
      linkHost,
      eas: easProjectId === undefined ? undefined : { projectId: easProjectId },
    },
  };
};
