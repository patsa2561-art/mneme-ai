/**
 * PatchRisk scorer (v1.27.5) -- the missing entropy in the confidence
 * formula.
 *
 * v1.27.4 confidence was "differentiated" in theory but in practice
 * every patch on the same file with the same test scaffold scored
 * the same 0.734. Reason: all the inputs (signal occurrences, source
 * count, test_coverage existence, verification gates) were too
 * similar across the typical Mneme self-heal workload (3 selfcheck
 * signals all touching `packages/core/src/selfcheck/checks.ts`).
 *
 * v1.27.5 adds a per-PATCH risk score derived from CODE METRICS:
 *
 *   1. File age          -- days since first commit on the file
 *   2. Recent churn      -- commits to the file in the last 30 days
 *   3. Lines of code     -- raw line count of the file
 *   4. Test density      -- count of `it(` calls in the co-located
 *                           test file
 *   5. Symbol fan-in     -- # of imports of the file across the repo
 *
 * High-risk patches (large files, high churn, low test density,
 * many fan-in imports) score LOWER confidence -- the patch is
 * touching code with a big blast radius.
 *
 * Low-risk patches (small files, no churn, dense tests, few fan-in)
 * score HIGHER confidence -- safe to apply.
 *
 * The score is in [0, 1], computed deterministically from local git
 * + filesystem state. Each input is normalized via a sigmoid so an
 * outlier on one axis doesn't dominate the score.
 */

import { existsSync, readFileSync } from "node:fs";
import { join, dirname, basename } from "node:path";
import { spawnSync } from "node:child_process";

export interface PatchRisk {
  /** File path the patch targets (relative to repoRoot). */
  filePath: string;
  /** Days since first commit on the file. null = git unreachable / file untracked. */
  fileAgeDays: number | null;
  /** Number of commits to the file in the last 30 days. null = git unreachable. */
  churn30d: number | null;
  /** Raw line count. */
  loc: number;
  /** Number of `it(` calls in the co-located <name>.test.ts file. 0 = no test file. */
  testDensity: number;
  /** Number of TypeScript files in the repo that import this file. */
  fanIn: number;
  /** Composite risk score in [0, 1]. Higher = riskier. */
  riskScore: number;
  /** Confidence-friendly inverted score in [0, 1]. Higher = SAFER patch. */
  safetyScore: number;
}

/** Sigmoid -- maps any real to (0, 1). Used to compress unbounded inputs. */
function sigmoid(x: number, midpoint = 0, steepness = 1): number {
  return 1 / (1 + Math.exp(-(x - midpoint) * steepness));
}

function gitFirstCommitDate(repoRoot: string, filePath: string): Date | null {
  try {
    const r = spawnSync("git", ["log", "--diff-filter=A", "--follow", "--format=%cI", "--", filePath],
      { cwd: repoRoot, encoding: "utf8", timeout: 5_000 });
    if (r.status !== 0) return null;
    const lines = (r.stdout || "").trim().split("\n").filter(Boolean);
    const oldest = lines[lines.length - 1];
    if (!oldest) return null;
    const d = new Date(oldest);
    if (isNaN(d.getTime())) return null;
    return d;
  } catch { return null; }
}

function gitChurn30d(repoRoot: string, filePath: string): number | null {
  try {
    const r = spawnSync("git", ["log", "--since=30 days ago", "--format=%H", "--", filePath],
      { cwd: repoRoot, encoding: "utf8", timeout: 5_000 });
    if (r.status !== 0) return null;
    return (r.stdout || "").trim().split("\n").filter(Boolean).length;
  } catch { return null; }
}

function countLOC(repoRoot: string, filePath: string): number {
  try {
    const text = readFileSync(join(repoRoot, filePath), "utf8");
    return text.split("\n").length;
  } catch { return 0; }
}

function countTestDensity(repoRoot: string, filePath: string): number {
  // Co-located: foo.ts -> foo.test.ts
  const dir = dirname(filePath);
  const base = basename(filePath, ".ts");
  const testPath = join(repoRoot, dir, `${base}.test.ts`);
  if (!existsSync(testPath)) return 0;
  try {
    const text = readFileSync(testPath, "utf8");
    // Count `it(` occurrences -- the canonical vitest test marker.
    const matches = text.match(/\bit\s*\(/g);
    return matches ? matches.length : 0;
  } catch { return 0; }
}

function countFanIn(repoRoot: string, filePath: string): number {
  try {
    // Build the import-suffix the file would be referenced by.
    // For "packages/core/src/selfcheck/checks.ts" that's "selfcheck/checks.js"
    // (TS-imports use .js extension under ESM). We grep for the basename + .js
    // across all TS files. Conservative -- catches most imports.
    const base = basename(filePath, ".ts");
    const re = `${base}\\.js`;
    // ripgrep would be faster but git grep is universally available.
    const r = spawnSync("git", ["grep", "-l", re, "--", "*.ts"],
      { cwd: repoRoot, encoding: "utf8", timeout: 10_000 });
    if (r.status !== 0 && r.status !== 1) return 0;
    const lines = (r.stdout || "").trim().split("\n").filter(Boolean);
    // Subtract 1 to exclude the file itself if it's in the list.
    return Math.max(0, lines.length - (lines.includes(filePath) ? 1 : 0));
  } catch { return 0; }
}

/**
 * Compute the patch risk for a target file. Each axis is normalized
 * via sigmoid so the composite stays in [0, 1] without overflow.
 *
 * Risk weights (sum to 1.0):
 *   - Fan-in:      0.30  (most important -- big blast radius)
 *   - LOC:         0.20  (bigger files = more places we missed)
 *   - Churn 30d:   0.20  (recent activity = code in motion)
 *   - File age:    0.15  (very new files are riskier; very old very slightly safer)
 *   - Test inv:    0.15  (low test density = riskier)
 */
export function computePatchRisk(repoRoot: string, filePath: string): PatchRisk {
  const firstCommit = gitFirstCommitDate(repoRoot, filePath);
  const fileAgeDays = firstCommit ? Math.max(0, (Date.now() - firstCommit.getTime()) / 86_400_000) : null;
  const churn30d = gitChurn30d(repoRoot, filePath);
  const loc = countLOC(repoRoot, filePath);
  const testDensity = countTestDensity(repoRoot, filePath);
  const fanIn = countFanIn(repoRoot, filePath);

  // Normalize each axis to [0, 1].
  // Fan-in: midpoint 5 imports, steepness 0.4 -> 0 imports = 0.12, 5 = 0.50, 20 = 0.998
  const fanInNorm = sigmoid(fanIn, 5, 0.4);
  // LOC: midpoint 200 lines, steepness 0.005 -> 50 = 0.32, 200 = 0.50, 1000 = 0.98
  const locNorm = sigmoid(loc, 200, 0.005);
  // Churn30d: midpoint 5 commits, steepness 0.4 -> 0 = 0.12, 5 = 0.50, 20 = 0.998
  const churnNorm = churn30d == null ? 0.5 : sigmoid(churn30d, 5, 0.4);
  // Age: 0-30 days = high risk (new), 30-365 = neutral, 365+ = slightly lower risk
  // Inverted sigmoid: very young files riskier than very old.
  const ageNorm = fileAgeDays == null ? 0.5
    : 1 - sigmoid(Math.min(fileAgeDays, 730), 90, 0.02); // scale 0-2 years
  // Test density: invert -- LOW density = HIGH risk
  // 0 tests = 0.88 risk, 5 tests = 0.50, 20 tests = 0.18
  const testNorm = 1 - sigmoid(testDensity, 5, 0.4);

  const riskScore = Math.max(0, Math.min(1,
    0.30 * fanInNorm +
    0.20 * locNorm +
    0.20 * churnNorm +
    0.15 * ageNorm +
    0.15 * testNorm
  ));

  const safetyScore = 1 - riskScore;

  return {
    filePath,
    fileAgeDays,
    churn30d,
    loc,
    testDensity,
    fanIn,
    riskScore,
    safetyScore,
  };
}

/** Render a one-line risk summary for human reading. */
export function summarizeRisk(r: PatchRisk): string {
  const ageStr = r.fileAgeDays == null ? "?" : `${Math.round(r.fileAgeDays)}d`;
  const churnStr = r.churn30d == null ? "?" : String(r.churn30d);
  return `risk=${(r.riskScore * 100).toFixed(0)}% (age=${ageStr} churn=${churnStr}/30d loc=${r.loc} tests=${r.testDensity} fan-in=${r.fanIn})`;
}
