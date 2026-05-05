/**
 * `mneme drift` — visualize topical drift in a repo's commits over time.
 *
 * Buckets commits into time windows (default: quarter), classifies each
 * commit by intent (feature / refactor / firefight / polish / docs), then
 * emits per-bucket distributions you can plot or render as a sparkline.
 *
 * Why novel: shipped products do not exist for this. Academic papers
 * (arxiv 2110.00697, etc.) cluster commits semantically but stop at the
 * paper. Mneme's drift command brings it to the CLI.
 */
import type { Commit } from "../types.js";

export type DriftKind = "feature" | "refactor" | "firefight" | "polish" | "docs" | "other";

export interface DriftBucket {
  /** Window label e.g. "2024-Q1" or "2024-08". */
  label: string;
  fromDate: string;
  toDate: string;
  /** Total commits in window. */
  total: number;
  /** Counts by drift kind. */
  byKind: Record<DriftKind, number>;
  /** Dominant kind for this window (highest count). */
  dominant: DriftKind;
}

export interface DriftReport {
  /** Granularity used. */
  granularity: "quarter" | "month";
  buckets: DriftBucket[];
  /** Insights derived from the trajectory. */
  insights: DriftInsight[];
}

export interface DriftInsight {
  kind: "burnout" | "recovery" | "rewrite-cluster" | "polish-streak" | "shift";
  fromBucket: string;
  toBucket: string;
  description: string;
}

const FEATURE_RE = /\b(feat|feature|add|implement|introduce|support|expose)\b/i;
const REFACTOR_RE = /\b(refactor|rewrite|migrate|switch(?:ed)? to|extract|consolidate|simplify)\b/i;
const FIRE_RE = /\b(fix|hotfix|revert|rollback|broken|crash|regression|emergency|urgent|critical)\b/i;
const POLISH_RE = /\b(typo|format|lint|rename|comment|whitespace|cleanup|chore|polish|tighten)\b/i;
const DOCS_RE = /\b(docs?|readme|comment|documentation)\b/i;

const KINDS: DriftKind[] = ["feature", "refactor", "firefight", "polish", "docs", "other"];

export function classifyCommit(c: Commit): DriftKind {
  const text = `${c.subject}\n${c.body || ""}`;
  if (FIRE_RE.test(text)) return "firefight";
  if (REFACTOR_RE.test(text)) return "refactor";
  if (FEATURE_RE.test(text)) return "feature";
  if (DOCS_RE.test(text)) return "docs";
  if (POLISH_RE.test(text)) return "polish";
  return "other";
}

export function buildDrift(
  commits: Commit[],
  opts: { granularity?: "quarter" | "month" } = {},
): DriftReport {
  const granularity = opts.granularity ?? "quarter";
  const sorted = [...commits].sort((a, b) =>
    a.authorDate.localeCompare(b.authorDate),
  );
  if (sorted.length === 0) {
    return { granularity, buckets: [], insights: [] };
  }

  const buckets = new Map<string, DriftBucket>();
  for (const c of sorted) {
    const label = labelOf(c.authorDate, granularity);
    const range = rangeOf(label, granularity);
    let b = buckets.get(label);
    if (!b) {
      b = {
        label,
        fromDate: range.from,
        toDate: range.to,
        total: 0,
        byKind: { feature: 0, refactor: 0, firefight: 0, polish: 0, docs: 0, other: 0 },
        dominant: "other",
      };
      buckets.set(label, b);
    }
    const k = classifyCommit(c);
    b.byKind[k] += 1;
    b.total += 1;
  }
  // resolve dominant
  for (const b of buckets.values()) {
    let best: DriftKind = "other";
    let bestN = -1;
    for (const k of KINDS) {
      const n = b.byKind[k];
      if (n > bestN) {
        bestN = n;
        best = k;
      }
    }
    b.dominant = best;
  }

  const ordered = [...buckets.values()].sort((a, b) =>
    a.fromDate.localeCompare(b.fromDate),
  );

  return {
    granularity,
    buckets: ordered,
    insights: detectInsights(ordered),
  };
}

function detectInsights(buckets: DriftBucket[]): DriftInsight[] {
  const out: DriftInsight[] = [];
  if (buckets.length < 2) return out;

  // Burnout: firefight ratio rises ≥ 30 percentage points across 2+ adjacent buckets.
  for (let i = 1; i < buckets.length; i++) {
    const prev = buckets[i - 1]!;
    const cur = buckets[i]!;
    const prevFire = ratio(prev.byKind.firefight, prev.total);
    const curFire = ratio(cur.byKind.firefight, cur.total);
    if (curFire - prevFire >= 0.3 && cur.total >= 5) {
      out.push({
        kind: "burnout",
        fromBucket: prev.label,
        toBucket: cur.label,
        description: `firefight ratio jumped from ${pct(prevFire)} to ${pct(curFire)} — possible incident streak or burnout signal.`,
      });
    }
    if (prevFire >= 0.4 && curFire < prevFire - 0.2) {
      out.push({
        kind: "recovery",
        fromBucket: prev.label,
        toBucket: cur.label,
        description: `firefight ratio fell from ${pct(prevFire)} to ${pct(curFire)} — repo stabilizing.`,
      });
    }
  }

  // Rewrite cluster: 2+ adjacent buckets where dominant = refactor
  for (let i = 0; i < buckets.length - 1; i++) {
    if (buckets[i]!.dominant === "refactor" && buckets[i + 1]!.dominant === "refactor") {
      out.push({
        kind: "rewrite-cluster",
        fromBucket: buckets[i]!.label,
        toBucket: buckets[i + 1]!.label,
        description: `consecutive periods dominated by refactors — major restructuring effort.`,
      });
      break;
    }
  }

  // Polish streak: 3+ adjacent buckets dominated by polish or docs
  let polishRun = 0;
  let polishStart = "";
  for (const b of buckets) {
    if (b.dominant === "polish" || b.dominant === "docs") {
      if (polishRun === 0) polishStart = b.label;
      polishRun++;
      if (polishRun >= 3) {
        out.push({
          kind: "polish-streak",
          fromBucket: polishStart,
          toBucket: b.label,
          description: `${polishRun} consecutive periods of polish/docs — mature, stable phase.`,
        });
        break;
      }
    } else {
      polishRun = 0;
    }
  }

  return out;
}

function ratio(num: number, denom: number): number {
  return denom === 0 ? 0 : num / denom;
}

function pct(r: number): string {
  return `${Math.round(r * 100)}%`;
}

function labelOf(iso: string, gran: "quarter" | "month"): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "unknown";
  const y = d.getUTCFullYear();
  const m = d.getUTCMonth(); // 0..11
  if (gran === "month") {
    return `${y}-${String(m + 1).padStart(2, "0")}`;
  }
  const q = Math.floor(m / 3) + 1;
  return `${y}-Q${q}`;
}

function rangeOf(label: string, gran: "quarter" | "month"): { from: string; to: string } {
  if (gran === "month") {
    const [y, m] = label.split("-");
    const ynum = Number(y);
    const mnum = Number(m);
    const last = new Date(Date.UTC(ynum, mnum, 0));
    return {
      from: `${y}-${m}-01`,
      to: `${y}-${m}-${String(last.getUTCDate()).padStart(2, "0")}`,
    };
  }
  // quarter
  const [y, qstr] = label.split("-Q");
  const q = Number(qstr);
  const startMonth = (q - 1) * 3 + 1;
  const endMonth = startMonth + 2;
  const last = new Date(Date.UTC(Number(y), endMonth, 0));
  return {
    from: `${y}-${String(startMonth).padStart(2, "0")}-01`,
    to: `${y}-${String(endMonth).padStart(2, "0")}-${String(last.getUTCDate()).padStart(2, "0")}`,
  };
}
