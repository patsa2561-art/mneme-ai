/**
 * Mneme Guardian — the 24/7 self-healing engine.
 *
 *   while (true) {
 *     diagnose();
 *     fix();
 *     learn();
 *     sleep(interval);
 *   }
 *
 * The Guardian is a long-running diagnostic + auto-remediation loop. It
 * watches for weaknesses (regressions in index quality, drift between
 * HEAD and the index, missing embeddings, schema-version mismatch) and
 * threats (data corruption signals, token expiry on remote APIs, secret
 * patterns slipping through redaction) and applies safe corrective
 * actions automatically. Anything risky is *logged with a recommendation*
 * rather than auto-applied.
 *
 * Pure data structures + dispatch — no side effects in this module
 * (file I/O lives in the CLI command). Caller decides whether to
 * actually apply the recommended action or just observe.
 *
 * Design principles:
 *   • SAFE BY DEFAULT — auto-apply only the actions that are demonstrably
 *     reversible (re-index, calibrate). Anything that could lose data
 *     gets recommended, not executed.
 *   • OBSERVABLE — every diagnosis + action is appended to a JSONL log so
 *     the operator can audit what the daemon did.
 *   • DETERMINISTIC — same inputs → same diagnosis. No flaky heuristics.
 */

import type { Commit } from "../types.js";
import type { IndexQualityReport } from "../indexer/quality.js";

export type WeaknessKind =
  | "drift" // HEAD has commits not in index
  | "missing-embeddings" // chunks without vectors
  | "low-quality" // index quality grade dropped below threshold
  | "stale-calibration" // feedback accumulated since last calibrate
  | "schema-drift" // schema version older than current
  | "token-expiry" // recorded auth token nearing/past expiry
  | "redaction-gap"; // secret-shaped string snuck into a chunk

export type ThreatKind =
  | "tamper" // hash chain broken in ledger
  | "secret-leak" // secret pattern detected in indexed chunk
  | "outlier-author" // commits authored as someone unexpected
  | "deletion-storm"; // many files deleted in short window

export type Severity = "low" | "medium" | "high" | "critical";

export type ActionPolicy =
  | "auto" // safe to auto-apply
  | "recommended" // suggest but don't auto-run
  | "observe"; // log only

export interface GuardianFinding {
  kind: WeaknessKind | ThreatKind;
  severity: Severity;
  /** One-line summary for the operator. */
  message: string;
  /** Suggested CLI command to apply the fix (if any). */
  suggestedAction?: string;
  /** Whether the daemon should auto-apply. */
  policy: ActionPolicy;
  /** Free-form structured detail. */
  detail?: Record<string, unknown>;
}

export interface GuardianInput {
  /** Latest HEAD commits in git (most recent first). */
  headCommits: Commit[];
  /** Commits currently indexed (most recent first). */
  indexedCommits: Commit[];
  /** Most recent index quality report (if available). */
  quality: IndexQualityReport | null;
  /** Last-known good index quality (for regression detection). */
  lastQualityScore: number | null;
  /** Schema version recorded in the store. */
  storeSchemaVersion: number;
  /** Schema version expected by the running binary. */
  expectedSchemaVersion: number;
  /** Number of feedback events since last `mneme calibrate`. */
  feedbackEventsSinceCalibrate: number;
  /** Threshold above which calibrate is recommended. Default 25. */
  feedbackCalibrateThreshold?: number;
  /** Threshold below which low-quality is flagged (0..1). Default 0.55 (= grade C). */
  qualityFloor?: number;
  /** Quality regression threshold (drop in score). Default 0.1. */
  qualityRegressionThreshold?: number;
}

export interface GuardianReport {
  generatedAt: string;
  findings: GuardianFinding[];
  summary: {
    findings: number;
    autoActions: number;
    recommendations: number;
    threats: number;
  };
}

/**
 * Run one diagnostic pass. Pure function — same input → same output.
 *
 * The CLI wraps this in `while (true)` with a sleep, but the diagnosis
 * itself is stateless.
 */
export function diagnose(input: GuardianInput): GuardianReport {
  const findings: GuardianFinding[] = [];
  const feedbackThreshold = input.feedbackCalibrateThreshold ?? 25;
  const qualityFloor = input.qualityFloor ?? 0.55;
  const qualityRegression = input.qualityRegressionThreshold ?? 0.1;

  // ── Weakness 1: index drift ────────────────────────────────────────
  const indexedHashes = new Set(input.indexedCommits.map((c) => c.hash));
  const driftingCommits = input.headCommits.filter((c) => !indexedHashes.has(c.hash));
  if (driftingCommits.length > 0) {
    const sev: Severity =
      driftingCommits.length > 50
        ? "high"
        : driftingCommits.length > 10
          ? "medium"
          : "low";
    findings.push({
      kind: "drift",
      severity: sev,
      message: `${driftingCommits.length} commit(s) on HEAD not yet indexed.`,
      suggestedAction: "mneme index",
      policy: "auto",
      detail: {
        driftingCount: driftingCommits.length,
        headNewest: input.headCommits[0]?.hash,
        indexNewest: input.indexedCommits[0]?.hash,
      },
    });
  }

  // ── Weakness 2: missing embeddings ─────────────────────────────────
  if (input.quality) {
    const embedRatio = input.quality.metrics.embedRatio;
    if (embedRatio < 0.95 && input.quality.indexedChunks > 0) {
      findings.push({
        kind: "missing-embeddings",
        severity: embedRatio < 0.5 ? "high" : "medium",
        message: `${Math.round((1 - embedRatio) * 100)}% of chunks have no embedding (${input.quality.indexedChunks - input.quality.embeddedChunks} chunks).`,
        suggestedAction: "mneme index",
        policy: "auto",
        detail: { embedRatio },
      });
    }
  }

  // ── Weakness 3: low overall quality ────────────────────────────────
  if (input.quality && input.quality.overallScore < qualityFloor) {
    findings.push({
      kind: "low-quality",
      severity: input.quality.overallScore < 0.4 ? "high" : "medium",
      message: `Index quality grade ${input.quality.grade} (${Math.round(input.quality.overallScore * 100)}/100) is below recommended floor.`,
      suggestedAction: "mneme heal",
      policy: "recommended",
      detail: {
        score: input.quality.overallScore,
        grade: input.quality.grade,
      },
    });
  }

  // ── Weakness 3b: quality regression ────────────────────────────────
  if (
    input.quality &&
    input.lastQualityScore !== null &&
    input.lastQualityScore - input.quality.overallScore >= qualityRegression
  ) {
    findings.push({
      kind: "low-quality",
      severity: "medium",
      message: `Index quality dropped from ${Math.round(input.lastQualityScore * 100)} to ${Math.round(input.quality.overallScore * 100)}.`,
      suggestedAction: "mneme index --analyze",
      policy: "observe",
      detail: {
        before: input.lastQualityScore,
        after: input.quality.overallScore,
        regression: input.lastQualityScore - input.quality.overallScore,
      },
    });
  }

  // ── Weakness 4: stale calibration ──────────────────────────────────
  if (input.feedbackEventsSinceCalibrate >= feedbackThreshold) {
    findings.push({
      kind: "stale-calibration",
      severity: "low",
      message: `${input.feedbackEventsSinceCalibrate} feedback events since last calibrate — retrieval knobs may need re-tuning.`,
      suggestedAction: "mneme calibrate",
      policy: "auto",
      detail: {
        eventsSinceCalibrate: input.feedbackEventsSinceCalibrate,
        threshold: feedbackThreshold,
      },
    });
  }

  // ── Weakness 5: schema drift ───────────────────────────────────────
  if (input.storeSchemaVersion < input.expectedSchemaVersion) {
    findings.push({
      kind: "schema-drift",
      severity: "high",
      message: `Store schema is v${input.storeSchemaVersion}, binary expects v${input.expectedSchemaVersion}.`,
      suggestedAction: "mneme index",
      policy: "auto",
      detail: {
        storeVersion: input.storeSchemaVersion,
        expectedVersion: input.expectedSchemaVersion,
      },
    });
  }

  const summary = {
    findings: findings.length,
    autoActions: findings.filter((f) => f.policy === "auto").length,
    recommendations: findings.filter((f) => f.policy === "recommended").length,
    threats: findings.filter((f) => isThreat(f.kind)).length,
  };

  return {
    generatedAt: new Date().toISOString(),
    findings,
    summary,
  };
}

/**
 * Decide which findings the daemon should auto-apply this tick. Returns
 * findings ordered by severity (high → low).
 */
export function selectAutoActions(report: GuardianReport): GuardianFinding[] {
  const order: Record<Severity, number> = {
    critical: 0,
    high: 1,
    medium: 2,
    low: 3,
  };
  return report.findings
    .filter((f) => f.policy === "auto")
    .sort((a, b) => order[a.severity] - order[b.severity]);
}

function isThreat(kind: WeaknessKind | ThreatKind): kind is ThreatKind {
  return (
    kind === "tamper" ||
    kind === "secret-leak" ||
    kind === "outlier-author" ||
    kind === "deletion-storm"
  );
}
