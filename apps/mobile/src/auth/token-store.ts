import Constants from "expo-constants";
import * as AuthSession from "expo-auth-session";
import * as SecureStore from "expo-secure-store";
import { Platform } from "react-native";

import { resolveOidcIssuer, resolveOidcRedirectUri } from "./configuration";

const SESSION_KEY = "signal.oidc.session.v1";

export type OidcConfiguration = {
  issuer: string;
  clientId: string;
  redirectUri: string;
  scopes: string[];
};

export type StoredOidcSession = {
  accessToken: string;
  refreshToken: string | null;
  idToken: string | null;
  tokenType: string;
  issuedAt: number;
  expiresIn: number;
  scope: string | null;
};

function extraValue(key: string): string | undefined {
  const extra = Constants.expoConfig?.extra as unknown;
  if (extra === null || typeof extra !== "object") return undefined;
  const value = (extra as Record<string, unknown>)[key];
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

const webOrigin =
  Platform.OS === "web" && typeof window !== "undefined" ? window.location.origin : undefined;
const configuredIssuer = process.env.EXPO_PUBLIC_OIDC_ISSUER ?? extraValue("oidcIssuer");
const configuredRedirect =
  process.env.EXPO_PUBLIC_OIDC_REDIRECT_URI ?? extraValue("oidcRedirectUri");

export const oidcConfiguration: OidcConfiguration = {
  issuer: resolveOidcIssuer(configuredIssuer, webOrigin),
  clientId: process.env.EXPO_PUBLIC_OIDC_CLIENT_ID ?? extraValue("oidcClientId") ?? "signal-mobile",
  redirectUri: resolveOidcRedirectUri(configuredRedirect, webOrigin),
  scopes: ["openid", "profile", "email", "offline_access"],
};

let cached: StoredOidcSession | null | undefined;
let refreshInFlight: Promise<string | null> | undefined;
const listeners = new Set<() => void>();

function emitSessionChange(): void {
  for (const listener of listeners) listener();
}

export function subscribeToSession(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

async function readRaw(): Promise<string | null> {
  if (Platform.OS === "web") {
    return typeof sessionStorage === "undefined" ? null : sessionStorage.getItem(SESSION_KEY);
  }
  return SecureStore.getItemAsync(SESSION_KEY);
}

async function writeRaw(value: string | null): Promise<void> {
  if (Platform.OS === "web") {
    if (typeof sessionStorage === "undefined") return;
    if (value === null) sessionStorage.removeItem(SESSION_KEY);
    else sessionStorage.setItem(SESSION_KEY, value);
    return;
  }
  if (value === null) {
    await SecureStore.deleteItemAsync(SESSION_KEY);
  } else {
    await SecureStore.setItemAsync(SESSION_KEY, value, {
      keychainAccessible: SecureStore.AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY,
    });
  }
}

export async function loadStoredSession(): Promise<StoredOidcSession | null> {
  if (cached !== undefined) return cached;
  const raw = await readRaw();
  if (raw === null) {
    cached = null;
    return null;
  }
  try {
    const parsed = JSON.parse(raw) as StoredOidcSession;
    if (typeof parsed.accessToken !== "string" || typeof parsed.issuedAt !== "number") {
      throw new Error("Malformed session.");
    }
    cached = parsed;
  } catch {
    cached = null;
    await writeRaw(null);
  }
  return cached;
}

export async function persistTokenResponse(
  token: {
    accessToken: string;
    refreshToken?: string | undefined;
    idToken?: string | undefined;
    tokenType?: string | undefined;
    issuedAt?: number | undefined;
    expiresIn?: number | undefined;
    scope?: string | undefined;
  },
  previousRefreshToken?: string | null,
): Promise<StoredOidcSession> {
  const session: StoredOidcSession = {
    accessToken: token.accessToken,
    refreshToken: token.refreshToken ?? previousRefreshToken ?? null,
    idToken: token.idToken ?? null,
    tokenType: token.tokenType ?? "bearer",
    issuedAt: token.issuedAt ?? Math.floor(Date.now() / 1_000),
    expiresIn: token.expiresIn ?? 300,
    scope: token.scope ?? null,
  };
  cached = session;
  await writeRaw(JSON.stringify(session));
  emitSessionChange();
  return session;
}

export async function clearStoredSession(): Promise<void> {
  cached = null;
  await writeRaw(null);
  emitSessionChange();
}

function fresh(session: StoredOidcSession): boolean {
  return session.issuedAt + session.expiresIn > Date.now() / 1_000 + 60;
}

export async function getValidAccessToken(): Promise<string | null> {
  const session = await loadStoredSession();
  if (session === null) return null;
  if (fresh(session)) return session.accessToken;
  const refreshToken = session.refreshToken;
  if (refreshToken === null) {
    await clearStoredSession();
    return null;
  }
  if (refreshInFlight !== undefined) return refreshInFlight;
  refreshInFlight = (async () => {
    try {
      const discovery = await AuthSession.fetchDiscoveryAsync(oidcConfiguration.issuer);
      const refreshed = await AuthSession.refreshAsync(
        {
          clientId: oidcConfiguration.clientId,
          refreshToken,
          scopes: oidcConfiguration.scopes,
        },
        discovery,
      );
      const stored = await persistTokenResponse(refreshed, refreshToken);
      return stored.accessToken;
    } catch {
      await clearStoredSession();
      return null;
    } finally {
      refreshInFlight = undefined;
    }
  })();
  return refreshInFlight;
}

export async function revokeProviderSession(): Promise<void> {
  const session = await loadStoredSession();
  if (session?.refreshToken !== null && session?.refreshToken !== undefined) {
    try {
      const discovery = await AuthSession.fetchDiscoveryAsync(oidcConfiguration.issuer);
      if (discovery.revocationEndpoint !== undefined) {
        await AuthSession.revokeAsync(
          {
            clientId: oidcConfiguration.clientId,
            token: session.refreshToken,
            tokenTypeHint: AuthSession.TokenTypeHint.RefreshToken,
          },
          discovery,
        );
      }
    } finally {
      await clearStoredSession();
    }
  } else {
    await clearStoredSession();
  }
}
