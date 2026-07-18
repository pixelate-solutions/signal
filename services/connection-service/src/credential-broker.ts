import { createCipheriv, createDecipheriv, randomBytes, randomUUID } from "node:crypto";

import {
  InMemoryTenantRecordStore,
  type TenantRecordStore,
  type TenantRecordTransaction,
} from "@signal/persistence";

const CREDENTIAL_NAMESPACE = "connection.credentials";

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
  secretType: "oauth_refresh_token" | "api_key" | "password" | "browser_state" | "push_token";
  secretStoreKey: string;
  status: "ACTIVE" | "REVOKED";
  createdAt: string;
  updatedAt: string;
};

export type CredentialAudit = {
  record(entry: {
    action: "credential.created" | "credential.used" | "credential.rotated" | "credential.revoked";
    credentialHandleId: string;
    tenantId: string;
    taskId?: string;
    adapter?: string;
  }): Promise<void>;
};

const noAudit: CredentialAudit = { record: async () => undefined };

export class CredentialBroker {
  public constructor(
    private readonly store: SecretStore,
    private readonly audit: CredentialAudit = noAudit,
    private readonly records: TenantRecordStore = new InMemoryTenantRecordStore(),
  ) {}

  public async create(
    input: Omit<CredentialMetadata, "id" | "secretStoreKey" | "status" | "createdAt" | "updatedAt">,
    plaintext: string,
  ): Promise<string> {
    const id = `cred_${randomUUID().replaceAll("-", "")}`;
    const secretStoreKey = `signal/${input.tenantId}/${id}`;
    await this.store.put(secretStoreKey, new TextEncoder().encode(plaintext));
    const now = new Date().toISOString();
    await this.records.runExclusive(input.tenantId, async (transaction) => {
      await transaction.put(CREDENTIAL_NAMESPACE, id, {
        ...input,
        id,
        secretStoreKey,
        status: "ACTIVE",
        createdAt: now,
        updatedAt: now,
      } satisfies CredentialMetadata);
    });
    await this.audit.record({
      action: "credential.created",
      credentialHandleId: id,
      tenantId: input.tenantId,
    });
    return id;
  }

  public async available(id: string, tenantId: string): Promise<boolean> {
    return this.records.runExclusive(tenantId, async (transaction) => {
      const metadata = await transaction.get<CredentialMetadata>(CREDENTIAL_NAMESPACE, id);
      return metadata?.status === "ACTIVE";
    });
  }

  public async withCredential<T>(
    id: string,
    context: { tenantId: string; taskId: string; adapter: string },
    operation: (plaintext: string) => Promise<T>,
  ): Promise<T> {
    const metadata = await this.records.runExclusive(context.tenantId, (transaction) =>
      this.requireActive(transaction, id),
    );
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
    try {
      return await operation(new TextDecoder().decode(raw));
    } finally {
      raw.fill(0);
    }
  }

  public async rotate(id: string, tenantId: string, plaintext: string): Promise<void> {
    const metadata = await this.records.runExclusive(tenantId, (transaction) =>
      this.requireActive(transaction, id),
    );
    await this.store.put(metadata.secretStoreKey, new TextEncoder().encode(plaintext));
    await this.records.runExclusive(tenantId, async (transaction) => {
      await transaction.put(CREDENTIAL_NAMESPACE, id, {
        ...metadata,
        updatedAt: new Date().toISOString(),
      } satisfies CredentialMetadata);
    });
    await this.audit.record({
      action: "credential.rotated",
      credentialHandleId: id,
      tenantId,
    });
  }

  public async revoke(id: string, tenantId: string): Promise<void> {
    const metadata = await this.records.runExclusive(tenantId, (transaction) =>
      transaction.get<CredentialMetadata>(CREDENTIAL_NAMESPACE, id),
    );
    if (metadata === undefined) return;
    await this.store.delete(metadata.secretStoreKey);
    await this.records.runExclusive(tenantId, async (transaction) => {
      await transaction.put(CREDENTIAL_NAMESPACE, id, {
        ...metadata,
        status: "REVOKED",
        updatedAt: new Date().toISOString(),
      } satisfies CredentialMetadata);
    });
    await this.audit.record({
      action: "credential.revoked",
      credentialHandleId: id,
      tenantId,
    });
  }

  public async metadata(
    id: string,
    tenantId: string,
  ): Promise<Omit<CredentialMetadata, "secretStoreKey"> | undefined> {
    const value = await this.records.runExclusive(tenantId, (transaction) =>
      transaction.get<CredentialMetadata>(CREDENTIAL_NAMESPACE, id),
    );
    if (value === undefined) return undefined;
    const { secretStoreKey: _secretStoreKey, ...safe } = value;
    return safe;
  }

  private async requireActive(
    transaction: TenantRecordTransaction,
    id: string,
  ): Promise<CredentialMetadata> {
    const metadata = await transaction.get<CredentialMetadata>(CREDENTIAL_NAMESPACE, id);
    if (metadata === undefined || metadata.status !== "ACTIVE") {
      throw new Error("CONNECTION_REQUIRED: credential handle is unavailable.");
    }
    return metadata;
  }
}
