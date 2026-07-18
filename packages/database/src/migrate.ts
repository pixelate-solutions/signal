import { readdir, readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

import postgres from "postgres";

const databaseUrl = process.env["DATABASE_URL"];
if (databaseUrl === undefined) {
  throw new Error("DATABASE_URL is required");
}

const client = postgres(databaseUrl, { max: 1 });
const migrationsUrl = new URL("../migrations/", import.meta.url);

try {
  await client`
    create table if not exists signal_schema_migrations (
      name text primary key,
      applied_at timestamptz not null default now()
    )
  `;
  const names = (await readdir(fileURLToPath(migrationsUrl)))
    .filter((name) => /^\d{4}_.+\.sql$/.test(name) && !name.endsWith(".down.sql"))
    .sort();
  for (const name of names) {
    const alreadyApplied = await client<{ applied: boolean }[]>`
      select exists(select 1 from signal_schema_migrations where name = ${name}) as applied
    `;
    if (alreadyApplied[0]?.applied === true) continue;

    if (name === "0001_initial.sql") {
      const baseline = await client<{ present: boolean }[]>`
        select to_regclass('public.tenants') is not null as present
      `;
      if (baseline[0]?.present === true) {
        await client`insert into signal_schema_migrations (name) values (${name})`;
        console.log(`Recorded existing ${name} baseline`);
        continue;
      }
    }

    const migration = await readFile(new URL(name, migrationsUrl), "utf8");
    await client.unsafe(migration);
    await client`insert into signal_schema_migrations (name) values (${name})`;
    console.log(`Applied ${name}`);
  }
} finally {
  await client.end();
}
