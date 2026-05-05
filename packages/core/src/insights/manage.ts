/**
 * `mneme manage` — engineering management dashboard.
 *
 * The "King of Git Management" surface: rolls up multiple Mneme insights
 * into a single CTO/EM-friendly view answering:
 *   - Team health: are we firefighting or shipping?
 *   - Bus factor: who is the keystone, what falls if they leave?
 *   - Skill matrix: who knows what, derived from commit history?
 *   - Knowledge succession: for each high-risk module, who's the
 *     understudy?
 *   - Trajectory: where is the team headed?
 *
 * No external services. Combines existing pure data extractors.
 */
import type { Commit } from "../types.js";
import { buildDrift } from "./drift.js";
import { buildOracle } from "./oracle.js";

export interface SkillCell {
  author: string;
  area: string;
  /** Touches in the area, normalized 0..1 against the area's busiest author. */
  proficiency: number;
  /** Days since this author last touched the area. */
  daysSinceLastTouch: number;
}

export interface SuccessionPlan {
  area: string;
  primary: string;
  understudy: string | null;
  /** 0..1 — confidence that the understudy can take over. */
  confidence: number;
  /** Risk score 0..1: 1 = no understudy + primary is bus-factor; 0 = healthy. */
  risk: number;
}

export interface TeamHealthSnapshot {
  windowCommits: number;
  /** Composite 0..1 — higher is healthier. Reflects feature ratio + low collision rate + low bus-factor risk. */
  overall: number;
  /** Most recent drift bucket label and dominant kind. */
  trajectory: { label: string; dominant: string };
  /** Active collisions predicted by Oracle. */
  predictedCollisions: number;
  /** Maximum bus-factor risk across modules. */
  maxSuccessionRisk: number;
  notes: string[];
}

export interface ManageReport {
  windowDays: number;
  health: TeamHealthSnapshot;
  /** Per-area × per-author proficiency cells. */
  skillMatrix: SkillCell[];
  /** Areas + their primary owner, understudy candidate, and risk. */
  succession: SuccessionPlan[];
}

export function buildManage(
  commits: Commit[],
  opts: {
    nowMs?: number;
    windowDays?: number;
  } = {},
): ManageReport {
  const nowMs = opts.nowMs ?? Date.now();
  const windowDays = opts.windowDays ?? 90;

  const cutoff = nowMs - windowDays * 86_400_000;
  const recent = commits.filter(
    (c) => new Date(c.authorDate).getTime() >= cutoff,
  );

  const drift = buildDrift(recent, { granularity: "month" });
  const oracle = buildOracle(commits, { nowMs, windowDays });

  // Per-area touches (top-level dirs)
  const areaAuthorTouches = new Map<string, Map<string, number>>();
  const areaAuthorLast = new Map<string, Map<string, number>>();
  for (const c of recent) {
    const a = c.authorName || c.authorEmail;
    const t = new Date(c.authorDate).getTime();
    for (const f of c.files) {
      const area = f.split("/").slice(0, 2).join("/") || "(root)";
      let m = areaAuthorTouches.get(area);
      if (!m) {
        m = new Map();
        areaAuthorTouches.set(area, m);
      }
      m.set(a, (m.get(a) ?? 0) + 1);
      let lm = areaAuthorLast.get(area);
      if (!lm) {
        lm = new Map();
        areaAuthorLast.set(area, lm);
      }
      const cur = lm.get(a) ?? 0;
      if (t > cur) lm.set(a, t);
    }
  }

  // Build skill matrix
  const skillMatrix: SkillCell[] = [];
  for (const [area, m] of areaAuthorTouches) {
    const max = Math.max(...m.values());
    if (max === 0) continue;
    for (const [author, n] of m) {
      const last = areaAuthorLast.get(area)?.get(author) ?? 0;
      skillMatrix.push({
        author,
        area,
        proficiency: Number((n / max).toFixed(3)),
        daysSinceLastTouch: last === 0 ? -1 : Math.round((nowMs - last) / 86_400_000),
      });
    }
  }
  skillMatrix.sort((a, b) => b.proficiency - a.proficiency);

  // Build succession plans (per area)
  const succession: SuccessionPlan[] = [];
  for (const [area, m] of areaAuthorTouches) {
    const ranked = [...m.entries()].sort((a, b) => b[1] - a[1]);
    if (ranked.length === 0) continue;
    const primary = ranked[0]![0];
    const primaryShare = ranked[0]![1] / ranked.reduce((s, [, n]) => s + n, 0);
    const understudy = ranked[1]?.[0] ?? null;
    const understudyShare = ranked[1] ? ranked[1][1] / ranked.reduce((s, [, n]) => s + n, 0) : 0;
    const confidence = understudy ? Number(Math.min(1, understudyShare * 3).toFixed(3)) : 0;
    // risk: high primary share + no/weak understudy
    const risk = Number(Math.min(1, Math.max(0, primaryShare - 0.5) * 2 * (1 - confidence)).toFixed(3));
    succession.push({ area, primary, understudy, confidence, risk });
  }
  succession.sort((a, b) => b.risk - a.risk);

  // Compute team health
  const lastBucket = drift.buckets[drift.buckets.length - 1];
  const trajectory = lastBucket
    ? { label: lastBucket.label, dominant: lastBucket.dominant }
    : { label: "n/a", dominant: "other" };

  const featureRatio = lastBucket
    ? (lastBucket.byKind.feature ?? 0) / Math.max(1, lastBucket.total)
    : 0;
  const fireRatio = lastBucket
    ? (lastBucket.byKind.firefight ?? 0) / Math.max(1, lastBucket.total)
    : 0;

  const collisionScore = oracle.collisions.length === 0 ? 1 : Math.max(0, 1 - oracle.collisions.length / 10);
  const successionScore = succession.length === 0 ? 1 : 1 - Math.max(...succession.map((s) => s.risk), 0);
  const overall = Number(((0.4 * (featureRatio + (1 - fireRatio)) / 2) + 0.3 * collisionScore + 0.3 * successionScore).toFixed(3));

  const notes: string[] = [];
  if (fireRatio > 0.4) notes.push(`Firefight ratio is ${pct(fireRatio)} — last month was reactive. Consider a feature freeze.`);
  if (oracle.collisions.length > 3) notes.push(`${oracle.collisions.length} predicted collisions in next window — schedule a sync.`);
  const maxRisk = Math.max(0, ...succession.map((s) => s.risk));
  if (maxRisk > 0.6) {
    const top = succession[0];
    notes.push(`Highest succession risk: ${top!.area} (primary @${top!.primary}, ${top!.understudy ? "weak understudy" : "no understudy"}).`);
  }
  if (notes.length === 0) notes.push("No major risks detected. Team trajectory looks healthy.");

  return {
    windowDays,
    health: {
      windowCommits: recent.length,
      overall,
      trajectory,
      predictedCollisions: oracle.collisions.length,
      maxSuccessionRisk: Number(maxRisk.toFixed(3)),
      notes,
    },
    skillMatrix,
    succession,
  };
}

function pct(r: number): string {
  return `${Math.round(r * 100)}%`;
}
