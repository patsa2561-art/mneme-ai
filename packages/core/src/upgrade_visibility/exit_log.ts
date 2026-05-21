/**
 * v2.21.7 — UPGRADE VISIBILITY · EXIT LOG.
 *
 * HMAC-chained log of every upgrade attempt + its exit code. Closes
 * the "silent upgrade fail" concern from the v2.21.6 AI-agent audit:
 *
 *   "exit-4294963214 = mneme upgrade ตัวเองพังเงียบๆ แล้ว pulse ก็ยังบอกว่า
 *    auto-upgrade is one tool call away."
 *
 *   - Append-only log at `.mneme/upgrade/log.jsonl`.
 *   - Every entry: ts + version-before/after + npm exit code + reason +
 *     prev sig (chain-linked, tamper-evident).
 *   - `verifyChain()` audits integrity.
 *   - `lastFailure()` surfaces the most recent non-zero exit so the
 *     pulse can mention "previous upgrade attempt failed (exit X)" —
 *     no more silent fails.
 */

import { existsSync, readFileSync, appendFileSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { createHmac, randomBytes } from "node:crypto";

const DIR = ".mneme/upgrade";
const LOG = "log.jsonl";
const KEY = "upgrade.key";

export interface UpgradeEntry {
  v: 1;
  id: string;
  ts: string;
  versionBefore: string;
  versionAfter: string | null;
  /** npm install exit code; non-zero = failure. */
  exitCode: number;
  /** Plain-English reason / what was attempted. */
  reason: string;
  /** Optional: command that was run. */
  command?: string;
  /** Optional: stderr tail for diagnostics. */
  stderrTail?: string;
  prev: string;
  sig: string;
}

function dir(repoRoot: string): string {
  const d = join(repoRoot, DIR);
  if (!existsSync(d)) mkdirSync(d, { recursive: true });
  return d;
}

function key(repoRoot: string): string {
  const p = join(dir(repoRoot), KEY);
  if (existsSync(p)) return readFileSync(p, "utf8").trim();
  const k = randomBytes(32).toString("base64url");
  writeFileSync(p, k, "utf8");
  return k;
}

function sign(payload: string, k: string): string {
  return createHmac("sha256", k).update(payload).digest("base64url").slice(0, 22);
}

function logPath(repoRoot: string): string { return join(dir(repoRoot), LOG); }

export interface RecordUpgradeOptions {
  versionBefore: string;
  versionAfter: string | null;
  exitCode: number;
  reason: string;
  command?: string;
  stderrTail?: string;
}

export function recordUpgrade(repoRoot: string, opts: RecordUpgradeOptions): UpgradeEntry {
  const k = key(repoRoot);
  const ts = new Date().toISOString();
  const id = "up_" + randomBytes(4).toString("hex");
  const existing = listUpgrades(repoRoot);
  const prev = existing.length > 0 ? existing[existing.length - 1]!.sig : "genesis";
  const canonical = `${ts}|${opts.versionBefore}|${opts.versionAfter ?? ""}|${opts.exitCode}|${opts.reason}|${prev}`;
  const sig = sign(canonical, k);
  const entry: UpgradeEntry = {
    v: 1, id, ts,
    versionBefore: opts.versionBefore,
    versionAfter: opts.versionAfter,
    exitCode: opts.exitCode,
    reason: opts.reason,
    prev, sig,
    ...(opts.command ? { command: opts.command } : {}),
    ...(opts.stderrTail ? { stderrTail: opts.stderrTail } : {}),
  };
  appendFileSync(logPath(repoRoot), JSON.stringify(entry) + "\n", "utf8");
  return entry;
}

export function listUpgrades(repoRoot: string): UpgradeEntry[] {
  const p = logPath(repoRoot);
  if (!existsSync(p)) return [];
  try {
    return readFileSync(p, "utf8").trim().split("\n").map((l) => { try { return JSON.parse(l) as UpgradeEntry; } catch { return null; } }).filter((r): r is UpgradeEntry => !!r);
  } catch { return []; }
}

export function lastFailure(repoRoot: string): UpgradeEntry | null {
  const all = listUpgrades(repoRoot);
  for (let i = all.length - 1; i >= 0; i--) {
    if (all[i]!.exitCode !== 0) return all[i]!;
  }
  return null;
}

export function lastSuccess(repoRoot: string): UpgradeEntry | null {
  const all = listUpgrades(repoRoot);
  for (let i = all.length - 1; i >= 0; i--) {
    if (all[i]!.exitCode === 0) return all[i]!;
  }
  return null;
}

export function verifyChain(repoRoot: string): { ok: boolean; brokenAt?: number; reason?: string } {
  const all = listUpgrades(repoRoot);
  if (all.length === 0) return { ok: true };
  const k = key(repoRoot);
  let lastSig = "genesis";
  for (let i = 0; i < all.length; i++) {
    const e = all[i]!;
    if (e.prev !== lastSig) return { ok: false, brokenAt: i, reason: `entry ${i} prev=${e.prev.slice(0, 8)} expected ${lastSig.slice(0, 8)}` };
    const canonical = `${e.ts}|${e.versionBefore}|${e.versionAfter ?? ""}|${e.exitCode}|${e.reason}|${e.prev}`;
    if (sign(canonical, k) !== e.sig) return { ok: false, brokenAt: i, reason: `entry ${i} signature mismatch` };
    lastSig = e.sig;
  }
  return { ok: true };
}

export function formatUpgradeLog(entries: UpgradeEntry[]): string {
  if (entries.length === 0) return "📜 UPGRADE LOG — empty";
  const lines = [`📜 UPGRADE LOG — ${entries.length} entries`, ""];
  for (const e of entries.slice(-20)) {
    const badge = e.exitCode === 0 ? "✓" : "✗";
    lines.push(`  ${badge} ${e.ts}  v${e.versionBefore} → ${e.versionAfter ?? "(failed)"}  exit=${e.exitCode}  ${e.reason}`);
    if (e.stderrTail && e.exitCode !== 0) {
      const tail = e.stderrTail.split("\n").slice(-2).join(" / ").slice(0, 200);
      lines.push(`     stderr: ${tail}`);
    }
  }
  if (entries.length > 20) lines.push(`  (showing last 20 of ${entries.length})`);
  return lines.join("\n");
}
