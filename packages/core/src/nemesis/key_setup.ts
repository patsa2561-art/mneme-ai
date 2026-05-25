/**
 * v2.53.0 — HMAC KEY SETUP WIZARD + STRICT mode.
 *
 * Closes P0-1 from the v2.52 session audit: pre-v2.53 NEMESIS warned LOUD
 * when falling back to the public default key, but didn't auto-fix it
 * + didn't refuse to operate. Result: every developer who ignored the
 * warning shipped HMAC receipts an attacker can forge.
 *
 * v2.53 protocol:
 *   1. First-run wizard auto-generates a 32-byte random key + writes it
 *      to .mneme/nemesis/hmac.key with 0o600 perms (owner-only).
 *   2. MNEME_NEMESIS_STRICT=1 env var → key_management refuses to return
 *      the default-insecure key (throws instead). For CI / production /
 *      regulated environments.
 *   3. Idempotent: re-running detects existing key + skips generation.
 *
 * Defensive: never throws on filesystem errors (best-effort), only the
 * STRICT-mode refusal is intentional.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync, statSync, chmodSync } from "node:fs";
import { join } from "node:path";
import { randomBytes } from "node:crypto";
import { homedir } from "node:os";

const REPO_KEY_REL = ".mneme/nemesis/hmac.key";
const USER_KEY_REL = ".mneme/nemesis/hmac.key";

export interface KeyWizardResult {
  ok: boolean;
  action: "generated-repo" | "generated-user" | "already-present" | "skipped" | "failed";
  path?: string;
  /** Length of the resolved key (or 0 on fail). */
  keyLength: number;
  reason: string;
}

export interface KeyWizardOpts {
  repoRoot: string;
  /** "repo" → write to <repoRoot>/.mneme/nemesis/hmac.key (default).
   *  "user" → write to ~/.mneme/nemesis/hmac.key (cross-repo). */
  target?: "repo" | "user";
  /** Re-generate even if a key already exists. Default false. */
  force?: boolean;
  /** Don't write — only compute the would-be path + key length. */
  dryRun?: boolean;
}

function keyPath(opts: KeyWizardOpts): string {
  if (opts.target === "user") return join(homedir(), USER_KEY_REL);
  return join(opts.repoRoot, REPO_KEY_REL);
}

function envHasValidKey(): boolean {
  const k = process.env["MNEME_NEMESIS_KEY"];
  return typeof k === "string" && k.length >= 16;
}

/**
 * Run the key setup wizard. Idempotent; never overwrites an existing
 * key unless force=true. Returns structured outcome.
 */
export function runKeyWizard(opts: KeyWizardOpts): KeyWizardResult {
  try {
    if (envHasValidKey() && !opts.force) {
      const env = process.env["MNEME_NEMESIS_KEY"]!;
      return {
        ok: true,
        action: "skipped",
        keyLength: env.length,
        reason: "MNEME_NEMESIS_KEY already set — no file action needed",
      };
    }
    const p = keyPath(opts);
    if (existsSync(p) && !opts.force) {
      try {
        const k = readFileSync(p, "utf8").trim();
        if (k.length >= 16) {
          return {
            ok: true,
            action: "already-present",
            path: p,
            keyLength: k.length,
            reason: `existing key at ${p} (${k.length} chars)`,
          };
        }
      } catch { /* fall through to regenerate */ }
    }
    if (opts.dryRun) {
      return {
        ok: true,
        action: opts.target === "user" ? "generated-user" : "generated-repo",
        path: p,
        keyLength: 64,
        reason: `dry-run: would write a fresh 64-char hex key to ${p}`,
      };
    }
    // Generate + write
    const dir = p.replace(/[\/\\][^\/\\]+$/, "");
    try { mkdirSync(dir, { recursive: true }); } catch { /* ok */ }
    const key = randomBytes(32).toString("hex");
    writeFileSync(p, key + "\n", { mode: 0o600 });
    // Best-effort chmod (Windows ignores)
    try { chmodSync(p, 0o600); } catch { /* */ }
    return {
      ok: true,
      action: opts.target === "user" ? "generated-user" : "generated-repo",
      path: p,
      keyLength: key.length,
      reason: `generated fresh 64-char hex key at ${p} (mode 0600)`,
    };
  } catch (e) {
    return {
      ok: false,
      action: "failed",
      keyLength: 0,
      reason: `wizard failed: ${(e as Error).message}`,
    };
  }
}

/**
 * Check key file permissions (Unix only). Returns warning on world-readable
 * files. On Windows, returns ok=true with note since chmod is a no-op.
 */
export function checkKeyPermissions(repoRoot: string): { ok: boolean; mode?: number; reason: string } {
  const p = join(repoRoot, REPO_KEY_REL);
  if (!existsSync(p)) return { ok: true, reason: "no key file present" };
  try {
    const s = statSync(p);
    const mode = s.mode & 0o777;
    if (process.platform === "win32") {
      return { ok: true, mode, reason: "Windows: chmod is a no-op; key access controlled by NTFS ACLs" };
    }
    // Owner-only is the goal: 0o600
    if (mode === 0o600 || mode === 0o400) {
      return { ok: true, mode, reason: `mode ${mode.toString(8)} — owner-only (correct)` };
    }
    return { ok: false, mode, reason: `mode ${mode.toString(8)} is too permissive; should be 600 (owner read/write only)` };
  } catch (e) {
    return { ok: false, reason: `stat failed: ${(e as Error).message}` };
  }
}

/**
 * STRICT MODE check: throws when the user is operating with a
 * default-insecure HMAC key AND has opted into strict enforcement
 * via MNEME_NEMESIS_STRICT=1. Call this from any code path that
 * issues forensic-grade receipts (EU stamp / cli-activity / SIBYL).
 *
 * Non-strict mode: returns { ok: false, message } so caller can decide.
 */
export function strictKeyCheck(repoRoot: string): { ok: boolean; usingDefault: boolean; message: string } {
  // Resolve via the same path key_management uses.
  const env = process.env["MNEME_NEMESIS_KEY"];
  if (typeof env === "string" && env.length >= 16) {
    return { ok: true, usingDefault: false, message: "MNEME_NEMESIS_KEY env var set" };
  }
  const repo = join(repoRoot, REPO_KEY_REL);
  if (existsSync(repo)) {
    try {
      const k = readFileSync(repo, "utf8").trim();
      if (k.length >= 16) return { ok: true, usingDefault: false, message: `repo key at ${repo}` };
    } catch { /* */ }
  }
  const user = join(homedir(), USER_KEY_REL);
  if (existsSync(user)) {
    try {
      const k = readFileSync(user, "utf8").trim();
      if (k.length >= 16) return { ok: true, usingDefault: false, message: `user key at ${user}` };
    } catch { /* */ }
  }
  const strict = process.env["MNEME_NEMESIS_STRICT"] === "1";
  if (strict) {
    throw new Error(
      "STRICT MODE: MNEME_NEMESIS_STRICT=1 set + no production key configured. " +
      `Run: node -e "require('@mneme-ai/core').nemesis.runKeyWizard({repoRoot:'${repoRoot}'})" ` +
      "OR set MNEME_NEMESIS_KEY env var (≥16 chars).",
    );
  }
  return {
    ok: false,
    usingDefault: true,
    message: "using default-insecure HMAC key — receipts are forgeable. Set MNEME_NEMESIS_STRICT=1 to enforce.",
  };
}
