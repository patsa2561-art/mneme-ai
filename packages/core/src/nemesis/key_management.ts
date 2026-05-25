/**
 * v2.47.0 — NEMESIS HMAC KEY MANAGEMENT.
 *
 * Production-grade key resolution + WARN-LOUD on default key usage so
 * users in production never accidentally rely on the public default
 * (which an attacker who reads our source can forge against).
 *
 * Resolution order:
 *   1. process.env.MNEME_NEMESIS_KEY    (highest priority; production)
 *   2. file:  ${repoRoot}/.mneme/nemesis/hmac.key   (per-repo override)
 *   3. file:  ~/.mneme/nemesis/hmac.key            (per-user override)
 *   4. DEFAULT_KEY_INSECURE              (last resort; WARN logged)
 *
 * The result is cached for the process lifetime to avoid repeated
 * filesystem reads.
 */

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";
import { randomBytes } from "node:crypto";

const DEFAULT_KEY_INSECURE = "MNEME-NEMESIS-DEFAULT-KEY-v2.46-INSECURE";

export type KeySource = "env" | "repo-file" | "user-file" | "default-insecure";

export interface KeyResolution {
  key: string;
  source: KeySource;
  /** True when source is default-insecure (production should override). */
  insecureWarning: boolean;
  /** User-facing message describing what to do for production. */
  message: string;
}

let _cached: KeyResolution | null = null;
let _warned = false;

export function resolveHmacKey(repoRoot?: string): KeyResolution {
  if (_cached) return _cached;
  // 1. env var
  const envKey = process.env["MNEME_NEMESIS_KEY"];
  if (typeof envKey === "string" && envKey.length >= 16) {
    _cached = {
      key: envKey, source: "env", insecureWarning: false,
      message: "HMAC key loaded from MNEME_NEMESIS_KEY env var.",
    };
    return _cached;
  }
  // 2. repo file
  if (repoRoot) {
    const p = join(repoRoot, ".mneme", "nemesis", "hmac.key");
    if (existsSync(p)) {
      try {
        const k = readFileSync(p, "utf8").trim();
        if (k.length >= 16) {
          _cached = {
            key: k, source: "repo-file", insecureWarning: false,
            message: `HMAC key loaded from ${p}`,
          };
          return _cached;
        }
      } catch { /* fall through */ }
    }
  }
  // 3. user file
  const userPath = join(homedir(), ".mneme", "nemesis", "hmac.key");
  if (existsSync(userPath)) {
    try {
      const k = readFileSync(userPath, "utf8").trim();
      if (k.length >= 16) {
        _cached = {
          key: k, source: "user-file", insecureWarning: false,
          message: `HMAC key loaded from ${userPath}`,
        };
        return _cached;
      }
    } catch { /* fall through */ }
  }
  // 4. default (INSECURE)
  if (!_warned) {
    _warned = true;
    // Warn on stderr so dev sees it; production CI catches it.
    try {
      process.stderr.write(
        "⚠ NEMESIS HMAC key falling back to public default (INSECURE).\n" +
        "   For production: set MNEME_NEMESIS_KEY env var (≥16 chars random) OR\n" +
        "   write a key to .mneme/nemesis/hmac.key (≥16 chars random).\n" +
        "   Generate one: node -e \"console.log(require('crypto').randomBytes(32).toString('hex'))\"\n"
      );
    } catch { /* */ }
  }
  _cached = {
    key: DEFAULT_KEY_INSECURE, source: "default-insecure", insecureWarning: true,
    message: "HMAC key fell back to INSECURE default. Set MNEME_NEMESIS_KEY or .mneme/nemesis/hmac.key for production.",
  };
  return _cached;
}

/** Generate a fresh 32-byte hex key suitable for production use. */
export function generateProductionKey(): string {
  return randomBytes(32).toString("hex");
}

export function __resetKeyCacheForTest(): void { _cached = null; _warned = false; }
