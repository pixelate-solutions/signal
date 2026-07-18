import { existsSync, realpathSync } from "node:fs";
import { relative, resolve } from "node:path";

const repositoryRoot = realpathSync(resolve(import.meta.dirname, ".."));
const rawPath = process.env.GENERATED_PATH ?? "";
if (rawPath.length === 0) throw new Error("GENERATED_PATH is required.");
const candidate = resolve(repositoryRoot, rawPath);
if (!existsSync(candidate)) throw new Error("Generated capability path does not exist.");
const scoped = relative(resolve(repositoryRoot, "integrations/generated"), realpathSync(candidate));
if (scoped.startsWith("..") || scoped === "" || scoped.startsWith("/")) {
  throw new Error("Generated releases must be scoped below integrations/generated/.");
}
const manifest = resolve(candidate, "package.json");
if (!existsSync(manifest)) throw new Error("Generated capability package.json is required.");
process.stdout.write(`Generated capability scope verified: integrations/generated/${scoped}\n`);
