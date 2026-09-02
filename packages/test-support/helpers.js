import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

export const ADMIN_KEY = "test-admin-key-that-is-at-least-32-characters";
export const BASE_URL = "https://usage.example.com";

export async function loadUsageSnapshot() {
  const fixturePath = fileURLToPath(new URL("../shared/test/fixtures/usage-snapshot.json", import.meta.url));
  return JSON.parse(await readFile(fixturePath, "utf8"));
}

export function captureStdout() {
  const chunks = [];
  const original = process.stdout.write.bind(process.stdout);
  process.stdout.write = (chunk) => {
    chunks.push(String(chunk));
    return true;
  };
  return {
    output: () => chunks.join(""),
    restore: () => {
      process.stdout.write = original;
    },
  };
}
