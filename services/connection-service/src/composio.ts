import { Composio } from "@composio/core";

export type ComposioLinkInput = {
  userId: string;
  authConfigId: string;
  callbackUrl: string;
};

export type ComposioSessionRef = {
  id: string;
};

export type ComposioAccount = {
  id: string;
  status: string;
  toolkit: string;
};

export type ComposioToolExecution = {
  successful: boolean;
  data: Record<string, unknown>;
  error: string | null;
  logId: string | null;
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

  public async account(id: string): Promise<ComposioAccount> {
    const account = await this.#client.connectedAccounts.get(id);
    return { id: account.id, status: account.status, toolkit: account.toolkit.slug };
  }

  public async complete(id: string): Promise<ComposioAccount> {
    const account = await this.account(id);
    if (account.status !== "ACTIVE") {
      throw new Error(`Composio connection is ${account.status.toLowerCase()}.`);
    }
    return account;
  }

  public async setEnabled(id: string, enabled: boolean): Promise<void> {
    await this.#client.connectedAccounts.updateStatus(id, { enabled });
  }

  public async revoke(id: string): Promise<void> {
    await this.#client.connectedAccounts.delete(id);
  }

  public async execute(input: {
    userId: string;
    connectedAccountId: string;
    toolSlug: string;
    toolVersion: string;
    arguments: Readonly<Record<string, unknown>>;
    signal: AbortSignal;
  }): Promise<ComposioToolExecution> {
    const result = await this.#client.tools.execute(
      input.toolSlug,
      {
        userId: input.userId,
        connectedAccountId: input.connectedAccountId,
        version: input.toolVersion,
        arguments: { ...input.arguments },
      },
      { signal: input.signal },
    );
    return {
      successful: result.successful,
      data: result.data,
      error: result.error,
      logId: result.logId ?? null,
    };
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
