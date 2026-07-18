import { Composio } from "@composio/core";

export type ComposioLinkInput = {
  userId: string;
  authConfigId: string;
  callbackUrl: string;
};

export type ComposioSessionRef = {
  id: string;
};

export class ComposioConnectionProvider {
  readonly #client: Composio;

  public constructor(apiKey: string) {
    if (apiKey.length === 0) {
      throw new Error("CONNECTION_REQUIRED: COMPOSIO_API_KEY is not configured.");
    }
    this.#client = new Composio({ apiKey });
  }

  public async link(input: ComposioLinkInput): Promise<{ id: string; redirectUrl: string }> {
    if (!input.userId.startsWith("usr_")) {
      throw new Error("Composio user IDs must be stable product user UUIDs.");
    }
    const request = await this.#client.connectedAccounts.link(input.userId, input.authConfigId, {
      callbackUrl: input.callbackUrl,
    });
    if (request.redirectUrl === null || request.redirectUrl === undefined) {
      throw new Error("Composio did not return an authorization redirect URL.");
    }
    return { id: request.id, redirectUrl: request.redirectUrl };
  }

  public async createSession(userId: string): Promise<ComposioSessionRef> {
    if (!userId.startsWith("usr_")) {
      throw new Error("Composio sessions require a stable product user UUID.");
    }
    const session = await this.#client.create(userId);
    return { id: session.sessionId };
  }

  public async useSession(sessionId: string): Promise<ComposioSessionRef> {
    const session = await this.#client.use(sessionId);
    return { id: session.sessionId };
  }
}
