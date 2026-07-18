import postgres from "postgres";

/* eslint-disable @typescript-eslint/no-unnecessary-type-parameters -- Record callers supply the schema-specific type decoded from durable JSON. */

export type RecordWriteOptions = {
  expiresAt?: Date | null;
};

export interface TenantRecordTransaction {
  get<T>(namespace: string, recordId: string): Promise<T | undefined>;
  list<T>(namespace: string): Promise<T[]>;
  listEntries<T>(namespace: string): Promise<{ id: string; value: T; expiresAt: string | null }[]>;
  put(
    namespace: string,
    recordId: string,
    value: unknown,
    options?: RecordWriteOptions,
  ): Promise<void>;
  remove(namespace: string, recordId: string): Promise<void>;
}

export interface TenantRecordStore {
  runExclusive<T>(
    tenantId: string,
    operation: (transaction: TenantRecordTransaction) => Promise<T>,
  ): Promise<T>;
  listTenantIds(): Promise<string[]>;
  purgeExpired(): Promise<number>;
  close?(): Promise<void>;
}

type StoredRecord = {
  value: unknown;
  expiresAt: Date | null;
};

function recordKey(tenantId: string, namespace: string, recordId: string): string {
  return `${tenantId}\u0000${namespace}\u0000${recordId}`;
}

function clone<T>(value: T): T {
  return structuredClone(value);
}

export class InMemoryTenantRecordStore implements TenantRecordStore {
  readonly #records = new Map<string, StoredRecord>();
  readonly #tails = new Map<string, Promise<void>>();

  public async runExclusive<T>(
    tenantId: string,
    operation: (transaction: TenantRecordTransaction) => Promise<T>,
  ): Promise<T> {
    let release: () => void = () => undefined;
    const predecessor = this.#tails.get(tenantId) ?? Promise.resolve();
    this.#tails.set(
      tenantId,
      new Promise<void>((resolve) => {
        release = resolve;
      }),
    );
    await predecessor;
    const transaction: TenantRecordTransaction = {
      get: async <V>(namespace: string, recordId: string) => {
        const key = recordKey(tenantId, namespace, recordId);
        const stored = this.#records.get(key);
        if (stored === undefined) return undefined;
        if (stored.expiresAt !== null && stored.expiresAt <= new Date()) {
          this.#records.delete(key);
          return undefined;
        }
        return clone(stored.value) as V;
      },
      list: async <V>(namespace: string) => {
        const prefix = `${tenantId}\u0000${namespace}\u0000`;
        const now = new Date();
        const values: V[] = [];
        for (const [key, stored] of this.#records) {
          if (!key.startsWith(prefix)) continue;
          if (stored.expiresAt !== null && stored.expiresAt <= now) {
            this.#records.delete(key);
            continue;
          }
          values.push(clone(stored.value) as V);
        }
        return values;
      },
      listEntries: async <V>(namespace: string) => {
        const prefix = `${tenantId}\u0000${namespace}\u0000`;
        const now = new Date();
        const entries: { id: string; value: V; expiresAt: string | null }[] = [];
        for (const [key, stored] of this.#records) {
          if (!key.startsWith(prefix)) continue;
          if (stored.expiresAt !== null && stored.expiresAt <= now) {
            this.#records.delete(key);
            continue;
          }
          entries.push({
            id: key.slice(prefix.length),
            value: clone(stored.value) as V,
            expiresAt: stored.expiresAt?.toISOString() ?? null,
          });
        }
        return entries;
      },
      put: async (
        namespace: string,
        recordId: string,
        value: unknown,
        options?: RecordWriteOptions,
      ) => {
        this.#records.set(recordKey(tenantId, namespace, recordId), {
          value: clone(value),
          expiresAt: options?.expiresAt ?? null,
        });
      },
      remove: async (namespace: string, recordId: string) => {
        this.#records.delete(recordKey(tenantId, namespace, recordId));
      },
    };
    try {
      return await operation(transaction);
    } finally {
      release();
    }
  }

  public async listTenantIds(): Promise<string[]> {
    const tenantIds = [...this.#records.keys()]
      .map((key) => key.split("\u0000", 1)[0])
      .filter((tenantId): tenantId is string => tenantId !== undefined);
    return [...new Set(tenantIds)].sort();
  }

  public async purgeExpired(): Promise<number> {
    const now = new Date();
    let removed = 0;
    for (const [key, record] of this.#records) {
      if (record.expiresAt !== null && record.expiresAt <= now) {
        this.#records.delete(key);
        removed += 1;
      }
    }
    return removed;
  }
}

export class PostgresTenantRecordStore implements TenantRecordStore {
  readonly #client: ReturnType<typeof postgres>;

  public constructor(databaseUrl: string) {
    this.#client = postgres(databaseUrl, {
      max: 20,
      idle_timeout: 20,
      connect_timeout: 10,
      prepare: false,
    });
  }

  public async runExclusive<T>(
    tenantId: string,
    operation: (transaction: TenantRecordTransaction) => Promise<T>,
  ): Promise<T> {
    const result = await this.#client.begin(async (sql) => {
      await sql`select pg_advisory_xact_lock(hashtextextended(${tenantId}, 1))`;
      await sql`select set_config('app.tenant_id', ${tenantId}, true)`;
      const transaction: TenantRecordTransaction = {
        get: async <V>(namespace: string, recordId: string) => {
          const rows = await sql<{ data: unknown }[]>`
            select data from service_records
            where tenant_id = ${tenantId}
              and namespace = ${namespace}
              and record_id = ${recordId}
              and (expires_at is null or expires_at > now())
          `;
          return rows[0]?.data as V | undefined;
        },
        list: async <V>(namespace: string) => {
          const rows = await sql<{ data: unknown }[]>`
            select data from service_records
            where tenant_id = ${tenantId}
              and namespace = ${namespace}
              and (expires_at is null or expires_at > now())
            order by updated_at desc, record_id
          `;
          return rows.map((row) => row.data as V);
        },
        listEntries: async <V>(namespace: string) => {
          const rows = await sql<{ record_id: string; data: unknown; expires_at: Date | null }[]>`
            select record_id, data, expires_at from service_records
            where tenant_id = ${tenantId}
              and namespace = ${namespace}
              and (expires_at is null or expires_at > now())
            order by updated_at desc, record_id
          `;
          return rows.map((row) => ({
            id: row.record_id,
            value: row.data as V,
            expiresAt: row.expires_at?.toISOString() ?? null,
          }));
        },
        put: async (
          namespace: string,
          recordId: string,
          value: unknown,
          options?: RecordWriteOptions,
        ) => {
          const json = value as unknown as postgres.JSONValue;
          const expiresAt = options?.expiresAt ?? null;
          await sql`
            insert into service_records (
              tenant_id, namespace, record_id, data, expires_at, revision, created_at, updated_at
            ) values (
              ${tenantId}, ${namespace}, ${recordId}, ${sql.json(json)}, ${expiresAt}, 1, now(), now()
            )
            on conflict (tenant_id, namespace, record_id) do update
            set data = excluded.data,
                expires_at = excluded.expires_at,
                revision = service_records.revision + 1,
                updated_at = now()
          `;
        },
        remove: async (namespace: string, recordId: string) => {
          await sql`
            delete from service_records
            where tenant_id = ${tenantId} and namespace = ${namespace} and record_id = ${recordId}
          `;
        },
      };
      return { value: await operation(transaction) };
    });
    return result.value;
  }

  public async close(): Promise<void> {
    await this.#client.end({ timeout: 5 });
  }

  public async listTenantIds(): Promise<string[]> {
    const rows = await this.#client<{ id: string }[]>`
      select id from tenants where deleted_at is null and status <> 'deleted' order by id
    `;
    return rows.map((row) => row.id);
  }

  public async purgeExpired(): Promise<number> {
    const rows = await this.#client<{ tenant_id: string }[]>`
      delete from service_records where expires_at is not null and expires_at <= now()
      returning tenant_id
    `;
    return rows.length;
  }
}
