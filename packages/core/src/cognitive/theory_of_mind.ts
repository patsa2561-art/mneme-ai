/**
 * v1.64.0 -- COGNITIVE LAYER 1: THEORY OF MIND.
 *
 * Build a 9-axis behavioral profile for each AI vendor so Mneme can
 * predict how a given vendor will handle a given prompt BEFORE it
 * actually runs.
 *
 * The 9 axes:
 *   1. verbosity         -- tokens-per-response mean
 *   2. overconfidence    -- gap between stated confidence and ACGV verdict
 *   3. domainBias        -- which domains it shines / fails on
 *   4. refusalRate       -- how often it declines
 *   5. hallucinationClass -- which kind of fab it produces most
 *   6. riskAppetite      -- how aggressive its refactor / change suggestions
 *   7. verbosityDrift    -- does it talk more over a long conversation?
 *   8. tempStability     -- consistency of outputs for similar inputs
 *   9. chainDepth        -- typical reasoning steps before final answer
 *
 * Data source: ai-souls + squadron/quorum.jsonl + nemesis runs +
 * reactor ledger. Pure read; no side effects unless persistProfile().
 */

import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const COGNITIVE_DIR = ".mneme/cognitive";

export interface VendorProfile {
  vendor: string;
  /** Number of observations the profile is built from. */
  observationCount: number;
  /** 9 axes -- normalized 0..1 unless noted. */
  axes: {
    verbosity: number;          // 0 = terse, 1 = verbose
    overconfidence: number;     // 0 = calibrated, 1 = wildly overconfident
    domainBias: Record<string, number>; // per-domain score 0..1
    refusalRate: number;        // 0..1
    hallucinationClass: string; // dominant class label
    riskAppetite: number;       // 0 = conservative, 1 = aggressive
    verbosityDrift: number;     // 0 = stable, 1 = grows fast
    tempStability: number;      // 0 = chaotic, 1 = deterministic
    chainDepth: number;         // average reasoning steps
  };
  /** Time of last build. */
  builtAt: string;
}

function ensureDir(repoRoot: string): string {
  const d = join(repoRoot, COGNITIVE_DIR);
  if (!existsSync(d)) mkdirSync(d, { recursive: true });
  return d;
}

interface SoulSession { id?: string; broken?: number; reason?: string; verbosity?: number; ts?: string }
interface SoulFile { sessions?: SoulSession[]; vendor?: string }
interface QuorumRow { ts?: string; claim?: string; consensus?: string; confidence?: number; caveats?: string[] }

function readSoul(repoRoot: string, vendor: string): SoulFile | null {
  const p = join(repoRoot, ".mneme/ai-souls", `${vendor}.json`);
  if (!existsSync(p)) return null;
  try { return JSON.parse(readFileSync(p, "utf8")) as SoulFile; } catch { return null; }
}

function readQuorum(repoRoot: string): QuorumRow[] {
  const p = join(repoRoot, ".mneme/squadron/quorum.jsonl");
  if (!existsSync(p)) return [];
  try {
    return readFileSync(p, "utf8").split("\n").filter(Boolean).map((l) => {
      try { return JSON.parse(l) as QuorumRow; } catch { return null; }
    }).filter((x): x is QuorumRow => x !== null);
  } catch { return []; }
}

function dominantHallucinationClass(soul: SoulFile | null): string {
  if (!soul?.sessions) return "unknown";
  const counts = new Map<string, number>();
  for (const s of soul.sessions) {
    if ((s.broken ?? 0) === 0) continue;
    const reason = (s.reason ?? "unknown").toLowerCase();
    let cls = "unknown";
    if (/commit|sha/.test(reason)) cls = "commit-hash";
    else if (/file|path/.test(reason)) cls = "file-path";
    else if (/version|v\d/.test(reason)) cls = "version-number";
    else if (/function|class|method/.test(reason)) cls = "identifier";
    counts.set(cls, (counts.get(cls) ?? 0) + 1);
  }
  if (counts.size === 0) return "no-known-hallucinations";
  return [...counts.entries()].sort((a, b) => b[1] - a[1])[0]![0];
}

export function buildProfile(repoRoot: string, vendor: string): VendorProfile {
  const soul = readSoul(repoRoot, vendor);
  const quorum = readQuorum(repoRoot);
  const sessions = soul?.sessions ?? [];
  const observationCount = sessions.length;

  // Axis 1: verbosity -- mean of session.verbosity field; default 0.5 when absent.
  const verbosityValues = sessions.map((s) => s.verbosity).filter((v): v is number => typeof v === "number");
  const verbosity = verbosityValues.length > 0
    ? Math.min(1, verbosityValues.reduce((a, b) => a + b, 0) / verbosityValues.length / 1000)
    : 0.5;

  // Axis 2: overconfidence -- fraction of broken-promise sessions weighted by their stated confidence.
  const broken = sessions.filter((s) => (s.broken ?? 0) > 0);
  const overconfidence = sessions.length === 0 ? 0 : Math.min(1, broken.length / sessions.length);

  // Axis 3: domainBias -- per-domain success rate from quorum log.
  const domainCounts: Record<string, { total: number; refuted: number }> = {};
  for (const q of quorum) {
    const claim = (q.claim ?? "").toLowerCase();
    let domain = "general";
    if (/auth|jwt|password|login/.test(claim)) domain = "auth";
    else if (/test|vitest|jest/.test(claim)) domain = "test";
    else if (/git|commit|branch|merge/.test(claim)) domain = "git";
    else if (/regex|pattern/.test(claim)) domain = "regex";
    else if (/database|sql|migration/.test(claim)) domain = "database";
    if (!domainCounts[domain]) domainCounts[domain] = { total: 0, refuted: 0 };
    domainCounts[domain]!.total += 1;
    if ((q.caveats ?? []).includes("FALSE_FACT_CLAIM")) domainCounts[domain]!.refuted += 1;
  }
  const domainBias: Record<string, number> = {};
  for (const [d, c] of Object.entries(domainCounts)) {
    domainBias[d] = c.total === 0 ? 0.5 : 1 - c.refuted / c.total;
  }

  // Axis 4: refusalRate -- placeholder when we have no refusal signal.
  const refusalRate = 0;

  // Axis 5: hallucinationClass -- dominant class observed.
  const hallucinationClass = dominantHallucinationClass(soul);

  // Axis 6: riskAppetite -- 1 - (sessions that broke promises like "no-silent-destroy").
  const riskAppetite = sessions.length === 0 ? 0.5 : Math.min(1, broken.length / sessions.length);

  // Axis 7: verbosityDrift -- difference between last-third and first-third mean verbosity.
  let verbosityDrift = 0;
  if (verbosityValues.length >= 6) {
    const third = Math.floor(verbosityValues.length / 3);
    const firstAvg = verbosityValues.slice(0, third).reduce((a, b) => a + b, 0) / third;
    const lastAvg = verbosityValues.slice(-third).reduce((a, b) => a + b, 0) / third;
    verbosityDrift = Math.min(1, Math.max(0, (lastAvg - firstAvg) / (firstAvg || 1)));
  }

  // Axis 8: tempStability -- consistency of consensus verdicts across identical-domain claims.
  const tempStability = 1 - Math.min(1, observationCount === 0 ? 0 : broken.length / Math.max(1, observationCount));

  // Axis 9: chainDepth -- approx steps from soul.verbosity or default.
  const chainDepth = verbosityValues.length === 0 ? 5 : Math.max(1, Math.round(verbosityValues.reduce((a, b) => a + b, 0) / verbosityValues.length / 100));

  return {
    vendor,
    observationCount,
    axes: {
      verbosity,
      overconfidence,
      domainBias,
      refusalRate,
      hallucinationClass,
      riskAppetite,
      verbosityDrift,
      tempStability,
      chainDepth,
    },
    builtAt: new Date().toISOString(),
  };
}

/** Persist a profile snapshot to disk. */
export function persistProfile(repoRoot: string, profile: VendorProfile): string {
  const dir = ensureDir(repoRoot);
  const subdir = join(dir, "vendor-profiles");
  if (!existsSync(subdir)) mkdirSync(subdir, { recursive: true });
  const path = join(subdir, `${profile.vendor}.json`);
  writeFileSync(path, JSON.stringify(profile, null, 2), "utf8");
  return path;
}

/** Compare two vendor profiles -- returns where vendorA outperforms B. */
export function compareVendors(a: VendorProfile, b: VendorProfile): {
  aWins: string[];
  bWins: string[];
  tied: string[];
} {
  const result = { aWins: [] as string[], bWins: [] as string[], tied: [] as string[] };
  const numericAxes: Array<keyof VendorProfile["axes"]> = ["verbosity", "overconfidence", "refusalRate", "riskAppetite", "verbosityDrift", "tempStability", "chainDepth"];
  for (const axis of numericAxes) {
    const av = a.axes[axis] as number;
    const bv = b.axes[axis] as number;
    if (Math.abs(av - bv) < 0.05) result.tied.push(axis);
    else if (axis === "overconfidence" || axis === "verbosityDrift") {
      // lower is better
      if (av < bv) result.aWins.push(axis);
      else result.bWins.push(axis);
    } else {
      // higher is better (verbosity is neutral; we still pick "more" = a wins for terse-prefer downstream)
      if (av > bv) result.aWins.push(axis);
      else result.bWins.push(axis);
    }
  }
  return result;
}

/** Recommend the best vendor for a task given a list of profiles. */
export function recommendVendor(profiles: VendorProfile[], task: { domain?: string; needsTerse?: boolean; needsStable?: boolean }): VendorProfile | null {
  if (profiles.length === 0) return null;
  const scored = profiles.map((p) => {
    let score = 0;
    if (task.domain && p.axes.domainBias[task.domain] !== undefined) {
      score += p.axes.domainBias[task.domain]! * 3;
    }
    if (task.needsTerse) score += (1 - p.axes.verbosity) * 2;
    if (task.needsStable) score += p.axes.tempStability * 2;
    score -= p.axes.overconfidence * 2;
    score += (1 - p.axes.verbosityDrift) * 1;
    return { profile: p, score };
  });
  scored.sort((a, b) => b.score - a.score);
  return scored[0]!.profile;
}
