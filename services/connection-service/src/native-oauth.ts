import { createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";

type PendingAuthorization = {
  tenantId: string;
  userId: string;
  provider: string;
  verifier: string;
  nonce: string;
  redirectUri: string;
  originatingTaskId?: string;
  returnDeepLink: string;
  expiresAt: Date;
  consumed: boolean;
};

export type NativeOAuthStart = {
  tenantId: string;
  userId: string;
  provider: string;
  authorizationEndpoint: string;
  clientId: string;
  redirectUri: string;
  scopes: readonly string[];
  originatingTaskId?: string;
  returnDeepLink: string;
};

export type NativeOAuthCallback = {
  code: string;
  state: string;
  redirectUri: string;
};

function base64Url(input: Uint8Array): string {
  return Buffer.from(input).toString("base64url");
}

export class NativeOAuthProvider {
  readonly #pending = new Map<string, PendingAuthorization>();

  public constructor(private readonly stateSigningKey: Uint8Array) {
    if (stateSigningKey.byteLength < 32) {
      throw new Error("OAuth state signing key must contain at least 32 bytes.");
    }
  }

  public start(
    input: NativeOAuthStart,
    now = new Date(),
  ): {
    authorizationUrl: string;
    state: string;
    expiresAt: string;
  } {
    const stateId = base64Url(randomBytes(24));
    const verifier = base64Url(randomBytes(48));
    const nonce = base64Url(randomBytes(24));
    const expiresAt = new Date(now.getTime() + 10 * 60 * 1_000);
    const signature = this.sign(stateId);
    const state = `${stateId}.${signature}`;
    this.#pending.set(stateId, {
      tenantId: input.tenantId,
      userId: input.userId,
      provider: input.provider,
      verifier,
      nonce,
      redirectUri: input.redirectUri,
      ...(input.originatingTaskId === undefined
        ? {}
        : { originatingTaskId: input.originatingTaskId }),
      returnDeepLink: input.returnDeepLink,
      expiresAt,
      consumed: false,
    });

    const url = new URL(input.authorizationEndpoint);
    url.searchParams.set("response_type", "code");
    url.searchParams.set("client_id", input.clientId);
    url.searchParams.set("redirect_uri", input.redirectUri);
    url.searchParams.set("scope", input.scopes.join(" "));
    url.searchParams.set("state", state);
    url.searchParams.set("nonce", nonce);
    url.searchParams.set("code_challenge_method", "S256");
    url.searchParams.set(
      "code_challenge",
      base64Url(createHash("sha256").update(verifier).digest()),
    );
    return { authorizationUrl: url.toString(), state, expiresAt: expiresAt.toISOString() };
  }

  public consume(
    callback: NativeOAuthCallback,
    now = new Date(),
  ): Omit<PendingAuthorization, "consumed"> {
    const [stateId, signature, extra] = callback.state.split(".");
    if (stateId === undefined || signature === undefined || extra !== undefined) {
      throw new Error("Invalid OAuth state.");
    }
    this.verify(stateId, signature);
    const pending = this.#pending.get(stateId);
    if (pending === undefined || pending.consumed) {
      throw new Error("OAuth state is unknown or was already used.");
    }
    if (pending.expiresAt <= now) {
      throw new Error("OAuth state has expired.");
    }
    if (callback.redirectUri !== pending.redirectUri) {
      throw new Error("OAuth redirect URI does not match the original request.");
    }
    this.#pending.set(stateId, { ...pending, consumed: true });
    const { consumed: _consumed, ...safe } = pending;
    return safe;
  }

  private sign(stateId: string): string {
    return createHmac("sha256", this.stateSigningKey).update(stateId).digest("base64url");
  }

  private verify(stateId: string, signature: string): void {
    const expected = Buffer.from(this.sign(stateId));
    const actual = Buffer.from(signature);
    if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) {
      throw new Error("OAuth state signature is invalid.");
    }
  }
}
