import { createCipheriv, createDecipheriv, randomBytes, randomUUID } from "node:crypto";

export type SecretStore = {
  put(key: string, plaintext: Uint8Array): Promise<void>;
  get(key: string): Promise<Uint8Array | undefined>;
  delete(key: string): Promise<void>;
};

export class InMemoryEncryptedSecretStore implements SecretStore {
  readonly #key = randomBytes(32);
  readonly #values = new Map<string, Uint8Array>();

  public async put(key: string, plaintext: Uint8Array): Promise<void> {
    const nonce = randomBytes(12);
    const cipher = createCipheriv("aes-256-gcm", this.#key, nonce);
    const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
    const tag = cipher.getAuthTag();
    this.#values.set(key, Buffer.concat([nonce, tag, ciphertext]));
  }

  public async get(key: string): Promise<Uint8Array | undefined> {
    const packed = this.#values.get(key);
    if (packed === undefined) return undefined;
    const buffer = Buffer.from(packed);
    const nonce = buffer.subarray(0, 12);
    const tag = buffer.subarray(12, 28);
    const ciphertext = buffer.subarray(28);
    const decipher = createDecipheriv("aes-256-gcm", this.#key, nonce);
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(ciphertext), decipher.final()]);
  }

  public async delete(key: string): Promise<void> {
    this.#values.delete(key);
  }
}

export type CredentialMetadata = {
  id: string;
  tenantId: string;
  ownerUserId: string;
  provider: string;
  secretType: "oauth_refresh_token" | "api_key" | "password" | "browser_state";
  secretStoreKey: string;
  status: "ACTIVE" | "REVOKED";
  createdAt: string;
};

export type CredentialAudit = {
  record(entry: {
    action: "credential.created" | "credential.used" | "credential.revoked";
    credentialHandleId: string;
    tenantId: string;
    taskId?: string;
    adapter?: string;
  }): Promise<void>;
};

const noAudit: CredentialAudit = { record: async () => undefined };

export class CredentialBroker {
  readonly #metadata = new Map<string, CredentialMetadata>();

  public constructor(
    private readonly store: SecretStore,
    private readonly audit: CredentialAudit = noAudit,
  ) {}

  public async create(
    input: Omit<CredentialMetadata, "id" | "secretStoreKey" | "status" | "createdAt">,
    plaintext: string,
  ): Promise<string> {
    const id = `cred_${randomUUID().replaceAll("-", "")}`;
    const secretStoreKey = `signal/${input.tenantId}/${id}`;
    await this.store.put(secretStoreKey, new TextEncoder().encode(plaintext));
    this.#metadata.set(id, {
      ...input,
      id,
      secretStoreKey,
      status: "ACTIVE",
      createdAt: new Date().toISOString(),
    });
    await this.audit.record({
      action: "credential.created",
      credentialHandleId: id,
      tenantId: input.tenantId,
    });
    return id;
  }

  public async available(id: string, tenantId?: string): Promise<boolean> {
    const metadata = this.#metadata.get(id);
    return (
      metadata !== undefined &&
      metadata.status === "ACTIVE" &&
      (tenantId === undefined || metadata.tenantId === tenantId)
    );
  }

  public async withCredential<T>(
    id: string,
    context: { tenantId: string; taskId: string; adapter: string },
    operation: (plaintext: string) => Promise<T>,
  ): Promise<T> {
    const metadata = this.#metadata.get(id);
    if (
      metadata === undefined ||
      metadata.status !== "ACTIVE" ||
      metadata.tenantId !== context.tenantId
    ) {
      throw new Error("CONNECTION_REQUIRED: credential handle is unavailable.");
    }
    const raw = await this.store.get(metadata.secretStoreKey);
    if (raw === undefined) {
      throw new Error("CONNECTION_REQUIRED: encrypted credential material is unavailable.");
    }
    await this.audit.record({
      action: "credential.used",
      credentialHandleId: id,
      tenantId: context.tenantId,
      taskId: context.taskId,
      adapter: context.adapter,
    });
    return operation(new TextDecoder().decode(raw));
  }

  public async revoke(id: string, tenantId: string): Promise<void> {
    const metadata = this.#metadata.get(id);
    if (metadata === undefined || metadata.tenantId !== tenantId) return;
    await this.store.delete(metadata.secretStoreKey);
    this.#metadata.set(id, { ...metadata, status: "REVOKED" });
    await this.audit.record({
      action: "credential.revoked",
      credentialHandleId: id,
      tenantId,
    });
  }

  public metadata(id: string): Omit<CredentialMetadata, "secretStoreKey"> | undefined {
    const value = this.#metadata.get(id);
    if (value === undefined) return undefined;
    const { secretStoreKey: _secretStoreKey, ...safe } = value;
    return safe;
  }
}
