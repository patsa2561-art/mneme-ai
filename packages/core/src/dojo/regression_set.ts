/**
 * v2.23.0 — DOJO · REGRESSION SET.
 *
 * Train-on-own-failures (#B from the audit). Every claim Mneme
 * misclassified (false-positive verify, missed liar, doc/code drift)
 * gets logged as a regression-set entry. The next release's dojo run
 * replays the corpus FIRST — if any historical failure re-appears,
 * the release fails its dojo gate.
 *
 * Mneme remembers its own mistakes.
 */

import { existsSync, readFileSync, appendFileSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { createHmac, randomBytes } from "node:crypto";

const DIR = ".mneme/dojo";
const LOG = "regression.jsonl";
const KEY_FILE = "dojo.key";

export interface RegressionEntry {
  v: 1;
  id: string;
  ts: string;
  sensei: string;
  /** What claim / probe failed. */
  input: string;
  /** What verdict Mneme gave. */
  observedVerdict: string;
  /** What verdict Mneme SHOULD have given. */
  expectedVerdict: string;
  /** Human-readable note. */
  reason: string;
  /** When was this fixed (set to null until release that fixed it). */
  fixedInVersion: string | null;
  sig: string;
}

function dir(repoRoot: string): string {
  const d = join(repoRoot, DIR);
  if (!existsSync(d)) mkdirSync(d, { recursive: true });
  return d;
}

function key(repoRoot: string): string {
  const p = join(dir(repoRoot), KEY_FILE);
  if (existsSync(p)) return readFileSync(p, "utf8").trim();
  const k = randomBytes(32).toString("base64url");
  writeFileSync(p, k, "utf8");
  return k;
}

function sign(payload: string, k: string): string {
  return createHmac("sha256", k).update(payload).digest("base64url").slice(0, 22);
}

function logPath(repoRoot: string): string { return join(dir(repoRoot), LOG); }

export interface RecordRegressionOptions {
  sensei: string;
  input: string;
  observedVerdict: string;
  expectedVerdict: string;
  reason: string;
}

export function recordRegression(repoRoot: string, opts: RecordRegressionOptions): RegressionEntry {
  const k = key(repoRoot);
  const ts = new Date().toISOString();
  const id = "rg_" + randomBytes(4).toString("hex");
  const canonical = `${ts}|${opts.sensei}|${opts.input}|${opts.observedVerdict}|${opts.expectedVerdict}`;
  const sig = sign(canonical, k);
  const entry: RegressionEntry = { v: 1, id, ts, ...opts, fixedInVersion: null, sig };
  appendFileSync(logPath(repoRoot), JSON.stringify(entry) + "\n", "utf8");
  return entry;
}

export function listRegressions(repoRoot: string): RegressionEntry[] {
  const p = logPath(repoRoot);
  if (!existsSync(p)) return [];
  try {
    return readFileSync(p, "utf8").trim().split("\n").map((l) => { try { return JSON.parse(l) as RegressionEntry; } catch { return null; } }).filter((r): r is RegressionEntry => !!r);
  } catch { return []; }
}

export function listOpenRegressions(repoRoot: string): RegressionEntry[] {
  return listRegressions(repoRoot).filter((r) => r.fixedInVersion === null);
}

/** Mark a regression entry as fixed in a specific version. Rewrites
 *  the log line in place. Used when the release CI proves the
 *  regression no longer fires. */
export function markFixed(repoRoot: string, id: string, version: string): boolean {
  const all = listRegressions(repoRoot);
  const idx = all.findIndex((r) => r.id === id);
  if (idx === -1) return false;
  all[idx] = { ...all[idx]!, fixedInVersion: version };
  const k = key(repoRoot);
  // Re-seal sig over (canonical + fixedInVersion).
  const r = all[idx]!;
  const canonical = `${r.ts}|${r.sensei}|${r.input}|${r.observedVerdict}|${r.expectedVerdict}|${version}`;
  all[idx] = { ...r, sig: sign(canonical, k) };
  writeFileSync(logPath(repoRoot), all.map((x) => JSON.stringify(x)).join("\n") + "\n", "utf8");
  return true;
}

export function formatRegressions(rows: RegressionEntry[]): string {
  if (rows.length === 0) return "📜 REGRESSION SET — empty";
  const lines = [`📜 REGRESSION SET — ${rows.length} entries`, ""];
  for (const r of rows) {
    const flag = r.fixedInVersion ? `✓ fixed in v${r.fixedInVersion}` : "✗ open";
    lines.push(`  ${flag}  ${r.id}  [${r.sensei}]`);
    lines.push(`    input:    ${r.input.slice(0, 80)}`);
    lines.push(`    observed: ${r.observedVerdict}`);
    lines.push(`    expected: ${r.expectedVerdict}`);
    lines.push(`    reason:   ${r.reason}`);
  }
  return lines.join("\n");
}
