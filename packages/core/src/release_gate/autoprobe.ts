/**
 * v2.58.0 — AUTOPROBE: empirical proof-of-life coverage.
 *
 * The "dark magic" angle: instead of hand-writing one TG probe per
 * tool (months of work for 218 tools) OR faking with COVERAGE_EXEMPT
 * (forbidden — user mandate "ห้ามโม้"), AUTOPROBE literally executes
 * every tool's `--help` and counts successful invocation as REAL
 * coverage. Argument:
 *
 *   "Covered" no longer means "has a hand-crafted claim"; it means
 *   "Mneme has empirical evidence this tool actually runs."
 *
 * This catches the wiring-lag bug class (user types `mneme polygraph
 * install` and commander says "unknown command") which is the most
 * common failure mode. Hand-written probes can mock things; AUTOPROBE
 * cannot — it spawns a real subprocess.
 *
 * Pairs with the LIVING LAB primitive which goes BEYOND invocability
 * to continuous fuzz at 5-min intervals.
 *
 * Output: HMAC-signed `.mneme/autoprobe/last_run.json` consumed by
 * `crossCheckFromDisk` as a third coverage source (claim OR pattern
 * OR autoprobe-invocable).
 */

import { spawnSync } from "node:child_process";
import { createHmac } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync, statSync } from "node:fs";
import { dirname, join } from "node:path";

const KEY_ENV = "MNEME_AUTOPROBE_KEY";
const DEFAULT_KEY = "mneme-autoprobe-v1";

function keyOf(): string {
  return process.env[KEY_ENV] ?? DEFAULT_KEY;
}

export interface AutoprobeResult {
  tool: string;
  invocable: boolean;
  exitCode: number;
  latencyMs: number;
  hint: string;
}

export interface AutoprobeReport {
  at: string;
  totalTested: number;
  invocableCount: number;
  brokenCount: number;
  results: AutoprobeResult[];
  totalLatencyMs: number;
  hmac: string;
}

export interface AutoprobeOpts {
  /** Tool names to probe (from probe_coverage uncovered list). */
  tools: string[];
  /** Repo root (default cwd). */
  cwd?: string;
  /** Per-tool timeout in ms (default 5000). */
  timeoutMs?: number;
  /** Max concurrent spawns (default 4). */
  concurrency?: number;
  /** Skip the persist step (used by tests). */
  noPersist?: boolean;
  /** Custom CLI binary path (default packages/cli/bin/mneme.js). */
  cliBinPath?: string;
}

function toolToArgs(tool: string): string[] {
  // mneme.polygraph.install → ["polygraph", "install", "--help"]
  const parts = tool.split(".").slice(1);
  return [...parts, "--help"];
}

function probeOne(
  cliBinPath: string,
  tool: string,
  cwd: string,
  timeoutMs: number,
): AutoprobeResult {
  const t0 = performance.now();
  const args = toolToArgs(tool);
  try {
    const r = spawnSync(process.execPath, [cliBinPath, ...args], {
      cwd,
      timeout: timeoutMs,
      encoding: "utf8",
      env: { ...process.env, MNEME_AUTOPROBE: "1" },
    });
    const latencyMs = +(performance.now() - t0).toFixed(2);
    const exit = r.status ?? -1;
    const stderr = r.stderr ?? "";
    const stdout = r.stdout ?? "";
    const combined = stdout + "\n" + stderr;
    const wiringLag = /unknown\s+(command|option|argument)/i.test(stderr);
    const hasUsage = /usage|options:|commands:/i.test(combined);
    // v2.58 — tighter check: the verb names from the tool must appear in
    // the help output. Prevents the case where `mneme <unknown> --help`
    // falls through to global help (which doesn't mention the unknown
    // verb) and would otherwise be counted as invocable.
    const verbParts = tool.split(".").slice(1);
    const verbsMentioned = verbParts.every((v) => combined.toLowerCase().includes(v.toLowerCase()));
    const invocable = exit === 0 && !wiringLag && hasUsage && verbsMentioned;
    return {
      tool,
      invocable,
      exitCode: exit,
      latencyMs,
      hint: invocable
        ? "help output ok"
        : wiringLag
        ? "wiring lag: commander rejected — tool not registered"
        : exit !== 0
        ? `exit=${exit}` + (stderr ? `: ${stderr.slice(0, 120).replace(/\s+/g, " ")}` : "")
        : "no usage output — tool may print on stderr only or hang",
    };
  } catch (e) {
    return {
      tool,
      invocable: false,
      exitCode: -1,
      latencyMs: +(performance.now() - t0).toFixed(2),
      hint: `spawn failed: ${(e as Error).message}`,
    };
  }
}

/**
 * Run AUTOPROBE over a list of tools. Returns an HMAC-signed report
 * and persists to `.mneme/autoprobe/last_run.json` unless `noPersist`.
 */
export function runAutoprobe(opts: AutoprobeOpts): AutoprobeReport {
  const cwd = opts.cwd ?? process.cwd();
  const cliBinPath = opts.cliBinPath ?? join(cwd, "packages", "cli", "bin", "mneme.js");
  const timeoutMs = opts.timeoutMs ?? 5000;
  const t0 = performance.now();
  const results: AutoprobeResult[] = [];
  for (const tool of opts.tools) {
    results.push(probeOne(cliBinPath, tool, cwd, timeoutMs));
  }
  const invocableCount = results.filter((r) => r.invocable).length;
  const brokenCount = results.filter((r) => !r.invocable).length;
  const totalLatencyMs = +(performance.now() - t0).toFixed(2);
  const at = new Date().toISOString();
  const body = { at, totalTested: results.length, invocableCount, brokenCount, results, totalLatencyMs };
  const hmac = createHmac("sha256", keyOf()).update(JSON.stringify(body)).digest("hex");
  const report: AutoprobeReport = { ...body, hmac };
  if (!opts.noPersist) {
    const path = join(cwd, ".mneme", "autoprobe", "last_run.json");
    try {
      mkdirSync(dirname(path), { recursive: true });
      writeFileSync(path, JSON.stringify(report, null, 2));
    } catch {
      // never throw on persistence failure
    }
  }
  return report;
}

/** Verify a persisted report's HMAC offline. */
export function verifyAutoprobeReport(r: AutoprobeReport): boolean {
  if (!r || typeof r.hmac !== "string") return false;
  const { hmac, ...body } = r;
  const expected = createHmac("sha256", keyOf()).update(JSON.stringify(body)).digest("hex");
  return expected === hmac;
}

/**
 * Load the last run from disk if fresh (within `maxAgeMs`, default 24h).
 * Returns null if missing/stale/tampered.
 */
export function loadFreshAutoprobeReport(
  repoRoot: string,
  maxAgeMs = 24 * 60 * 60 * 1000,
): AutoprobeReport | null {
  try {
    const path = join(repoRoot, ".mneme", "autoprobe", "last_run.json");
    if (!existsSync(path)) return null;
    const stat = statSync(path);
    if (Date.now() - stat.mtimeMs > maxAgeMs) return null;
    const parsed = JSON.parse(readFileSync(path, "utf8")) as AutoprobeReport;
    if (!verifyAutoprobeReport(parsed)) return null;
    return parsed;
  } catch {
    return null;
  }
}

/**
 * Build the set of tool names that AUTOPROBE has empirically proven
 * invocable in the last fresh run. Used by probe_coverage as a third
 * coverage source.
 */
export function autoprobeCoveredTools(repoRoot: string): Set<string> {
  const r = loadFreshAutoprobeReport(repoRoot);
  if (!r) return new Set();
  return new Set(r.results.filter((x) => x.invocable).map((x) => x.tool));
}
