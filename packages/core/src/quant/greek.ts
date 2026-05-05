/**
 * `mneme greek` — sensitivity analysis (Δ Γ Θ ν) for a codebase.
 *
 *   Δ DELTA  — sensitivity to the top contributor (% knowledge lost if X quits)
 *   Γ GAMMA  — acceleration of risk (super-linear scaling of bug rate vs PR rate)
 *   Θ THETA  — time decay (untouched files lose coverage over time)
 *   ν VEGA   — sensitivity to dependency volatility (placeholder for now)
 *
 * Pure analysis. Delta + Gamma are required and computed from store data.
 * Theta is best-effort (depends on coverage indexed). Vega returns null
 * unless dependency manifest data is available — honestly.
 */

import type { MnemeStore } from "../store/sqlite.js";

// ─── Δ DELTA — sensitivity to top contributor ──────────────────────────

export interface DeltaResult {
  /** The author name. */
  name: string;
  /** Email. */
  email: string;
  /** Files where this author owns ≥ 75% of touches. */
  ownedFiles: string[];
  /** Approximate % of knowledge that walks out the door if they quit. */
  knowledgeLossPct: number;
}

export function computeDelta(store: MnemeStore, opts: { topN?: number } = {}): DeltaResult[] {
  const topN = opts.topN ?? 5;

  // Pull file-author distribution.
  const rows = store.db
    .prepare(
      `SELECT
         fc.path                AS path,
         c.author_name          AS author_name,
         c.author_email         AS author_email,
         COUNT(*)               AS touches
       FROM file_changes fc
       JOIN commits c ON c.hash = fc.commit_hash
       GROUP BY fc.path, c.author_name, c.author_email`,
    )
    .all() as Array<{ path: string; author_name: string; author_email: string; touches: number }>;

  // Per-file totals.
  const fileTotals = new Map<string, number>();
  for (const r of rows) fileTotals.set(r.path, (fileTotals.get(r.path) ?? 0) + r.touches);

  // Per-(file, author) — find top owner per file.
  const topOwnerPerFile = new Map<string, { name: string; email: string; touches: number }>();
  for (const r of rows) {
    const cur = topOwnerPerFile.get(r.path);
    if (!cur || r.touches > cur.touches) {
      topOwnerPerFile.set(r.path, { name: r.author_name, email: r.author_email, touches: r.touches });
    }
  }

  // Aggregate per author: which files do they own (≥ 75%)?
  type Bucket = { name: string; email: string; ownedFiles: string[] };
  const byAuthor = new Map<string, Bucket>();
  let totalFiles = 0;
  for (const [file, top] of topOwnerPerFile) {
    totalFiles += 1;
    const total = fileTotals.get(file) ?? 1;
    if (top.touches / total < 0.75) continue;
    const key = `${top.name}|${top.email}`;
    if (!byAuthor.has(key)) byAuthor.set(key, { name: top.name, email: top.email, ownedFiles: [] });
    byAuthor.get(key)!.ownedFiles.push(file);
  }

  const results: DeltaResult[] = [];
  for (const b of byAuthor.values()) {
    const knowledgeLossPct = totalFiles === 0 ? 0 : Math.round((b.ownedFiles.length / totalFiles) * 100);
    results.push({
      name: b.name,
      email: b.email,
      ownedFiles: b.ownedFiles,
      knowledgeLossPct,
    });
  }

  results.sort((a, b) => b.ownedFiles.length - a.ownedFiles.length);
  return results.slice(0, topN);
}

// ─── Γ GAMMA — acceleration of risk ────────────────────────────────────

export interface GammaResult {
  /** Slope of (commits per week) → (fix-commits per week). */
  riskAcceleration: number;
  /** Sample size — number of weekly buckets used. */
  weeks: number;
  /** Plain-English interpretation. */
  interpretation: string;
}

const FIX_RE = /^(fix|hotfix|bug|revert|patch)[(:]/i;

export function computeGamma(store: MnemeStore): GammaResult {
  const commitRows = store.db
    .prepare(`SELECT subject, author_date FROM commits`)
    .all() as Array<{ subject: string; author_date: string }>;
  if (commitRows.length === 0) {
    return { riskAcceleration: 0, weeks: 0, interpretation: "No commits indexed yet." };
  }

  // Bucket by ISO week.
  const buckets = new Map<string, { total: number; fixes: number }>();
  for (const r of commitRows) {
    const week = isoWeek(new Date(r.author_date));
    if (!buckets.has(week)) buckets.set(week, { total: 0, fixes: 0 });
    const b = buckets.get(week)!;
    b.total += 1;
    if (FIX_RE.test(r.subject)) b.fixes += 1;
  }

  // Linear regression: x = total commits, y = fix commits.
  const points = [...buckets.values()].filter((b) => b.total > 0);
  if (points.length < 3) {
    return {
      riskAcceleration: 0,
      weeks: points.length,
      interpretation: `Only ${points.length} weeks of data — need 3+ for meaningful gamma.`,
    };
  }

  const n = points.length;
  const sumX = points.reduce((s, p) => s + p.total, 0);
  const sumY = points.reduce((s, p) => s + p.fixes, 0);
  const sumXY = points.reduce((s, p) => s + p.total * p.fixes, 0);
  const sumX2 = points.reduce((s, p) => s + p.total * p.total, 0);

  const denom = n * sumX2 - sumX * sumX;
  const slope = denom === 0 ? 0 : (n * sumXY - sumX * sumY) / denom;

  return {
    riskAcceleration: Math.round(slope * 1000) / 1000,
    weeks: n,
    interpretation: buildGammaInterpretation(slope, n),
  };
}

function buildGammaInterpretation(slope: number, weeks: number): string {
  if (slope > 0.3) {
    return `Super-linear risk: each extra commit per week adds ${(slope * 100).toFixed(0)}% more fixes. Scaling team velocity will likely increase bug rate disproportionately.`;
  }
  if (slope > 0.15) {
    return `Risk scales linearly with velocity (slope ${slope.toFixed(2)}). Sustainable but watch for super-linear inflection.`;
  }
  return `Low risk acceleration (slope ${slope.toFixed(2)}). Velocity does not strongly predict bug rate over ${weeks} weeks.`;
}

function isoWeek(d: Date): string {
  // ISO week format: YYYY-Www
  const target = new Date(d.valueOf());
  const dayNr = (d.getUTCDay() + 6) % 7;
  target.setUTCDate(target.getUTCDate() - dayNr + 3);
  const firstThursday = target.valueOf();
  target.setUTCMonth(0, 1);
  if (target.getUTCDay() !== 4) {
    target.setUTCMonth(0, 1 + ((4 - target.getUTCDay() + 7) % 7));
  }
  const weekNumber = 1 + Math.ceil((firstThursday - target.valueOf()) / (7 * 86_400_000));
  return `${d.getUTCFullYear()}-W${String(weekNumber).padStart(2, "0")}`;
}

// ─── Θ THETA — time decay (placeholder) ────────────────────────────────

export interface ThetaResult {
  /** Files untouched for > 6 months. */
  staleFiles: number;
  /** Average days since last touch across stale set. */
  avgStaleDays: number;
  /** Plain-English interpretation. */
  interpretation: string;
}

export function computeTheta(store: MnemeStore, opts: { now?: Date } = {}): ThetaResult {
  const now = opts.now ?? new Date();
  const rows = store.db
    .prepare(
      `SELECT fc.path, MAX(c.author_date) AS last_touch
       FROM file_changes fc
       JOIN commits c ON c.hash = fc.commit_hash
       GROUP BY fc.path`,
    )
    .all() as Array<{ path: string; last_touch: string }>;

  const STALE_DAYS = 180;
  const staleAges: number[] = [];
  for (const r of rows) {
    const days = (now.getTime() - new Date(r.last_touch).getTime()) / 86_400_000;
    if (days >= STALE_DAYS) staleAges.push(days);
  }

  const avg =
    staleAges.length === 0 ? 0 : Math.round(staleAges.reduce((s, x) => s + x, 0) / staleAges.length);

  return {
    staleFiles: staleAges.length,
    avgStaleDays: avg,
    interpretation:
      staleAges.length === 0
        ? "No stale files — codebase is recently active."
        : `${staleAges.length} files untouched for ≥ 6 months (avg ${avg} days). Schedule review or remove via mneme tax-loss-harvest.`,
  };
}

// ─── Composite report ──────────────────────────────────────────────────

export interface GreekReport {
  delta: DeltaResult[];
  gamma: GammaResult;
  theta: ThetaResult;
}

export function computeGreeks(store: MnemeStore, opts: { now?: Date } = {}): GreekReport {
  return {
    delta: computeDelta(store),
    gamma: computeGamma(store),
    theta: computeTheta(store, opts),
  };
}
