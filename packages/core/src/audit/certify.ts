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
 * ── Forensic-grade rules (v0.35) ────────────────────────────────────
 *
 *  • Every "pass" must back itself with concrete evidence the user can
 *    verify.  No more rubber-stamping.
 *  • If an axis has zero data (no commits, no test command, no
 *    samples) the verdict is `skipped` — never `pass`.  Sniper-accurate
 *    honesty over cheerful green checkmarks.
 *  • Each axis carries `evidence: Evidence[]` (rendered in the report)
 *    + a `confidence: "high" | "medium" | "low"` + an optional
 *    `caveat` string declaring what the axis does NOT check.
 *  • A pre-flight on `buildCertificate` refuses to issue a verdict
 *    if the session contains zero AI-attributed commits AND the
 *    afterBaseline is byte-identical to the beforeBaseline — there's
 *    just no signal to certify.
 *  • A `strict` flag promotes `skipped` axes into `fail`, for
 *    compliance environments where missing data IS a failure.
 *
 * Pure data composition — no I/O.  The CLI layer wires real `git` /
 * `npm` calls in via the Runner interfaces from baseline.ts and
 * trace.ts; here we only consume the captured snapshots.
 */

import type { Baseline, Runner } from "./baseline.js";
import { captureBaseline, realRunner } from "./baseline.js";
import type { SessionTrace } from "./trace.js";
import { aiCommitCount } from "./trace.js";
import {
  verifyNarrative,
  aggregateNarrativeTrust,
  hasContradiction,
  type NarrativeCheck,
} from "./verify.js";

/** Verdict shape — `skipped` means "no data, refusing to claim pass". */
export type AxisVerdict = "pass" | "warn" | "fail" | "skipped";

/** A single piece of forensic evidence — rendered as a bullet under each axis. */
export interface Evidence {
  /** Short label, like "ran" or "before" or "git_head". */
  label: string;
  /** The fact: a count, a hash, a path, an exit code, a delta. */
  value: string;
  /**
   * Optional verdict marker so the renderer can show a check / cross /
   * dash next to the line.  Only meaningful for verifiable items.
   */
  ok?: boolean | "neutral";
}

export type AxisConfidence = "high" | "medium" | "low";

/**
 * The shared shape every axis evaluator returns.  Backwards-compatible
 * with the v0.27 fields (`verdict`, `reason`, `details`) plus new
 * forensic-grade additions.
 */
export interface AxisResult {
  verdict: AxisVerdict;
  reason: string;
  /** Legacy free-form bullets (kept so older callers still render). */
  details: string[];
  /** Structured evidence — what gets rendered in the report. */
  evidence: Evidence[];
  /** Honest framing of what is NOT checked (sample size, threshold…). */
  caveat?: string;
  /** How much weight the user should put in this verdict. */
  confidence: AxisConfidence;
}

/** Forensic axis (size/files/style/time) — also gets evidence. */
export interface ForensicAxisResult {
  verdict: AxisVerdict;
  /** Composite anomaly score in [0,1] (0 = pass, 1 = fail). */
  score: number;
  /** Free-form note from the anomaly detector, surfaced in evidence. */
  reason: string;
  evidence: Evidence[];
  caveat?: string;
}

export interface AuditCertificate {
  sessionId: string;
  capturedAt: string;
  axes: {
    behavioralParity: AxisResult & { /* legacy: details === evidence-as-strings */ };
    apiContractDrift: AxisResult;
    testPassRate: AxisResult & { before: string; after: string };
    perfRegression: AxisResult & { deltaPercent: number };
    aiNarrative: AxisResult & { checks: NarrativeCheck[] };
  };
  forensicAxes: {
    size: ForensicAxisResult;
    files: ForensicAxisResult;
    style: ForensicAxisResult;
    time: ForensicAxisResult;
  };
  overallVerdict: AxisVerdict;
  /**
   * Coverage summary — how many of the 5 main axes carry real evidence
   * versus how many were skipped.  Drives the headline confidence pill.
   */
  coverage: {
    verified: number;   // axes with verdict in {pass, warn, fail}
    skipped: number;    // axes with verdict === "skipped"
    total: number;      // always 5
    confidence: AxisConfidence;
  };
  /**
   * Pre-flight tripwire — set when the session has zero AI commits AND
   * the after-baseline matches the before-baseline byte-for-byte.  In
   * that case we refuse to claim "pass" anywhere; nothing happened to
   * audit.
   */
  insufficientData?: {
    reason: string;
    hint: string;
  };
  exitCode: 0 | 1;
}

/** Combine many axis verdicts: any fail → fail; any warn → warn; any skipped → warn (without --strict); else pass. */
export function combineVerdicts(
  verdicts: AxisVerdict[],
  opts: { strict?: boolean } = {},
): AxisVerdict {
  if (verdicts.includes("fail")) return "fail";
  if (opts.strict && verdicts.includes("skipped")) return "fail";
  if (verdicts.includes("warn")) return "warn";
  // skipped without --strict: don't claim pass — surface as warn so the
  // user looks at the report.  But if EVERY axis is skipped, the
  // pre-flight tripwire above will already have flagged insufficient data.
  if (verdicts.includes("skipped")) return "warn";
  return "pass";
}

// ─── Helpers ────────────────────────────────────────────────────────

/** Stable SHA-256 of a sorted+joined string list — used for surface hashes. */
import { createHash } from "node:crypto";
function hashList(items: string[]): string {
  return createHash("sha256").update([...items].sort().join("\n")).digest("hex").slice(0, 16);
}

// ─── Axis 1: behavioral parity ──────────────────────────────────────

export function compareBehavioralParity(
  before: Baseline,
  after: Pick<Baseline, "outputs">,
): AxisResult {
  const evidence: Evidence[] = [];
  const details: string[] = [];
  let mismatches = 0;
  let critical = 0;
  const sampleCount = Object.keys(before.outputs).length;

  if (sampleCount === 0) {
    return {
      verdict: "skipped",
      reason: "no sample commands captured in baseline",
      details: [],
      evidence: [
        { label: "samples", value: "0 (baseline empty)", ok: false },
      ],
      confidence: "low",
      caveat:
        "Behavioral parity sampled zero commands — re-run `mneme audit --baseline` " +
        "in a working git repo so samples can be collected.",
    };
  }

  for (const [name, beforeSample] of Object.entries(before.outputs)) {
    const afterSample = after.outputs[name];
    if (!afterSample) {
      details.push(`missing post-baseline sample: ${name}`);
      evidence.push({ label: name, value: "missing post-baseline sample", ok: false });
      continue;
    }
    if (beforeSample.exitCode !== afterSample.exitCode) {
      const msg = `exit ${beforeSample.exitCode} → ${afterSample.exitCode}`;
      details.push(`${name}: ${msg}`);
      evidence.push({ label: name, value: msg, ok: false });
      mismatches += 1;
      critical += 1;
    } else if (beforeSample.stdoutHash !== afterSample.stdoutHash) {
      // git_head/git_log are EXPECTED to drift after new commits land.
      if (name === "git_head" || name === "git_log_20") {
        details.push(`${name}: stdout shifted (expected — new commits)`);
        evidence.push({
          label: name,
          value: `stdout shifted (${beforeSample.stdoutLines}→${afterSample.stdoutLines} lines, expected)`,
          ok: "neutral",
        });
      } else {
        const msg = `stdout shifted (${beforeSample.stdoutLines}→${afterSample.stdoutLines} lines)`;
        details.push(`${name}: ${msg}`);
        evidence.push({ label: name, value: msg, ok: false });
        mismatches += 1;
      }
    } else {
      // Clean match — show the evidence: exit + hash prefix.
      evidence.push({
        label: name,
        value:
          `exit ${afterSample.exitCode} · ${afterSample.stdoutLines} lines · sha ${afterSample.stdoutHash.slice(0, 12)}`,
        ok: true,
      });
    }
  }

  const caveat =
    `Sampling: ${sampleCount} of ~12 commands a real CI would run. ` +
    `Drift in unsampled commands wouldn't be caught — run with --thorough for the full set.`;

  if (critical > 0) {
    return {
      verdict: "fail",
      reason: `${critical} sample(s) changed exit code`,
      details,
      evidence,
      confidence: "high",
      caveat,
    };
  }
  if (mismatches > 0) {
    return {
      verdict: "warn",
      reason: `${mismatches} sample(s) drifted in unexpected ways`,
      details,
      evidence,
      confidence: "high",
      caveat,
    };
  }
  return {
    verdict: "pass",
    reason: `all ${sampleCount} sample command(s) match the baseline`,
    details,
    evidence,
    // Pass with very few samples = lower confidence.
    confidence: sampleCount >= 3 ? "medium" : "low",
    caveat,
  };
}

// ─── Axis 2: API contract drift ─────────────────────────────────────

export function compareApiSurface(
  before: Baseline,
  after: Pick<Baseline, "apiSurface">,
): AxisResult {
  const details: string[] = [];
  const removed: string[] = [];
  const added: string[] = [];

  const allPkgs = new Set<string>([
    ...Object.keys(before.apiSurface),
    ...Object.keys(after.apiSurface),
  ]);
  let totalBefore = 0;
  let totalAfter = 0;
  for (const pkg of allPkgs) {
    const beforeSet = new Set(before.apiSurface[pkg] ?? []);
    const afterSet = new Set(after.apiSurface[pkg] ?? []);
    totalBefore += beforeSet.size;
    totalAfter += afterSet.size;
    for (const name of beforeSet) {
      if (!afterSet.has(name)) removed.push(`${pkg}.${name}`);
    }
    for (const name of afterSet) {
      if (!beforeSet.has(name)) added.push(`${pkg}.${name}`);
    }
  }

  const flat = [...allPkgs]
    .flatMap((pkg) => (after.apiSurface[pkg] ?? []).map((n) => `${pkg}.${n}`));
  const surfaceHash = hashList(flat);
  const baselineFlat = [...allPkgs]
    .flatMap((pkg) => (before.apiSurface[pkg] ?? []).map((n) => `${pkg}.${n}`));
  const baselineHash = hashList(baselineFlat);

  // Skipped: no exports at all on either side — nothing to compare.
  if (totalBefore === 0 && totalAfter === 0) {
    return {
      verdict: "skipped",
      reason: "no public exports detected in either snapshot",
      details: [],
      evidence: [
        { label: "exports (before)", value: "0" },
        { label: "exports (after)", value: "0" },
        { label: "packages scanned", value: String(allPkgs.size) },
      ],
      confidence: "low",
      caveat:
        "API-surface scan found zero exports; this can mean the repo " +
        "has no `dist/` (build first) or has no `packages/*` layout.",
    };
  }

  if (removed.length > 0) {
    details.push(`removed: ${removed.slice(0, 5).join(", ")}${removed.length > 5 ? "…" : ""}`);
  }
  if (added.length > 0) {
    details.push(`added: ${added.slice(0, 5).join(", ")}${added.length > 5 ? "…" : ""}`);
  }

  const evidence: Evidence[] = [
    { label: "exports scanned", value: `${totalAfter} across ${allPkgs.size} package(s)` },
    { label: "added", value: String(added.length), ok: added.length === 0 ? true : "neutral" },
    { label: "removed", value: String(removed.length), ok: removed.length === 0 },
    { label: "surface hash (before)", value: `sha256:${baselineHash}` },
    { label: "surface hash (after)", value: `sha256:${surfaceHash}` },
  ];
  if (added.length > 0) {
    evidence.push({
      label: "added (sample)",
      value: added.slice(0, 5).join(", ") + (added.length > 5 ? "…" : ""),
      ok: "neutral",
    });
  }
  if (removed.length > 0) {
    evidence.push({
      label: "removed (sample)",
      value: removed.slice(0, 5).join(", ") + (removed.length > 5 ? "…" : ""),
      ok: false,
    });
  }

  const caveat =
    "Surface = top-level public exports of every package. " +
    "JSDoc + parameter changes are NOT detected; only signature shape.";

  if (removed.length > 0) {
    return {
      verdict: "fail",
      reason: `${removed.length} export(s) removed — silent breaking change`,
      details,
      evidence,
      confidence: "high",
      caveat,
    };
  }
  if (added.length > 0) {
    return {
      verdict: "pass",
      reason: `${added.length} new export(s); no removals`,
      details,
      evidence,
      confidence: "high",
      caveat,
    };
  }
  return {
    verdict: "pass",
    reason: `API surface identical (${totalAfter} exports, hash matches)`,
    details,
    evidence,
    confidence: "high",
    caveat,
  };
}

// ─── Axis 3: test pass rate ─────────────────────────────────────────

export function compareTestPassRate(
  before: Baseline,
  after: Pick<Baseline, "testPassRate">,
): AxisResult & { before: string; after: string } {
  const b = before.testPassRate;
  const a = after.testPassRate;
  const beforeStr = `${b.passed} passed / ${b.failed} failed (${b.files} files)`;
  const afterStr = `${a.passed} passed / ${a.failed} failed (${a.files} files)`;

  // Skipped: NEITHER side ran any tests.  This is the sniper-accuracy
  // moment — the v0.27 audit reported this as `pass` based on `0 / 0`.
  // That was lying.  Now we say "skipped" and explain.
  const noBefore = b.passed === 0 && b.failed === 0 && b.files === 0;
  const noAfter = a.passed === 0 && a.failed === 0 && a.files === 0;
  if (noBefore && noAfter) {
    return {
      verdict: "skipped",
      reason: "no test command produced output on either side (0 / 0)",
      details: [],
      before: beforeStr,
      after: afterStr,
      evidence: [
        { label: "before", value: beforeStr, ok: false },
        { label: "after", value: afterStr, ok: false },
        {
          label: "diagnosis",
          value: "no `test` script defined OR `npm test` produced no parseable summary",
        },
      ],
      confidence: "low",
      caveat:
        "Add a `test` script (vitest / jest / mocha — the parser looks for a " +
        "`Tests N passed` summary line) for this axis to be meaningful.",
    };
  }

  const passedDelta = a.passed - b.passed;
  const failedDelta = a.failed - b.failed;
  const filesDelta = a.files - b.files;

  const evidence: Evidence[] = [
    { label: "before", value: beforeStr },
    { label: "after", value: afterStr, ok: a.failed === 0 ? true : false },
    {
      label: "delta",
      value:
        `${passedDelta >= 0 ? "+" : ""}${passedDelta} passed · ` +
        `${failedDelta >= 0 ? "+" : ""}${failedDelta} failed · ` +
        `${filesDelta >= 0 ? "+" : ""}${filesDelta} file(s)`,
      ok: failedDelta <= 0,
    },
  ];

  const caveat =
    "Test counts come from parsing the `npm test` output. The parser " +
    "looks for vitest/jest-style `Tests N passed/failed` lines — exotic " +
    "runners may need a wrapper script.";

  if (a.failed > b.failed) {
    return {
      verdict: "fail",
      reason: `${a.failed - b.failed} new test failure(s)`,
      details: [],
      before: beforeStr,
      after: afterStr,
      evidence,
      confidence: "high",
      caveat,
    };
  }
  if (a.passed < b.passed) {
    return {
      verdict: "warn",
      reason: `passing test count dropped (${b.passed} → ${a.passed})`,
      details: [],
      before: beforeStr,
      after: afterStr,
      evidence,
      confidence: "high",
      caveat,
    };
  }
  return {
    verdict: "pass",
    reason:
      passedDelta > 0
        ? `+${passedDelta} test(s) added · 0 regressions`
        : "no new test failures",
    details: [],
    before: beforeStr,
    after: afterStr,
    evidence,
    confidence: "high",
    caveat,
  };
}

// ─── Axis 4: perf regression ────────────────────────────────────────

export function comparePerf(
  before: Baseline,
  after: Pick<Baseline, "perfMs">,
): AxisResult & { deltaPercent: number } {
  const evidence: Evidence[] = [];
  let worstDelta = 0;
  let worstName = "";
  let comparedCount = 0;

  for (const [name, beforeMs] of Object.entries(before.perfMs)) {
    const afterMs = after.perfMs[name];
    if (afterMs == null) continue;
    if (beforeMs <= 0) continue;
    comparedCount += 1;
    const delta = ((afterMs - beforeMs) / beforeMs) * 100;
    const rounded = Number(delta.toFixed(1));
    evidence.push({
      label: name,
      value:
        `baseline ${beforeMs} ms → current ${afterMs} ms (${rounded >= 0 ? "+" : ""}${rounded}%)`,
      ok: rounded < 10,
    });
    if (delta > worstDelta) {
      worstDelta = delta;
      worstName = name;
    }
  }
  const rounded = Number(worstDelta.toFixed(1));

  if (comparedCount === 0) {
    return {
      verdict: "skipped",
      reason: "no overlapping perf samples in baseline + post-session snapshots",
      details: [],
      deltaPercent: 0,
      evidence: [{ label: "samples compared", value: "0", ok: false }],
      confidence: "low",
      caveat:
        "Perf axis needs the same command names in both snapshots. " +
        "If the baseline was captured before perf instrumentation was " +
        "added, the axis can't run — re-baseline.",
    };
  }

  const caveat =
    `Sample = ${comparedCount} command(s), 3 trials each (median). ` +
    `CI runtime variance can produce ±10% noise; treat <10% deltas as inconclusive. ` +
    `Threshold: warn ≥ 10%, fail ≥ 25%.`;

  if (rounded >= 25) {
    return {
      verdict: "fail",
      reason: `${worstName} ${rounded}% slower than baseline`,
      details: [],
      deltaPercent: rounded,
      evidence,
      confidence: "medium",
      caveat,
    };
  }
  if (rounded >= 10) {
    return {
      verdict: "warn",
      reason: `${worstName} ${rounded}% slower than baseline`,
      details: [],
      deltaPercent: rounded,
      evidence,
      confidence: "medium",
      caveat,
    };
  }
  return {
    verdict: "pass",
    reason:
      worstName.length > 0
        ? `worst-case ${worstName} only ${rounded}% slower (${comparedCount} command(s) compared)`
        : "no perf samples to compare",
    details: [],
    deltaPercent: rounded,
    evidence,
    confidence: "medium",
    caveat,
  };
}

// ─── Axis 5: AI narrative ───────────────────────────────────────────

export interface NarrativeAxisInput {
  trace: SessionTrace;
  diffs: Record<string, { diff: string; filesTouched: string[] }>;
}

export function evaluateNarrativeAxis(input: NarrativeAxisInput): AxisResult & {
  checks: NarrativeCheck[];
} {
  const checks: NarrativeCheck[] = [];
  for (const c of input.trace.commits) {
    const d = input.diffs[c.hash];
    if (!d) continue;
    checks.push(verifyNarrative(c.message, d.diff, d.filesTouched, c.hash));
  }

  const aiCount = aiCommitCount(input.trace);
  const totalCommits = input.trace.commits.length;

  // Skipped: zero AI commits in trace window — there is nothing to verify.
  // The v0.27 audit reported this as `pass` ("no commits with diffs to
  // verify").  That was a lie.  We say `skipped` now.
  if (aiCount === 0 && totalCommits === 0) {
    return {
      verdict: "skipped",
      reason: "no commits in trace window — nothing to verify",
      details: [],
      checks,
      evidence: [
        { label: "trace window", value: "empty (HEAD === baseline)" },
        { label: "AI commits", value: "0", ok: false },
      ],
      confidence: "low",
      caveat:
        "Run an AI session that lands at least one commit before " +
        "`--certify` for this axis to be meaningful.",
    };
  }
  if (aiCount === 0) {
    return {
      verdict: "skipped",
      reason: `no AI-attributed commits in trace window (${totalCommits} human commit(s))`,
      details: [],
      checks,
      evidence: [
        { label: "trace window", value: `${totalCommits} commit(s)` },
        { label: "AI commits", value: "0", ok: false },
        { label: "vendors detected", value: "none" },
      ],
      confidence: "low",
      caveat:
        "AI-narrative axis only runs over commits attributed to a known " +
        "vendor (Claude / Cursor / Codex / Devin / Sweep / Aider / Copilot). " +
        "Adjust vendor rules or `--since` window if you expected AI commits here.",
    };
  }

  const verifiedClaims = checks.reduce(
    (s, c) => s + c.verifications.filter((v) => v.verdict === "verified").length,
    0,
  );
  const contradictedClaims = checks.reduce(
    (s, c) => s + c.verifications.filter((v) => v.verdict === "contradicted").length,
    0,
  );
  const unverifiableClaims = checks.reduce(
    (s, c) => s + c.verifications.filter((v) => v.verdict === "unverifiable").length,
    0,
  );

  const evidence: Evidence[] = [
    { label: "AI commits checked", value: String(checks.length), ok: checks.length > 0 },
    { label: "claims verified", value: String(verifiedClaims), ok: true },
    {
      label: "claims contradicted",
      value: String(contradictedClaims),
      ok: contradictedClaims === 0,
    },
    {
      label: "claims unverifiable",
      value: String(unverifiableClaims),
      ok: "neutral",
    },
  ];
  // Per-commit one-liners (cap to keep evidence array tight).
  for (const check of checks.slice(0, 8)) {
    const contradicts = check.verifications.filter((v) => v.verdict === "contradicted").length;
    const verifies = check.verifications.filter((v) => v.verdict === "verified").length;
    evidence.push({
      label: check.commitHash.slice(0, 7),
      value:
        `trust ${check.narrativeTrustScore.toFixed(2)} · ` +
        `${verifies} verified · ${contradicts} contradicted · ` +
        `${check.verifications.length} claim(s)`,
      ok: contradicts === 0,
    });
  }
  if (checks.length > 8) {
    evidence.push({ label: "…", value: `+${checks.length - 8} more commits`, ok: "neutral" });
  }

  const caveat =
    `"Claims" = parseable factual statements extracted from commit messages ` +
    `(e.g. "no change to X", "adds Y", "fixes Z"). Vague claims like ` +
    `"improved" or "fixed" are marked unverifiable, not failed.`;

  if (hasContradiction(checks)) {
    return {
      verdict: "fail",
      reason: `${contradictedClaims} commit-message claim(s) contradicted by diff`,
      details: [],
      checks,
      evidence,
      confidence: "high",
      caveat,
    };
  }
  const trust = aggregateNarrativeTrust(checks);
  if (trust < 0.6) {
    return {
      verdict: "warn",
      reason: `aggregate narrative trust ${trust.toFixed(2)} below 0.6`,
      details: [],
      checks,
      evidence,
      confidence: "high",
      caveat,
    };
  }
  return {
    verdict: "pass",
    reason: `aggregate narrative trust ${trust.toFixed(2)} across ${checks.length} commit(s)`,
    details: [],
    checks,
    evidence,
    confidence: "high",
    caveat,
  };
}

// ─── Forensic axes (size / files / style / time) ────────────────────

/**
 * Forensic axis classification — translate an anomaly score into a
 * verdict + structured evidence.  A bare numeric score is no longer
 * acceptable; callers must pass the score AND a human-readable note
 * (or accept the placeholder "no anomaly-detector data").
 *
 * Score 0 with no note → `skipped` (the v0.27 default of "pass" was
 * rubber-stamping; we refuse).
 */
export function classifyForensicAxis(
  score: number,
  note?: string,
): ForensicAxisResult {
  // Caveats per axis — surfaced verbatim so reviewers see what each
  // forensic axis does NOT check.
  const caveat =
    "Forensic axes use the `mneme forensics anomaly` engine — z-score " +
    "of this session vs the author's last 50 commits. " +
    "Score ≥ 0.7 = fail · 0.4–0.7 = warn · < 0.4 = pass · no data = skipped.";

  if (score === 0 && (!note || note.length === 0)) {
    return {
      verdict: "skipped",
      score: 0,
      reason: "no anomaly-detector data supplied",
      evidence: [
        { label: "score", value: "0.0 (default — no data)", ok: false },
      ],
      caveat,
    };
  }
  const evidence: Evidence[] = [
    { label: "score", value: score.toFixed(2) },
  ];
  if (note) evidence.push({ label: "note", value: note });

  if (score >= 0.7) {
    return {
      verdict: "fail",
      score,
      reason: note ?? `anomaly score ${score.toFixed(2)} ≥ 0.7`,
      evidence,
      caveat,
    };
  }
  if (score >= 0.4) {
    return {
      verdict: "warn",
      score,
      reason: note ?? `anomaly score ${score.toFixed(2)} in 0.4–0.7 band`,
      evidence,
      caveat,
    };
  }
  return {
    verdict: "pass",
    score,
    reason: note ?? `anomaly score ${score.toFixed(2)} below 0.4`,
    evidence,
    caveat,
  };
}

// ─── Top-level builder ──────────────────────────────────────────────

export interface ForensicScoreInput {
  size: { score: number; note?: string };
  files: { score: number; note?: string };
  style: { score: number; note?: string };
  time: { score: number; note?: string };
}

export interface CertifyInput {
  sessionId: string;
  beforeBaseline: Baseline;
  afterBaseline: Baseline;
  trace: SessionTrace;
  diffs: Record<string, { diff: string; filesTouched: string[] }>;
  /** Per-axis forensic scores + notes.  Default: all-skipped. */
  forensicScores?: Partial<ForensicScoreInput>;
  /**
   * --strict: treat `skipped` axes as `fail`.  For compliance
   * environments where missing data IS a failure.
   */
  strict?: boolean;
}

/**
 * Are the before/after baselines effectively identical (i.e. the session
 * did nothing measurable)?  Used by the pre-flight tripwire.
 */
function baselinesIdentical(before: Baseline, after: Baseline): boolean {
  if (before.headHash !== after.headHash) return false;
  for (const k of Object.keys(before.outputs)) {
    if (before.outputs[k]?.stdoutHash !== after.outputs[k]?.stdoutHash) return false;
  }
  if (before.testPassRate.passed !== after.testPassRate.passed) return false;
  if (before.testPassRate.failed !== after.testPassRate.failed) return false;
  // We deliberately ignore tiny perf jitter here.
  return true;
}

export function buildCertificate(input: CertifyInput): AuditCertificate {
  const behavioralParity = compareBehavioralParity(input.beforeBaseline, input.afterBaseline);
  const apiContractDrift = compareApiSurface(input.beforeBaseline, input.afterBaseline);
  const testPassRate = compareTestPassRate(input.beforeBaseline, input.afterBaseline);
  const perfRegression = comparePerf(input.beforeBaseline, input.afterBaseline);
  const aiNarrative = evaluateNarrativeAxis({ trace: input.trace, diffs: input.diffs });

  const fScores = input.forensicScores ?? {};
  const forensicAxes = {
    size: classifyForensicAxis(fScores.size?.score ?? 0, fScores.size?.note),
    files: classifyForensicAxis(fScores.files?.score ?? 0, fScores.files?.note),
    style: classifyForensicAxis(fScores.style?.score ?? 0, fScores.style?.note),
    time: classifyForensicAxis(fScores.time?.score ?? 0, fScores.time?.note),
  };

  const mainVerdicts = [
    behavioralParity.verdict,
    apiContractDrift.verdict,
    testPassRate.verdict,
    perfRegression.verdict,
    aiNarrative.verdict,
  ];
  const allVerdicts = [
    ...mainVerdicts,
    forensicAxes.size.verdict,
    forensicAxes.files.verdict,
    forensicAxes.style.verdict,
    forensicAxes.time.verdict,
  ];

  // Coverage = how many of the 5 main axes carry real evidence.
  const skippedMain = mainVerdicts.filter((v) => v === "skipped").length;
  const verifiedMain = mainVerdicts.length - skippedMain;
  const confidence: AxisConfidence =
    verifiedMain >= 4 ? "high" : verifiedMain >= 3 ? "medium" : "low";
  const coverage = {
    verified: verifiedMain,
    skipped: skippedMain,
    total: mainVerdicts.length,
    confidence,
  };

  // Pre-flight tripwire: zero AI commits AND baselines are identical →
  // refuse to issue a verdict.  Nothing happened to audit.
  let insufficientData: AuditCertificate["insufficientData"] | undefined;
  if (
    aiCommitCount(input.trace) === 0 &&
    input.trace.commits.length === 0 &&
    baselinesIdentical(input.beforeBaseline, input.afterBaseline)
  ) {
    insufficientData = {
      reason:
        "no AI-attributed commits AND no measurable change between " +
        "before/after baselines — there is nothing to certify",
      hint:
        "Capture a baseline (`mneme audit --baseline`), let an AI tool work " +
        "on the repo and commit something, then re-run `--certify`.",
    };
  }

  // Combine.  A real `fail` anywhere wins — including a forensic axis
  // that fired even though the main axes had nothing to chew on.
  // Otherwise the pre-flight tripwire forces overall=warn (no signal,
  // not a failure).  --strict promotes warn/skipped → fail.
  const combined = combineVerdicts(allVerdicts, { strict: input.strict });
  let overall: AxisVerdict;
  if (combined === "fail") {
    overall = "fail";
  } else if (insufficientData) {
    overall = input.strict ? "fail" : "warn";
  } else {
    overall = combined;
  }

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
    coverage,
    insufficientData,
    exitCode: overall === "fail" ? 1 : 0,
  };
}

/**
 * Orchestrates the full certify pipeline against a real repo.
 */
export async function certifySession(
  repoRoot: string,
  baseline: Baseline,
  trace: SessionTrace,
  diffs: Record<string, { diff: string; filesTouched: string[] }> = {},
  runner: Runner = realRunner,
  opts: { strict?: boolean } = {},
): Promise<AuditCertificate> {
  const after = await captureBaseline(repoRoot, runner);
  return buildCertificate({
    sessionId: trace.toHash.slice(0, 7) || "unknown",
    beforeBaseline: baseline,
    afterBaseline: after,
    trace,
    diffs,
    strict: opts.strict,
  });
}
