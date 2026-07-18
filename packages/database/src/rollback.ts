import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

import postgres from "postgres";

if (process.env["ALLOW_DESTRUCTIVE_MIGRATION"] !== "true") {
  throw new Error("Rollback is restricted to explicitly marked ephemeral databases.");
}
const databaseUrl = process.env["DATABASE_URL"];
if (databaseUrl === undefined || !/(localhost|127\.0\.0\.1|postgres:5432)/.test(databaseUrl)) {
  throw new Error("Rollback target must be a local or Compose PostgreSQL endpoint.");
}

const client = postgres(databaseUrl, { max: 1 });
const migrationsUrl = new URL("../migrations/", import.meta.url);
try {
  const ledger = await client<{ present: boolean }[]>`
    select to_regclass('public.signal_schema_migrations') is not null as present
  `;
  if (ledger[0]?.present !== true) {
    console.log("No migration ledger exists; nothing to roll back.");
  } else {
    const applied = await client<{ name: string }[]>`
      select name from signal_schema_migrations order by name desc
    `;
    const rollbacks = await Promise.all(
      applied.map(async ({ name }) => {
        const downName = name.replace(/\.sql$/, ".down.sql");
        const downUrl = new URL(downName, migrationsUrl);
        return {
          downName,
          name,
          sql: await readFile(fileURLToPath(downUrl), "utf8"),
        };
      }),
    );
    for (const rollback of rollbacks) {
      await client.begin(async (transaction) => {
        await transaction.unsafe(rollback.sql);
        await transaction`delete from signal_schema_migrations where name = ${rollback.name}`;
      });
      console.log(`Applied ${rollback.downName}`);
    }
  }
} finally {
  await client.end();
}
