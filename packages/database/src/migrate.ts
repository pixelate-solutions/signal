import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

import postgres from "postgres";

const databaseUrl = process.env["DATABASE_URL"];
if (databaseUrl === undefined) {
  throw new Error("DATABASE_URL is required");
}

const client = postgres(databaseUrl, { max: 1 });
const migrationUrl = new URL("../migrations/0001_initial.sql", import.meta.url);
const migration = await readFile(fileURLToPath(migrationUrl), "utf8");

try {
  await client.unsafe(migration);
  console.log("Applied 0001_initial.sql");
} finally {
  await client.end();
}
