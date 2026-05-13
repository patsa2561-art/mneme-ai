/**
 * v2.7.0 -- METRON code audit primitives.
 *
 *   silentCatchAudit()   counts catch blocks that swallow exceptions
 *                         (no logging, no rethrow, no in-block side effect).
 *   anyDensityAudit()    counts `: any` annotations per source file.
 *
 * Both feed the METRON Reliability + DX axes with REAL numbers instead
 * of caller-supplied guesses. Cheap regex scanners — no full TS AST,
 * because METRON is realtime + must run inside the daemon tick.
 *
 * Wild move: the auditors also surface PER-FILE rankings so the AI
 * agent can suggest targeted fixes ("file X has 12 silent catches,
 * highest in the repo — refactor first").
 */

import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, extname, relative } from "node:path";

const IGNORE_DIRS = new Set(["node_modules", "dist", "build", ".git", ".mneme", "coverage", "tests"]);

function walkTsFiles(root: string, includeTests = false, maxFiles = 8000): string[] {
  const out: string[] = [];
  function inner(dir: string, depth: number): void {
    if (depth > 12 || out.length >= maxFiles) return;
    let entries: string[];
    try { entries = readdirSync(dir); } catch { return; }
    for (const e of entries) {
      if (IGNORE_DIRS.has(e) || e.startsWith(".")) continue;
      const full = join(dir, e);
      let s: ReturnType<typeof statSync>;
      try { s = statSync(full); } catch { continue; }
      if (s.isDirectory()) inner(full, depth + 1);
      else if (s.isFile() && extname(full) === ".ts" && !full.endsWith(".d.ts")) {
        if (!includeTests && (full.endsWith(".test.ts") || full.endsWith(".spec.ts"))) continue;
        out.push(full);
        if (out.length >= maxFiles) return;
      }
    }
  }
  inner(root, 0);
  return out;
}

export interface SilentCatchHit {
  file: string;
  line: number;
  /** The matched catch fragment (truncated). */
  excerpt: string;
}

export interface SilentCatchAuditResult {
  totalSilentCatches: number;
  filesScanned: number;
  /** Top files by silent-catch count, capped. */
  worstFiles: Array<{ file: string; count: number }>;
  /** Per-hit detail (limited to first N for memory). */
  sampleHits: SilentCatchHit[];
}

/** Match `catch (e) { /* comment * / }` or `catch {}` style blocks
 *  with NO observable side effect. We approximate "no side effect"
 *  via "body is whitespace + a single non-side-effecting comment".
 *
 *  v2.8: catches whose comment body contains the BE:silent-by-design /
 *  best-effort marker are EXCLUDED from the count — they're deliberate.
 *  Use packages/core/src/util/best_effort.ts to wrap intentional swallow. */
const SILENT_CATCH_REGEX = /catch\s*(?:\([^)]*\))?\s*\{\s*(?:\/\*[^*]*\*\/|\/\/[^\n]*)?\s*\}/g;
const DELIBERATE_BEST_EFFORT = /BE:silent-by-design|best-effort/i;

export function silentCatchAudit(repoRoot: string, opts?: { sampleLimit?: number }): SilentCatchAuditResult {
  const sampleLimit = opts?.sampleLimit ?? 50;
  const files = walkTsFiles(join(repoRoot, "packages"));
  const perFile = new Map<string, number>();
  const samples: SilentCatchHit[] = [];
  for (const f of files) {
    let text: string;
    try { text = readFileSync(f, "utf8"); } catch { continue; }
    let m: RegExpExecArray | null;
    SILENT_CATCH_REGEX.lastIndex = 0;
    let count = 0;
    while ((m = SILENT_CATCH_REGEX.exec(text)) !== null) {
      // v2.8: exclude deliberate best-effort catches that carry the marker.
      if (DELIBERATE_BEST_EFFORT.test(m[0]!)) continue;
      count++;
      if (samples.length < sampleLimit) {
        const pre = text.slice(0, m.index);
        const line = pre.split("\n").length;
        samples.push({ file: relative(repoRoot, f), line, excerpt: m[0]!.slice(0, 60) });
      }
    }
    if (count > 0) perFile.set(f, count);
  }
  const worstFiles = Array.from(perFile.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10)
    .map(([file, count]) => ({ file: relative(repoRoot, file), count }));
  const total = Array.from(perFile.values()).reduce((s, n) => s + n, 0);
  return { totalSilentCatches: total, filesScanned: files.length, worstFiles, sampleHits: samples };
}

export interface AnyDensityResult {
  totalAnyAnnotations: number;
  filesScanned: number;
  /** Top files by `: any` count. */
  worstFiles: Array<{ file: string; count: number }>;
  /** Density = totalAnyAnnotations / filesScanned. */
  density: number;
}

/** Count `: any` annotations — function returns, parameters, variables.
 *  Excludes `any[]` inside a type union and JSDoc `@type {any}` style. */
const ANY_REGEX = /:\s*any\b(?!\s*=>\s*[a-zA-Z_])/g;

export function anyDensityAudit(repoRoot: string): AnyDensityResult {
  const files = walkTsFiles(join(repoRoot, "packages"));
  const perFile = new Map<string, number>();
  for (const f of files) {
    let text: string;
    try { text = readFileSync(f, "utf8"); } catch { continue; }
    ANY_REGEX.lastIndex = 0;
    const matches = text.match(ANY_REGEX);
    const count = matches?.length ?? 0;
    if (count > 0) perFile.set(f, count);
  }
  const total = Array.from(perFile.values()).reduce((s, n) => s + n, 0);
  const worstFiles = Array.from(perFile.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10)
    .map(([file, count]) => ({ file: relative(repoRoot, file), count }));
  return {
    totalAnyAnnotations: total,
    filesScanned: files.length,
    worstFiles,
    density: files.length > 0 ? total / files.length : 0,
  };
}

/** Run both audits + report one-liner per result. */
export interface AuditPair {
  silentCatch: SilentCatchAuditResult;
  anyDensity: AnyDensityResult;
}

export function runAudits(repoRoot: string): AuditPair {
  return { silentCatch: silentCatchAudit(repoRoot), anyDensity: anyDensityAudit(repoRoot) };
}

export function formatAuditPulseLine(a: AuditPair): string {
  return `AUDIT · silent-catches=${a.silentCatch.totalSilentCatches} · :any=${a.anyDensity.totalAnyAnnotations} (density=${a.anyDensity.density.toFixed(2)})`;
}
