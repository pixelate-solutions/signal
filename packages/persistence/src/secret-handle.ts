import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

export async function resolveSecretHandle(handle: string): Promise<string> {
  if (handle.startsWith("env://")) {
    const name = handle.slice("env://".length);
    if (!/^[A-Z][A-Z0-9_]+$/.test(name)) throw new Error("Invalid environment secret handle.");
    const value = process.env[name];
    if (value === undefined || value.length === 0) {
      throw new Error(`Secret handle ${handle} is unavailable.`);
    }
    return value;
  }
  if (handle.startsWith("file://")) {
    const value = await readFile(fileURLToPath(handle), "utf8");
    if (value.trim().length === 0) throw new Error(`Secret handle ${handle} is empty.`);
    return value.trim();
  }
  throw new Error("Secret handles must use env:// or file://; raw secret values are rejected.");
}
