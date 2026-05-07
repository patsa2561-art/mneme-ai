/**
 * AI Session Audit — CERTIFY module.
 *
 * The 5-axis trust certificate.  Composes a baseline + a session trace
 * into a verdict per axis:
 *
 *   1. behavioralParity   — sample commands' exit + stdout-hash unchanged
 *   2. apiContractDrift   — public exports added / removed / renamed
 *   3. testPassRate       — before/after passing-test deltas
 *   4. perfRegression     — median ms regression (>25% fail, >10% warn)
 *   5. aiNarrative        — Leviathan-style commit-vs-diff check
 *
 * Plus four "forensic axes" reused from the existing anomaly detector
 * (size / files / style / time).  We translate each anomaly axis score
 * to pass/warn/fail using the same thresholds.
 *
 * Pure data composition — no I/O.  The CLI layer wires real `git` /
 * `npm` calls in via the Runner interfaces from baseline.ts and
 * trace.ts; here we only consume the captured snapshots.
 */

import type { Baseline, Runner } from "./baseline.js";
import { captureBaseline, realRunner } from "./baseline.js";
import type { SessionTrace } from "./trace.js";
import {
  verifyNarrative,
  aggregateNarrativeTrust,
  hasContradiction,
  type NarrativeCheck,
} from "./verify.js";

export type AxisVerdict = "pass" | "warn" | "fail";

export interface AuditCertificate {
  sessionId: string;
  capturedAt: string;
  axes: {
    behavioralParity: { verdict: AxisVerdict; reason: string; details: string[] };
    apiContractDrift: { verdict: AxisVerdict; reason: string; details: string[] };
    testPassRate: { verdict: AxisVerdict; reason: string; before: string; after: string };
    perfRegression: { verdict: AxisVerdict; reason: string; deltaPercent: number };
    aiNarrative: { verdict: AxisVerdict; reason: string; checks: NarrativeCheck[] };
  };
  forensicAxes: {
    size: AxisVerdict;
    files: AxisVerdict;
    style: AxisVerdict;
    time: AxisVerdict;
  };
  overallVerdict: AxisVerdict;
  exitCode: 0 | 1;
}

/** Combine many axis verdicts: any fail → fail; any warn → warn; else pass. */
export function combineVerdicts(verdicts: AxisVerdict[]): AxisVerdict {
  if (verdicts.includes("fail")) return "fail";
  if (verdicts.includes("warn")) return "warn";
  return "pass";
}

/** Helper for tests + CLI: read both raw outputs, return parity verdict. */
export function compareBehavioralParity(
  before: Baseline,
  after: Pick<Baseline, "outputs">,
): { verdict: AxisVerdict; reason: string; details: string[] } {
  const details: string[] = [];
  let mismatches = 0;
  let critical = 0;
  for (const [name, beforeSample] of Object.entries(before.outputs)) {
    const afterSample = after.outputs[name];
    if (!afterSample) {
      details.push(`missing post-baseline sample: ${name}`);
      continue;
    }
    if (beforeSample.exitCode !== afterSample.exitCode) {
      details.push(`${name}: exit ${beforeSample.exitCode} → ${afterSample.exitCode}`);
      mismatches += 1;
      // git_head is critical: changing it means HEAD moved (expected),
      // but exit-code change for any sample is critical.
      critical += 1;
    } else if (beforeSample.stdoutHash !== afterSample.stdoutHash) {
      // stdout content shift: warn unless the sample is git_head/git_log
      // (those are EXPECTED to drift after new commits land).
      if (name === "git_head" || name === "git_log_20") {
        details.push(`${name}: stdout shifted (expected — new commits)`);
      } else {
        details.push(
          `${name}: stdout shifted (${beforeSample.stdoutLines}→${afterSample.stdoutLines} lines)`,
        );
        mismatches += 1;
      }
    }
  }
  if (critical > 0) {
    return {
      verdict: "fail",
      reason: `${critical} sample(s) changed exit code`,
      details,
    };
  }
  if (mismatches > 0) {
    return {
      verdict: "warn",
      reason: `${mismatches} sample(s) drifted in unexpected ways`,
      details,
    };
  }
  return {
    verdict: "pass",
    reason: "all sample commands match the baseline",
    details,
  };
}

export function compareApiSurface(
  before: Baseline,
  after: Pick<Baseline, "apiSurface">,
): { verdict: AxisVerdict; reason: string; details: string[] } {
  const details: string[] = [];
  const removed: string[] = [];
  const added: string[] = [];
  // For every package present in either snapshot...
  const allPkgs = new Set<string>([
    ...Object.keys(before.apiSurface),
    ...Object.keys(after.apiSurface),
  ]);
  for (const pkg of allPkgs) {
    const beforeSet = new Set(before.apiSurface[pkg] ?? []);
    const afterSet = new Set(after.apiSurface[pkg] ?? []);
    for (const name of beforeSet) {
      if (!afterSet.has(name)) removed.push(`${pkg}.${name}`);
    }
    for (const name of afterSet) {
      if (!beforeSet.has(name)) added.push(`${pkg}.${name}`);
    }
  }
  if (removed.length > 0) {
    details.push(`removed: ${removed.slice(0, 5).join(", ")}${removed.length > 5 ? "…" : ""}`);
  }
  if (added.length > 0) {
    details.push(`added: ${added.slice(0, 5).join(", ")}${added.length > 5 ? "…" : ""}`);
  }
  if (removed.length > 0) {
    return {
      verdict: "fail",
      reason: `${removed.length} export(s) removed — silent breaking change`,
      details,
    };
  }
  // Heuristic rename detection: same count of additions + removals + similar names → warn.
  // Skipping — additions only is a "pass".
  if (added.length > 0) {
    return {
      verdict: "pass",
      reason: `${added.length} new export(s); no removals`,
      details,
    };
  }
  return { verdict: "pass", reason: "API surface identical", details };
}

export function compareTestPassRate(
  before: Baseline,
  after: Pick<Baseline, "testPassRate">,
): {
  verdict: AxisVerdict;
  reason: string;
  before: string;
  after: string;
} {
  const b = before.testPassRate;
  const a = after.testPassRate;
  const beforeStr = `${b.passed} passed / ${b.failed} failed (${b.files} files)`;
  const afterStr = `${a.passed} passed / ${a.failed} failed (${a.files} files)`;
  if (a.failed > b.failed) {
    return {
      verdict: "fail",
      reason: `${a.failed - b.failed} new test failure(s)`,
      before: beforeStr,
      after: afterStr,
    };
  }
  if (a.passed < b.passed) {
    return {
      verdict: "warn",
      reason: `passing test count dropped (${b.passed} → ${a.passed})`,
      before: beforeStr,
      after: afterStr,
    };
  }
  return {
    verdict: "pass",
    reason: "no new test failures",
    before: beforeStr,
    after: afterStr,
  };
}

export function comparePerf(
  before: Baseline,
  after: Pick<Baseline, "perfMs">,
): { verdict: AxisVerdict; reason: string; deltaPercent: number } {
  let worstDelta = 0;
  let worstName = "";
  for (const [name, beforeMs] of Object.entries(before.perfMs)) {
    const afterMs = after.perfMs[name];
    if (afterMs == null) continue;
    if (beforeMs <= 0) continue;
    const delta = ((afterMs - beforeMs) / beforeMs) * 100;
    if (delta > worstDelta) {
      worstDelta = delta;
      worstName = name;
    }
  }
  const rounded = Number(worstDelta.toFixed(1));
  if (rounded >= 25) {
    return {
      verdict: "fail",
      reason: `${worstName} ${rounded}% slower than baseline`,
      deltaPercent: rounded,
    };
  }
  if (rounded >= 10) {
    return {
      verdict: "warn",
      reason: `${worstName} ${rounded}% slower than baseline`,
      deltaPercent: rounded,
    };
  }
  return {
    verdict: "pass",
    reason:
      worstName.length > 0
        ? `worst-case ${worstName} only ${rounded}% slower`
        : "no perf samples to compare",
    deltaPercent: rounded,
  };
}

export interface NarrativeAxisInput {
  trace: SessionTrace;
  /** Per-commit unified diff text + filesTouched.  Caller computes from git. */
  diffs: Record<
    string,
    { diff: string; filesTouched: string[] }
  >;
}

export function evaluateNarrativeAxis(input: NarrativeAxisInput): {
  verdict: AxisVerdict;
  reason: string;
  checks: NarrativeCheck[];
} {
  const checks: NarrativeCheck[] = [];
  for (const c of input.trace.commits) {
    const d = input.diffs[c.hash];
    if (!d) continue;
    checks.push(verifyNarrative(c.message, d.diff, d.filesTouched, c.hash));
  }
  if (checks.length === 0) {
    return {
      verdict: "pass",
      reason: "no commits with diffs to verify",
      checks,
    };
  }
  if (hasContradiction(checks)) {
    const total = checks.reduce(
      (s, c) => s + c.verifications.filter((v) => v.verdict === "contradicted").length,
      0,
    );
    return {
      verdict: "fail",
      reason: `${total} commit-message claim(s) contradicted by diff`,
      checks,
    };
  }
  const trust = aggregateNarrativeTrust(checks);
  if (trust < 0.6) {
    return {
      verdict: "warn",
      reason: `aggregate narrative trust ${trust.toFixed(2)} below 0.6`,
      checks,
    };
  }
  return {
    verdict: "pass",
    reason: `aggregate narrative trust ${trust.toFixed(2)}`,
    checks,
  };
}

/**
 * Forensic axis verdicts — translate the four anomaly-detector axes
 * (size / files / style / time) into pass/warn/fail using thresholds
 * lifted from the anomaly module's severity bands.
 */
export function classifyForensicAxis(score: number): AxisVerdict {
  if (score >= 0.7) return "fail";
  if (score >= 0.4) return "warn";
  return "pass";
}

/**
 * Top-level certify entry point.  Caller supplies a fresh post-session
 * baseline (re-captured) plus the trace + diffs + forensic axis scores.
 */
export interface CertifyInput {
  sessionId: string;
  beforeBaseline: Baseline;
  afterBaseline: Baseline;
  trace: SessionTrace;
  diffs: Record<string, { diff: string; filesTouched: string[] }>;
  /** Per-axis [0,1] forensic anomaly scores; default to all-zeros. */
  forensicScores?: { size: number; files: number; style: number; time: number };
}

export function buildCertificate(input: CertifyInput): AuditCertificate {
  const behavioralParity = compareBehavioralParity(input.beforeBaseline, input.afterBaseline);
  const apiContractDrift = compareApiSurface(input.beforeBaseline, input.afterBaseline);
  const testPassRate = compareTestPassRate(input.beforeBaseline, input.afterBaseline);
  const perfRegression = comparePerf(input.beforeBaseline, input.afterBaseline);
  const aiNarrative = evaluateNarrativeAxis({ trace: input.trace, diffs: input.diffs });

  const fScores = input.forensicScores ?? { size: 0, files: 0, style: 0, time: 0 };
  const forensicAxes = {
    size: classifyForensicAxis(fScores.size),
    files: classifyForensicAxis(fScores.files),
    style: classifyForensicAxis(fScores.style),
    time: classifyForensicAxis(fScores.time),
  };

  const overall = combineVerdicts([
    behavioralParity.verdict,
    apiContractDrift.verdict,
    testPassRate.verdict,
    perfRegression.verdict,
    aiNarrative.verdict,
    forensicAxes.size,
    forensicAxes.files,
    forensicAxes.style,
    forensicAxes.time,
  ]);

  return {
    sessionId: input.sessionId,
    capturedAt: new Date().toISOString(),
    axes: {
      behavioralParity,
      apiContractDrift,
      testPassRate,
      perfRegression,
      aiNarrative,
    },
    forensicAxes,
    overallVerdict: overall,
    exitCode: overall === "fail" ? 1 : 0,
  };
}

/**
 * Orchestrates the full certify pipeline against a real repo.  The CLI
 * uses this; tests exercise `buildCertificate` directly with canned
 * inputs.
 */
export async function certifySession(
  repoRoot: string,
  baseline: Baseline,
  trace: SessionTrace,
  diffs: Record<string, { diff: string; filesTouched: string[] }> = {},
  runner: Runner = realRunner,
): Promise<AuditCertificate> {
  const after = await captureBaseline(repoRoot, runner);
  return buildCertificate({
    sessionId: trace.toHash.slice(0, 7) || "unknown",
    beforeBaseline: baseline,
    afterBaseline: after,
    trace,
    diffs,
  });
}
