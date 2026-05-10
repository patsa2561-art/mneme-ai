/**
 * Mneme Self-Check -- recurring self-recheck loop runner.
 *
 *   runAudit(repoRoot) -> AuditReport (parallel; ~50ms-2s total)
 *   readReport(repoRoot) -> last AuditReport on disk
 *   verdictsForPulse(report) -> short lines for the pulse to surface
 *   recurringSelfRecheck() -> "ask itself: am I good enough yet?" loop
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { AuditReport } from "./types.js";
import { ALL_CHECKS } from "./checks.js";

export type { AuditCheck, AuditReport, AuditStatus, AuditVerdict } from "./types.js";
export { ALL_CHECKS } from "./checks.js";

const REPORT_FILE = ".mneme/selfcheck/last.json";

function ensureDir(repoRoot: string): void {
  const dir = join(repoRoot, ".mneme/selfcheck");
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
}

const STATUS_RANK = { fail: 3, warn: 2, skip: 1, pass: 0 } as const;

export async function runAudit(repoRoot: string): Promise<AuditReport> {
  const t0 = Date.now();
  const ranAt = new Date().toISOString();
  const verdicts = await Promise.all(
    ALL_CHECKS.map(async (check) => {
      try {
        const r = await check.run(repoRoot);
        return r;
      } catch (e) {
        return {
          name: check.name, description: check.description,
          status: "skip" as const,
          evidence: `check threw: ${(e as Error).message}`,
          ms: 0,
        };
      }
    }),
  );
  verdicts.sort((a, b) => STATUS_RANK[b.status] - STATUS_RANK[a.status]);

  const passed = verdicts.filter((v) => v.status === "pass").length;
  const warned = verdicts.filter((v) => v.status === "warn").length;
  const failed = verdicts.filter((v) => v.status === "fail").length;
  const skipped = verdicts.filter((v) => v.status === "skip").length;

  const banner = failed > 0
    ? `audit: ${failed} FAIL, ${warned} warn, ${passed} pass`
    : warned > 0
      ? `audit: ${warned} warn, ${passed} pass (no failures)`
      : `audit: all ${passed} checks pass`;

  const report: AuditReport = {
    ranAt, totalChecks: verdicts.length,
    passed, warned, failed, skipped,
    totalMs: Date.now() - t0,
    verdicts, banner,
  };
  try {
    ensureDir(repoRoot);
    writeFileSync(join(repoRoot, REPORT_FILE), JSON.stringify(report, null, 2), "utf8");
  } catch { /* best-effort */ }
  return report;
}

export function readReport(repoRoot: string): AuditReport | null {
  const path = join(repoRoot, REPORT_FILE);
  if (!existsSync(path)) return null;
  try { return JSON.parse(readFileSync(path, "utf8")) as AuditReport; } catch { return null; }
}

export function verdictsForPulse(report: AuditReport): string[] {
  const lines: string[] = [];
  const issues = report.verdicts.filter((v) => v.status === "fail" || v.status === "warn").slice(0, 3);
  for (const v of issues) {
    const tag = v.status === "fail" ? "[AUDIT FAIL]" : "[AUDIT WARN]";
    lines.push(`${tag} ${v.name}: ${v.evidence}${v.fixHint ? `  -> fix: ${v.fixHint}` : ""}`);
  }
  return lines;
}

/** Recurring loop: keep auditing until either no failures OR maxIterations
 *  reached. Useful for the daemon's "ask itself: am I good enough yet?" loop. */
export async function recurringSelfRecheck(
  repoRoot: string,
  opts: { maxIterations?: number; intervalMs?: number; onIteration?: (report: AuditReport) => void } = {},
): Promise<AuditReport> {
  const max = opts.maxIterations ?? 5;
  const interval = opts.intervalMs ?? 30_000;
  let report = await runAudit(repoRoot);
  opts.onIteration?.(report);
  let iter = 1;
  while (report.failed > 0 && iter < max) {
    await new Promise<void>((resolve) => setTimeout(resolve, interval));
    report = await runAudit(repoRoot);
    opts.onIteration?.(report);
    iter++;
  }
  return report;
}
