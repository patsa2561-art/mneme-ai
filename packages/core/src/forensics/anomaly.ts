/**
 * Insider-threat anomaly detection — flag commits that deviate from an
 * author's baseline profile far enough that "compromised credentials"
 * or "rogue contributor" become plausible explanations.
 *
 * Method: build a per-author baseline from their entire history (the
 * "normal Alice"), then for each new commit measure deviation across
 * four independent axes:
 *
 *   • TIME       — distance from author's UTC peak window
 *   • FILES      — fraction of touched files the author has never
 *                  touched before (out-of-domain signal)
 *   • STYLE      — leading-verb novelty + commit-size deviation
 *   • SIZE       — z-score of insertions+deletions vs author's median
 *
 * Each axis emits a normalized 0..1 deviation. The composite score is
 * a weighted sum (not a vector norm — independent contribution is
 * easier to explain to a security analyst).
 *
 * This is the bank/finance scenario. Use case: a credential is stolen,
 * the attacker pushes a commit at 03:47 UTC touching auth code with
 * verbs Alice never uses — Mneme flags it before review, with a
 * specific explanation per axis.
 *
 * Pure data extraction. No external services. No false promise of 100%
 * accuracy — anomaly detection is fundamentally probabilistic. We
 * surface candidates with explanations; humans decide.
 */
import type { Commit, FileChange } from "../types.js";

export interface AuthorBaseline {
  author: string;
  commitCount: number;
  /** UTC peak hour (start of 4-hour window). */
  peakHour: number;
  /** Histogram of commits by UTC hour, normalized. */
  hourHistogram: number[];
  /** Files this author has ever touched (set). */
  knownFiles: Set<string>;
  /** Set of leading-verb tokens seen in subject lines. */
  knownVerbs: Set<string>;
  /** Median insertions+deletions per commit. */
  medianChurn: number;
  /** Median absolute deviation of churn (robust σ analog). */
  churnMad: number;
}

export interface AnomalyDeviation {
  axis: "time" | "files" | "style" | "size";
  /** 0..1 — bigger is more anomalous. */
  score: number;
  /** Free-form note for rendering. */
  note: string;
}

export interface AnomalyFinding {
  commit: Commit;
  /** Composite score in [0, 4]. */
  totalDeviation: number;
  /** Approximate σ from baseline (0.5 deviation ≈ 1σ heuristic). */
  approxSigma: number;
  axes: AnomalyDeviation[];
  severity: "low" | "medium" | "high" | "critical";
  /** Recommended next step. */
  recommendation: string;
}

const AXIS_WEIGHTS = {
  time: 1.0,
  files: 1.0,
  style: 0.7,
  size: 0.8,
};

/**
 * Build a baseline profile per author from all their historical commits.
 *
 * The caller passes commits AND file-changes; if file-changes are
 * unavailable we fall back to commit.files (which carries paths only —
 * still useful for the "files novelty" signal).
 */
export function buildBaselines(
  commits: Commit[],
  fileChanges: FileChange[] = [],
): Map<string, AuthorBaseline> {
  const byAuthor = new Map<string, Commit[]>();
  for (const c of commits) {
    const a = c.authorEmail.toLowerCase() || c.authorName.toLowerCase();
    const arr = byAuthor.get(a);
    if (arr) arr.push(c);
    else byAuthor.set(a, [c]);
  }

  const fcByCommit = new Map<string, FileChange[]>();
  for (const fc of fileChanges) {
    const arr = fcByCommit.get(fc.commitHash);
    if (arr) arr.push(fc);
    else fcByCommit.set(fc.commitHash, [fc]);
  }

  const out = new Map<string, AuthorBaseline>();
  for (const [author, list] of byAuthor) {
    const hourHistogram = new Array(24).fill(0);
    const knownFiles = new Set<string>();
    const knownVerbs = new Set<string>();
    const churnSamples: number[] = [];

    for (const c of list) {
      const t = new Date(c.authorDate).getTime();
      if (!Number.isNaN(t)) {
        const h = new Date(t).getUTCHours();
        hourHistogram[h] = (hourHistogram[h] ?? 0) + 1;
      }
      for (const f of c.files ?? []) knownFiles.add(f);
      const subj = (c.subject || "").trim();
      const w = (subj.match(/^[A-Za-z]+/)?.[0] || "").toLowerCase();
      if (w) knownVerbs.add(w);

      const fcs = fcByCommit.get(c.hash) ?? [];
      const churn = fcs.reduce((s, x) => s + x.insertions + x.deletions, 0);
      churnSamples.push(churn);
    }

    // Normalize histogram
    const total = list.length;
    for (let i = 0; i < 24; i++) hourHistogram[i] /= Math.max(1, total);

    // Peak hour (4-hour band)
    let peakHour = 0;
    let bestSum = -1;
    for (let i = 0; i < 24; i++) {
      let s = 0;
      for (let k = 0; k < 4; k++) s += hourHistogram[(i + k) % 24];
      if (s > bestSum) {
        bestSum = s;
        peakHour = i;
      }
    }

    // Median + MAD churn
    const sorted = [...churnSamples].sort((a, b) => a - b);
    const medianChurn = median(sorted);
    const deviations = churnSamples.map((x) => Math.abs(x - medianChurn));
    deviations.sort((a, b) => a - b);
    const churnMad = Math.max(1, median(deviations));

    out.set(author, {
      author,
      commitCount: list.length,
      peakHour,
      hourHistogram,
      knownFiles,
      knownVerbs,
      medianChurn,
      churnMad,
    });
  }

  return out;
}

function median(sorted: number[]): number {
  if (sorted.length === 0) return 0;
  const m = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? sorted[m]! : (sorted[m - 1]! + sorted[m]!) / 2;
}

/**
 * Score a single commit against its author's baseline. Returns axis
 * deviations + composite score.
 */
export function scoreAnomaly(
  commit: Commit,
  baseline: AuthorBaseline,
  fileChanges: FileChange[] = [],
): AnomalyFinding {
  // ── TIME axis ──────────────────────────────────────────────────────
  const t = new Date(commit.authorDate).getTime();
  let timeScore = 0;
  let timeNote = "time within author's normal window";
  if (!Number.isNaN(t)) {
    const h = new Date(t).getUTCHours();
    // Distance to peak window (cyclic min over 4-hour window starting at peakHour)
    const inWindow = (h - baseline.peakHour + 24) % 24;
    const distance = Math.min(inWindow, 24 - inWindow);
    if (distance >= 4) {
      // Outside the 4-hour peak window — bigger distance = bigger score
      timeScore = Math.min(1, (distance - 3) / 8); // 0 at edge, 1 at 11h+
      timeNote = `commit hour ${pad2(h)}:00 UTC is ${distance}h from author's peak window ${pad2(baseline.peakHour)}:00–${pad2((baseline.peakHour + 4) % 24)}:00`;
    }
    // Hour-rarity bonus: if this hour is a near-zero in the histogram,
    // bump the score even if it falls within "window"
    const hourFreq = baseline.hourHistogram[h] ?? 0;
    if (hourFreq < 0.01 && baseline.commitCount >= 20) {
      timeScore = Math.max(timeScore, 0.7);
      timeNote += ` · hour frequency ${pct(hourFreq)} in author history`;
    }
  }

  // ── FILES axis ─────────────────────────────────────────────────────
  const files = commit.files ?? [];
  let unseen = 0;
  const newFiles: string[] = [];
  for (const f of files) {
    if (!baseline.knownFiles.has(f)) {
      unseen += 1;
      newFiles.push(f);
    }
  }
  const fileScore = files.length === 0 ? 0 : unseen / files.length;
  const fileNote =
    unseen === 0
      ? "all files in commit have been touched by author before"
      : `${unseen}/${files.length} files are new for this author (e.g. ${newFiles.slice(0, 2).join(", ")}${newFiles.length > 2 ? "…" : ""})`;

  // ── STYLE axis ─────────────────────────────────────────────────────
  const subj = (commit.subject || "").trim();
  const verb = (subj.match(/^[A-Za-z]+/)?.[0] || "").toLowerCase();
  let styleScore = 0;
  let styleNote = "verb is in author's known vocabulary";
  if (verb && !baseline.knownVerbs.has(verb) && baseline.commitCount >= 10) {
    styleScore = 0.6;
    styleNote = `verb "${verb}" not in author's vocabulary (${baseline.knownVerbs.size} verbs across ${baseline.commitCount} commits)`;
  }

  // ── SIZE axis ──────────────────────────────────────────────────────
  const fcs = fileChanges.filter((f) => f.commitHash === commit.hash);
  const churn = fcs.reduce((s, x) => s + x.insertions + x.deletions, 0);
  const robustZ = Math.abs(churn - baseline.medianChurn) / Math.max(1, baseline.churnMad);
  const sizeScore = Math.min(1, robustZ / 8); // 8-MAD = score 1.0
  const sizeNote =
    churn === 0
      ? "(no churn data — file-changes not provided)"
      : `+${churn} lines vs author's median ${baseline.medianChurn} (robust z = ${robustZ.toFixed(1)})`;

  // ── Composite ──────────────────────────────────────────────────────
  const axes: AnomalyDeviation[] = [
    { axis: "time", score: timeScore, note: timeNote },
    { axis: "files", score: fileScore, note: fileNote },
    { axis: "style", score: styleScore, note: styleNote },
    { axis: "size", score: sizeScore, note: sizeNote },
  ];

  const totalDeviation =
    AXIS_WEIGHTS.time * timeScore +
    AXIS_WEIGHTS.files * fileScore +
    AXIS_WEIGHTS.style * styleScore +
    AXIS_WEIGHTS.size * sizeScore;

  // 1 deviation point ≈ 2σ heuristic
  const approxSigma = totalDeviation * 2;

  let severity: AnomalyFinding["severity"] = "low";
  if (totalDeviation >= 2.5) severity = "critical";
  else if (totalDeviation >= 1.7) severity = "high";
  else if (totalDeviation >= 0.9) severity = "medium";

  let recommendation = "no action required";
  if (severity === "critical") {
    recommendation =
      "review immediately; verify author identity out-of-band (chat, video, in-person) before merging";
  } else if (severity === "high") {
    recommendation =
      "elevated review; require explicit approval from a second engineer";
  } else if (severity === "medium") {
    recommendation = "include in standard PR review with attention";
  }

  return {
    commit,
    totalDeviation: Number(totalDeviation.toFixed(3)),
    approxSigma: Number(approxSigma.toFixed(2)),
    axes,
    severity,
    recommendation,
  };
}

/**
 * Score every commit in `commits` against the corresponding author
 * baseline. Returns only findings whose composite score exceeds
 * `threshold` (default 0.9 = ~"medium" severity).
 */
export function detectAnomalies(
  commits: Commit[],
  baselines: Map<string, AuthorBaseline>,
  fileChanges: FileChange[] = [],
  threshold = 0.9,
): AnomalyFinding[] {
  const findings: AnomalyFinding[] = [];
  for (const c of commits) {
    const a = c.authorEmail.toLowerCase() || c.authorName.toLowerCase();
    const baseline = baselines.get(a);
    if (!baseline || baseline.commitCount < 5) continue; // need minimum data
    const finding = scoreAnomaly(c, baseline, fileChanges);
    if (finding.totalDeviation >= threshold) findings.push(finding);
  }
  return findings.sort((a, b) => b.totalDeviation - a.totalDeviation);
}

function pad2(n: number): string {
  return n < 10 ? "0" + n : "" + n;
}

function pct(r: number): string {
  return `${(r * 100).toFixed(1)}%`;
}
