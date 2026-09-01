import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

// Standalone scripts (tsx) don't auto-load .env.local like Next.js does.
export function loadEnvFile(file = ".env.local"): void {
  const filePath = path.resolve(process.cwd(), file);
  if (!existsSync(filePath)) return;

  const content = readFileSync(filePath, "utf8");
  for (const line of content.split(/\r?\n/)) {
    const match = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/);
    if (!match || line.trim().startsWith("#")) continue;

    const [, key, raw] = match;
    let value = raw;
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    if (!(key in process.env)) {
      process.env[key] = value;
    }
  }
}
