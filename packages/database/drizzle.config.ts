import { defineConfig } from "drizzle-kit";

export default defineConfig({
  dialect: "postgresql",
  schema: "./src/schema.ts",
  out: "./migrations/generated",
  dbCredentials: {
    url: process.env["DATABASE_URL"] ?? "postgresql://signal:signal_dev_only@localhost:5432/signal",
  },
  strict: true,
  verbose: true,
});
