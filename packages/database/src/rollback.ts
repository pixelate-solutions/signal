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
const rollbackUrl = new URL("../migrations/0001_initial.down.sql", import.meta.url);
const rollback = await readFile(fileURLToPath(rollbackUrl), "utf8");
try {
  await client.unsafe(rollback);
  console.log("Rolled back 0001_initial.sql on an authorized ephemeral database.");
} finally {
  await client.end();
}
