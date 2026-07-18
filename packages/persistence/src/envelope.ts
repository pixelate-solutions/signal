import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
  timingSafeEqual,
} from "node:crypto";

import {
  DecryptCommand,
  GenerateDataKeyCommand,
  KMSClient,
  type KMSClientConfig,
} from "@aws-sdk/client-kms";
import postgres from "postgres";

export type EncryptedEnvelope = {
  keyId: string;
  encryptedDataKey: Uint8Array;
  nonce: Uint8Array;
  authTag: Uint8Array;
  ciphertext: Uint8Array;
  contextDigest: string;
};

export interface EnvelopeCipher {
  encrypt(plaintext: Uint8Array, context: Record<string, string>): Promise<EncryptedEnvelope>;
  decrypt(envelope: EncryptedEnvelope, context: Record<string, string>): Promise<Uint8Array>;
}

function canonicalContext(context: Record<string, string>): Buffer {
  return Buffer.from(
    JSON.stringify(
      Object.fromEntries(
        Object.entries(context).sort(([left], [right]) => left.localeCompare(right)),
      ),
    ),
  );
}

function contextDigest(context: Record<string, string>): string {
  return `sha256:${createHash("sha256").update(canonicalContext(context)).digest("hex")}`;
}

export class LocalEnvelopeCipher implements EnvelopeCipher {
  readonly #key: Buffer;

  public constructor(
    secret: string,
    private readonly keyId = "local-development-envelope-key",
  ) {
    if (process.env["NODE_ENV"] === "production") {
      throw new Error("The local envelope cipher is forbidden in production.");
    }
    if (secret.length < 24) {
      throw new Error("Local envelope secret must contain at least 24 characters.");
    }
    this.#key = createHash("sha256").update(secret).digest();
  }

  public async encrypt(
    plaintext: Uint8Array,
    context: Record<string, string>,
  ): Promise<EncryptedEnvelope> {
    const dataKey = randomBytes(32);
    const nonce = randomBytes(12);
    const aad = canonicalContext(context);
    const cipher = createCipheriv("aes-256-gcm", dataKey, nonce);
    cipher.setAAD(aad);
    const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
    const authTag = cipher.getAuthTag();

    const keyNonce = randomBytes(12);
    const keyCipher = createCipheriv("aes-256-gcm", this.#key, keyNonce);
    keyCipher.setAAD(aad);
    const wrappedKey = Buffer.concat([keyCipher.update(dataKey), keyCipher.final()]);
    const encryptedDataKey = Buffer.concat([keyNonce, keyCipher.getAuthTag(), wrappedKey]);
    dataKey.fill(0);
    return {
      keyId: this.keyId,
      encryptedDataKey,
      nonce,
      authTag,
      ciphertext,
      contextDigest: contextDigest(context),
    };
  }

  public async decrypt(
    envelope: EncryptedEnvelope,
    context: Record<string, string>,
  ): Promise<Uint8Array> {
    const expectedDigest = Buffer.from(contextDigest(context));
    const actualDigest = Buffer.from(envelope.contextDigest);
    if (
      expectedDigest.byteLength !== actualDigest.byteLength ||
      !timingSafeEqual(expectedDigest, actualDigest)
    ) {
      throw new Error("Encrypted envelope context does not match.");
    }
    const packed = Buffer.from(envelope.encryptedDataKey);
    const keyNonce = packed.subarray(0, 12);
    const keyTag = packed.subarray(12, 28);
    const wrappedKey = packed.subarray(28);
    const aad = canonicalContext(context);
    const keyDecipher = createDecipheriv("aes-256-gcm", this.#key, keyNonce);
    keyDecipher.setAAD(aad);
    keyDecipher.setAuthTag(keyTag);
    const dataKey = Buffer.concat([keyDecipher.update(wrappedKey), keyDecipher.final()]);
    try {
      const decipher = createDecipheriv("aes-256-gcm", dataKey, envelope.nonce);
      decipher.setAAD(aad);
      decipher.setAuthTag(envelope.authTag);
      return Buffer.concat([decipher.update(envelope.ciphertext), decipher.final()]);
    } finally {
      dataKey.fill(0);
    }
  }
}

export class AwsKmsEnvelopeCipher implements EnvelopeCipher {
  readonly #client: KMSClient;

  public constructor(
    private readonly keyId: string,
    config: KMSClientConfig = {},
  ) {
    this.#client = new KMSClient(config);
  }

  public async encrypt(
    plaintext: Uint8Array,
    context: Record<string, string>,
  ): Promise<EncryptedEnvelope> {
    const generated = await this.#client.send(
      new GenerateDataKeyCommand({
        KeyId: this.keyId,
        KeySpec: "AES_256",
        EncryptionContext: context,
      }),
    );
    if (generated.Plaintext === undefined || generated.CiphertextBlob === undefined) {
      throw new Error("KMS did not return an envelope data key.");
    }
    const dataKey = Buffer.from(generated.Plaintext);
    const nonce = randomBytes(12);
    const cipher = createCipheriv("aes-256-gcm", dataKey, nonce);
    cipher.setAAD(canonicalContext(context));
    try {
      const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
      return {
        keyId: generated.KeyId ?? this.keyId,
        encryptedDataKey: Uint8Array.from(generated.CiphertextBlob),
        nonce,
        authTag: cipher.getAuthTag(),
        ciphertext,
        contextDigest: contextDigest(context),
      };
    } finally {
      dataKey.fill(0);
    }
  }

  public async decrypt(
    envelope: EncryptedEnvelope,
    context: Record<string, string>,
  ): Promise<Uint8Array> {
    if (contextDigest(context) !== envelope.contextDigest) {
      throw new Error("Encrypted envelope context does not match.");
    }
    const decrypted = await this.#client.send(
      new DecryptCommand({
        KeyId: envelope.keyId,
        CiphertextBlob: envelope.encryptedDataKey,
        EncryptionContext: context,
      }),
    );
    if (decrypted.Plaintext === undefined) throw new Error("KMS could not decrypt the data key.");
    const dataKey = Buffer.from(decrypted.Plaintext);
    try {
      const decipher = createDecipheriv("aes-256-gcm", dataKey, envelope.nonce);
      decipher.setAAD(canonicalContext(context));
      decipher.setAuthTag(envelope.authTag);
      return Buffer.concat([decipher.update(envelope.ciphertext), decipher.final()]);
    } finally {
      dataKey.fill(0);
    }
  }
}

function parseSecretKey(key: string): { tenantId: string; recordId: string } {
  const match = /^signal\/(ten_[a-zA-Z0-9_-]+)\/(.+)$/.exec(key);
  if (match?.[1] === undefined || match[2] === undefined) {
    throw new Error("Secret keys must be tenant-scoped under signal/<tenant>/<id>.");
  }
  return { tenantId: match[1], recordId: key };
}

export class PostgresEnvelopeSecretStore {
  readonly #client: ReturnType<typeof postgres>;

  public constructor(
    databaseUrl: string,
    private readonly cipher: EnvelopeCipher,
  ) {
    this.#client = postgres(databaseUrl, {
      max: 10,
      idle_timeout: 20,
      connect_timeout: 10,
      prepare: false,
    });
  }

  public async put(key: string, plaintext: Uint8Array): Promise<void> {
    const { tenantId, recordId } = parseSecretKey(key);
    const context = { tenantId, recordId, purpose: "signal-credential" };
    const envelope = await this.cipher.encrypt(plaintext, context);
    await this.#client.begin(async (sql) => {
      await sql`select set_config('app.tenant_id', ${tenantId}, true)`;
      await sql`
        insert into encrypted_secrets (
          id, tenant_id, key_id, encrypted_data_key, nonce, auth_tag, ciphertext,
          context_digest, created_at, updated_at
        ) values (
          ${recordId}, ${tenantId}, ${envelope.keyId}, ${envelope.encryptedDataKey},
          ${envelope.nonce}, ${envelope.authTag}, ${envelope.ciphertext},
          ${envelope.contextDigest}, now(), now()
        )
        on conflict (id) do update
        set key_id = excluded.key_id,
            encrypted_data_key = excluded.encrypted_data_key,
            nonce = excluded.nonce,
            auth_tag = excluded.auth_tag,
            ciphertext = excluded.ciphertext,
            context_digest = excluded.context_digest,
            updated_at = now()
      `;
    });
  }

  public async get(key: string): Promise<Uint8Array | undefined> {
    const { tenantId, recordId } = parseSecretKey(key);
    const rows = await this.#client.begin(async (sql) => {
      await sql`select set_config('app.tenant_id', ${tenantId}, true)`;
      return sql<
        {
          key_id: string;
          encrypted_data_key: Uint8Array;
          nonce: Uint8Array;
          auth_tag: Uint8Array;
          ciphertext: Uint8Array;
          context_digest: string;
        }[]
      >`
        select key_id, encrypted_data_key, nonce, auth_tag, ciphertext, context_digest
        from encrypted_secrets where id = ${recordId} and tenant_id = ${tenantId}
      `;
    });
    const row = rows[0];
    if (row === undefined) return undefined;
    return this.cipher.decrypt(
      {
        keyId: row.key_id,
        encryptedDataKey: row.encrypted_data_key,
        nonce: row.nonce,
        authTag: row.auth_tag,
        ciphertext: row.ciphertext,
        contextDigest: row.context_digest,
      },
      { tenantId, recordId, purpose: "signal-credential" },
    );
  }

  public async delete(key: string): Promise<void> {
    const { tenantId, recordId } = parseSecretKey(key);
    await this.#client.begin(async (sql) => {
      await sql`select set_config('app.tenant_id', ${tenantId}, true)`;
      await sql`delete from encrypted_secrets where id = ${recordId} and tenant_id = ${tenantId}`;
    });
  }

  public async close(): Promise<void> {
    await this.#client.end({ timeout: 5 });
  }
}
