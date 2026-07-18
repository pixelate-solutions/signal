import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";

import * as schema from "./schema.js";

export function createDatabase(url: string) {
  const client = postgres(url, {
    max: 20,
    idle_timeout: 20,
    connect_timeout: 10,
    prepare: false,
  });
  return {
    client,
    db: drizzle(client, { schema }),
  };
}

export async function withTenant<T>(
  client: postgres.Sql,
  tenantId: string,
  operation: (transaction: postgres.TransactionSql) => Promise<T>,
): Promise<T> {
  const result = await client.begin(async (transaction) => {
    await transaction`select set_config('app.tenant_id', ${tenantId}, true)`;
    return operation(transaction);
  });
  // postgres.js unwraps callback arrays in its public type. Tenant operations in this
  // helper return a single domain value, so preserve that value's generic type here.
  return result as unknown as T;
}
