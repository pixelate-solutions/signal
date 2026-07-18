import { readFile, readdir } from "node:fs/promises";
import { extname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../", import.meta.url));
const allowedExtensions = new Set([".ts", ".tsx", ".js", ".mjs"]);
const ignored = new Set(["node_modules", "dist", "build", "coverage", ".git", ".turbo"]);

async function files(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const nested = await Promise.all(
    entries
      .filter((entry) => !ignored.has(entry.name))
      .map(async (entry) => {
        const path = join(directory, entry.name);
        return entry.isDirectory() ? files(path) : [path];
      }),
  );
  return nested.flat();
}

const violations = [];
for (const path of await files(root)) {
  if (!allowedExtensions.has(extname(path))) continue;
  const name = relative(root, path);
  const source = await readFile(path, "utf8");

  if (
    name.startsWith("integrations/generated/") &&
    /@signal\/(?:auth-sdk|policy-client|database|connection-service)|services\/(?:api|connection-service)/.test(
      source,
    )
  ) {
    violations.push(
      `${name}: generated capabilities cannot import protected-kernel implementation`,
    );
  }
  if (
    name.startsWith("apps/mobile/") &&
    /META_MODEL_API_KEY|COMPOSIO_API_KEY|S3_SECRET_ACCESS_KEY|GOOGLE_OAUTH_CLIENT_SECRET/.test(
      source,
    )
  ) {
    violations.push(`${name}: mobile code references a server-side secret variable`);
  }
  if (
    name.startsWith("services/workflow-worker/src/workflows") &&
    /\b(?:fetch|Date\.now|Math\.random|process\.env|node:)/.test(source)
  ) {
    violations.push(`${name}: workflow code contains a nondeterministic or network primitive`);
  }
}

if (violations.length > 0) {
  console.error(violations.join("\n"));
  process.exitCode = 1;
} else {
  console.log("Protected-boundary checks passed.");
}
