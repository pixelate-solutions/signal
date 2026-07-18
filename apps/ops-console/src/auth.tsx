import { createContext, useContext, useEffect, useMemo, useState } from "react";
import { UserManager, WebStorageStateStore, type User } from "oidc-client-ts";

type AuthState = {
  status: "loading" | "signed_out" | "signed_in";
  user: User | null;
  error: string | null;
  signIn(): Promise<void>;
  signOut(): Promise<void>;
};

type IdentityConfiguration = {
  issuer: string;
  clientId: string;
  scopes: string[];
  redirectUri: string;
};

const apiBase =
  (import.meta.env["VITE_SIGNAL_API_URL"] as string | undefined)?.replace(/\/$/, "") ?? "";
let managerPromise: Promise<UserManager> | undefined;
let currentUser: User | null = null;

async function manager(): Promise<UserManager> {
  managerPromise ??= fetch(`${apiBase}/v1/identity/configuration?client=ops`, {
    headers: { accept: "application/json" },
  })
    .then(async (response) => {
      if (!response.ok) throw new Error(`Identity configuration returned ${response.status}.`);
      return (await response.json()) as IdentityConfiguration;
    })
    .then(
      (configuration) =>
        new UserManager({
          authority: configuration.issuer,
          client_id: configuration.clientId,
          redirect_uri: configuration.redirectUri,
          post_logout_redirect_uri: window.location.origin,
          response_type: "code",
          scope: configuration.scopes.join(" "),
          automaticSilentRenew: true,
          monitorSession: true,
          userStore: new WebStorageStateStore({ store: window.sessionStorage }),
          stateStore: new WebStorageStateStore({ store: window.sessionStorage }),
        }),
    );
  return managerPromise;
}

export async function getOpsAccessToken(): Promise<string | null> {
  if (currentUser !== null && !currentUser.expired) return currentUser.access_token;
  const oidc = await manager();
  currentUser = await oidc.getUser();
  if (currentUser === null || currentUser.expired) return null;
  return currentUser.access_token;
}

const AuthContext = createContext<AuthState | undefined>(undefined);

export function OpsAuthProvider({ children }: { children: React.ReactNode }) {
  const [status, setStatus] = useState<AuthState["status"]>("loading");
  const [user, setUser] = useState<User | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    let removeListeners: (() => void) | undefined;
    void manager()
      .then(async (oidc) => {
        if (window.location.search.includes("code=") && window.location.search.includes("state=")) {
          await oidc.signinRedirectCallback();
          window.history.replaceState({}, document.title, "/");
        }
        const loaded = await oidc.getUser();
        currentUser = loaded;
        if (!active) return;
        setUser(loaded);
        setStatus(loaded !== null && !loaded.expired ? "signed_in" : "signed_out");
        const loadedHandler = (next: User) => {
          currentUser = next;
          setUser(next);
          setStatus("signed_in");
        };
        const unloadedHandler = () => {
          currentUser = null;
          setUser(null);
          setStatus("signed_out");
        };
        oidc.events.addUserLoaded(loadedHandler);
        oidc.events.addUserUnloaded(unloadedHandler);
        removeListeners = () => {
          oidc.events.removeUserLoaded(loadedHandler);
          oidc.events.removeUserUnloaded(unloadedHandler);
        };
      })
      .catch((cause: unknown) => {
        if (!active) return;
        setError(cause instanceof Error ? cause.message : "Operator sign-in failed.");
        setStatus("signed_out");
      });
    return () => {
      active = false;
      removeListeners?.();
    };
  }, []);

  const value = useMemo<AuthState>(
    () => ({
      status,
      user,
      error,
      signIn: async () => {
        setError(null);
        await (await manager()).signinRedirect();
      },
      signOut: async () => {
        currentUser = null;
        await (await manager()).signoutRedirect();
      },
    }),
    [error, status, user],
  );
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useOpsAuth(): AuthState {
  const value = useContext(AuthContext);
  if (value === undefined) throw new Error("useOpsAuth must be used inside OpsAuthProvider.");
  return value;
}
