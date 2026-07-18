import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { requiredTableNames } from "./schema.js";

describe("database migration", () => {
  it("creates every required table and enables RLS", async () => {
    const migration = await readFile(
      fileURLToPath(new URL("../migrations/0001_initial.sql", import.meta.url)),
      "utf8",
    );
    for (const table of requiredTableNames) {
      expect(migration).toContain(`create table if not exists ${table}`);
    }
    expect(migration).toContain("enable row level security");
    expect(migration).toContain("task_events_task_sequence_uq");
    expect(migration).toContain("tool_executions_task_idempotency_uq");
    expect(migration).toContain("memory_items_active_key_uq");
    expect(migration).toContain("vector_cosine_ops");
  });

  it("ships an explicitly gated reversal for ephemeral migration tests", async () => {
    const rollback = await readFile(
      fileURLToPath(new URL("../migrations/0001_initial.down.sql", import.meta.url)),
      "utf8",
    );
    expect(rollback).toContain("drop table if exists task_events cascade");
    expect(rollback).toContain("drop type if exists task_state");
  });
});
