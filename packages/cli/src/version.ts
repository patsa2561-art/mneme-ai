/**
 * Single source of truth for the CLI's version string.
 *
 * Reads from this package's package.json at runtime — never hardcoded.
 * Use this everywhere a version is reported (commander `--version`,
 * MCP server identification, export bundle metadata, telemetry).
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

let cached: string | undefined;

export function getVersion(): string {
  if (cached) return cached;
  try {
    const here = dirname(fileURLToPath(import.meta.url));
    // dist/version.js → ../package.json (sits beside dist/)
    const pkg = JSON.parse(readFileSync(join(here, "..", "package.json"), "utf8")) as {
      version?: string;
    };
    cached = pkg.version ?? "0.0.0";
  } catch {
    cached = "0.0.0";
  }
  return cached;
}
