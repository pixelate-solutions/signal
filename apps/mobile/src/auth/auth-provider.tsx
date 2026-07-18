import * as AuthSession from "expo-auth-session";
import * as Linking from "expo-linking";
import * as WebBrowser from "expo-web-browser";
import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";

import {
  clearStoredSession,
  getValidAccessToken,
  loadStoredSession,
  oidcConfiguration,
  persistTokenResponse,
  revokeProviderSession,
  subscribeToSession,
} from "./token-store";

WebBrowser.maybeCompleteAuthSession();

type AuthState = {
  status: "loading" | "signed_out" | "signed_in";
  error: string | null;
  signIn: () => Promise<void>;
  signUp: () => Promise<void>;
  recoverAccount: () => Promise<void>;
  reauthenticate: () => Promise<void>;
  signOut: () => Promise<void>;
  refresh: () => Promise<void>;
};

const AuthContext = createContext<AuthState | undefined>(undefined);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const discovery = AuthSession.useAutoDiscovery(oidcConfiguration.issuer);
  const [request, response, promptAsync] = AuthSession.useAuthRequest(
    {
      clientId: oidcConfiguration.clientId,
      redirectUri: oidcConfiguration.redirectUri,
      responseType: AuthSession.ResponseType.Code,
      scopes: oidcConfiguration.scopes,
      usePKCE: true,
    },
    discovery,
  );
  const [status, setStatus] = useState<AuthState["status"]>("loading");
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    const token = await getValidAccessToken();
    setStatus(token === null ? "signed_out" : "signed_in");
  }, []);

  useEffect(() => {
    void loadStoredSession().then(() => refresh());
  }, [refresh]);

  useEffect(() => subscribeToSession(() => void refresh()), [refresh]);

  useEffect(() => {
    if (response === null || discovery === null || request === null) return;
    if (response.type !== "success") {
      if (response.type === "error") setError(response.error?.message ?? "Sign-in failed.");
      return;
    }
    const code = response.params["code"];
    if (code === undefined || request.codeVerifier === undefined) {
      setError("The identity provider returned an incomplete authorization response.");
      return;
    }
    void AuthSession.exchangeCodeAsync(
      {
        clientId: oidcConfiguration.clientId,
        code,
        redirectUri: oidcConfiguration.redirectUri,
        extraParams: { code_verifier: request.codeVerifier },
      },
      discovery,
    )
      .then(async (tokens) => {
        await persistTokenResponse(tokens);
        setError(null);
        setStatus("signed_in");
      })
      .catch(async (exchangeError: unknown) => {
        await clearStoredSession();
        setError(exchangeError instanceof Error ? exchangeError.message : "Sign-in failed.");
        setStatus("signed_out");
      });
  }, [discovery, request, response]);

  const signIn = useCallback(async () => {
    if (request === null) return;
    setError(null);
    await promptAsync();
  }, [promptAsync, request]);

  const signUp = useCallback(async () => {
    if (request?.url === null || request?.url === undefined) return;
    setError(null);
    const separator = request.url.includes("?") ? "&" : "?";
    await promptAsync({ url: `${request.url}${separator}screen_hint=signup` });
  }, [promptAsync, request]);

  const recoverAccount = useCallback(async () => {
    await Linking.openURL(`${oidcConfiguration.issuer.replace(/\/$/, "")}/account`);
  }, []);

  const reauthenticate = useCallback(async () => {
    setError(null);
    const [current, stepUpDiscovery] = await Promise.all([
      loadStoredSession(),
      discovery === null
        ? AuthSession.fetchDiscoveryAsync(oidcConfiguration.issuer)
        : Promise.resolve(discovery),
    ]);
    if (current === null) throw new Error("Sign in again before approving this action.");
    const stepUpRequest = new AuthSession.AuthRequest({
      clientId: oidcConfiguration.clientId,
      redirectUri: oidcConfiguration.redirectUri,
      responseType: AuthSession.ResponseType.Code,
      scopes: oidcConfiguration.scopes,
      prompt: AuthSession.Prompt.Login,
      extraParams: { max_age: "0" },
      usePKCE: true,
    });
    const result = await stepUpRequest.promptAsync(stepUpDiscovery);
    if (result.type !== "success") {
      throw new Error(
        result.type === "error"
          ? (result.error?.message ?? "Recent authentication failed.")
          : "Recent authentication was cancelled.",
      );
    }
    const code = result.params["code"];
    if (code === undefined || stepUpRequest.codeVerifier === undefined) {
      throw new Error("The identity provider returned an incomplete step-up response.");
    }
    const tokens = await AuthSession.exchangeCodeAsync(
      {
        clientId: oidcConfiguration.clientId,
        code,
        redirectUri: oidcConfiguration.redirectUri,
        extraParams: { code_verifier: stepUpRequest.codeVerifier },
      },
      stepUpDiscovery,
    );
    await persistTokenResponse(tokens, current.refreshToken);
    setStatus("signed_in");
  }, [discovery]);

  const signOut = useCallback(async () => {
    await revokeProviderSession();
    setStatus("signed_out");
  }, []);

  const value = useMemo<AuthState>(
    () => ({ status, error, signIn, signUp, recoverAccount, reauthenticate, signOut, refresh }),
    [error, reauthenticate, recoverAccount, refresh, signIn, signOut, signUp, status],
  );
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthState {
  const value = useContext(AuthContext);
  if (value === undefined) throw new Error("useAuth must be used within AuthProvider.");
  return value;
}
