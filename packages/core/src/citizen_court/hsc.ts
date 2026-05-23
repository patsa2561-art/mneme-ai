/**
 * v2.33.0 — Honesty Score Card (HSC) computation.
 *
 * Per-vendor truthful-vote rate with Wilson-95% lower bound on a
 * Bernoulli proportion. Small sample sizes get an UNDER-MEASURED
 * cohort note + the ⚪ band. Score → IDE color dot.
 */

import type { CourtVerdict, HonestyScoreCard } from "./types.js";
import { listVerdicts } from "./court.js";

/** 95% Wilson lower bound on a Bernoulli proportion p̂ = k/n. */
function wilsonLB(successes: number, trials: number, z = 1.96): number {
  if (trials === 0) return 0;
  const p = successes / trials;
  const denom = 1 + (z * z) / trials;
  const center = p + (z * z) / (2 * trials);
  const margin = z * Math.sqrt((p * (1 - p) + (z * z) / (4 * trials)) / trials);
  return Math.max(0, (center - margin) / denom);
}

function band(lb: number, sampleSize: number): HonestyScoreCard["band"] {
  if (sampleSize < 5) return "⚪ unmeasured";
  if (lb >= 0.65) return "🟢 trustworthy";
  if (lb >= 0.40) return "🟡 mixed";
  return "🔴 suspect";
}

export function computeHsc(verdicts: CourtVerdict[]): HonestyScoreCard[] {
  // Aggregate per vendor: was this vendor party to the court? did they win?
  type Acc = { truthful: number; lost: number; abstain: number };
  const by = new Map<string, Acc>();
  function bump(v: string, key: keyof Acc): void {
    const cur = by.get(v) ?? { truthful: 0, lost: 0, abstain: 0 };
    cur[key]++;
    by.set(v, cur);
  }
  for (const v of verdicts) {
    const parties = new Set<string>([v.primaryVendor, ...v.reveals.map((r) => r.vendor)]);
    if (v.votedMostTruthful === "ABSTAIN") {
      for (const p of parties) bump(p, "abstain");
      continue;
    }
    for (const p of parties) {
      if (p === v.votedMostTruthful) bump(p, "truthful");
      else bump(p, "lost");
    }
  }
  const out: HonestyScoreCard[] = [];
  for (const [vendor, a] of by.entries()) {
    const sampleSize = a.truthful + a.lost + a.abstain;
    const decisive = a.truthful + a.lost;
    const lb = wilsonLB(a.truthful, decisive);
    const raw = decisive === 0 ? 0 : a.truthful / decisive;
    out.push({
      vendor,
      truthfulVotes: a.truthful,
      lostVotes: a.lost,
      abstainsInvolving: a.abstain,
      honestyScoreLB: Number(lb.toFixed(3)),
      honestyScoreRaw: Number(raw.toFixed(3)),
      sampleSize: decisive,
      band: band(lb, decisive),
      ...(decisive < 5 ? { cohortNote: `under-measured (n=${decisive} decisive votes; band reports ⚪ until n≥5)` } : {}),
    });
  }
  // Sort by LB descending so highest-trust vendor is first.
  out.sort((a, b) => b.honestyScoreLB - a.honestyScoreLB);
  return out;
}

export function readHsc(repoRoot: string): HonestyScoreCard[] {
  return computeHsc(listVerdicts(repoRoot, 10000));
}
