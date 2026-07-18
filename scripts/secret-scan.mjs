import { readFile, readdir } from "node:fs/promises";
import { extname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../", import.meta.url));
const textExtensions = new Set([
  ".ts",
  ".tsx",
  ".js",
  ".mjs",
  ".json",
  ".yaml",
  ".yml",
  ".md",
  ".sql",
  ".py",
  ".toml",
  ".tf",
  ".rego",
]);
const ignoredDirectories = new Set([
  "node_modules",
  ".git",
  "dist",
  "build",
  "coverage",
  ".turbo",
  ".terraform",
  ".venv",
  ".mypy_cache",
  ".pytest_cache",
  ".ruff_cache",
]);
const ignoredFiles = new Set([
  ".env.example",
  "pnpm-lock.yaml",
  "docs/FRD.md",
  "docs/CODEX_MASTER_PROMPT.md",
  "packages/test-fixtures/src/index.ts",
  "packages/observability/src/index.ts",
  "packages/observability/src/redaction.test.ts",
  "services/connection-service/src/connection.test.ts",
]);

const patterns = [
  /\bsk-[A-Za-z0-9]{20,}\b/,
  /\bghp_[A-Za-z0-9]{30,}\b/,
  /\bAIza[0-9A-Za-z_-]{30,}\b/,
  /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/,
  /(?:api[_-]?key|client[_-]?secret|refresh[_-]?token)\s*[:=]\s*["'][^"'\s]{16,}["']/i,
];

async function walk(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const result = [];
  for (const entry of entries) {
    if (ignoredDirectories.has(entry.name)) continue;
    const path = join(directory, entry.name);
    if (entry.isDirectory()) result.push(...(await walk(path)));
    else result.push(path);
  }
  return result;
}

const findings = [];
for (const path of await walk(root)) {
  const name = relative(root, path);
  if (ignoredFiles.has(name) || !textExtensions.has(extname(path))) continue;
  const source = await readFile(path, "utf8");
  for (const pattern of patterns) {
    if (pattern.test(source)) findings.push(`${name}: matched ${pattern.source}`);
  }
}

if (findings.length > 0) {
  console.error(findings.join("\n"));
  process.exitCode = 1;
} else {
  console.log("No committed secret patterns detected.");
}
