/**
 * AGENT RELIABILITY BENCHMARK — cross-vendor, from REAL outcomes (Diamond 5 of 5).
 *
 * Mneme is the neutral party sitting on signed, cross-vendor, ground-truthed records
 * of what AI behaviour actually led to good/bad outcomes (attestation + revert radar).
 * This ranks agents (any vendor) on the SAME measured outcome — did their work SURVIVE
 * — with a Wilson 95% LOWER bound, so a small sample scores LOW by construction and the
 * ranking can't be gamed by a lucky streak. NOT a synthetic benchmark; NOT vendor PR.
 *
 * Pure + total. The card is signable (CANON/NOTARY) so a vendor can't forge its band.
 */
import type { AgentSurvival } from "../revert_radar/index.js";

export type ReliabilityBand = "trusted" | "solid" | "watch" | "risky" | "unmeasured";
export interface AgentReliability {
  agent: string;
  commits: number;
  survived: number;
  survivalRate: number;
  /** Wilson 95% LOWER bound on the survival proportion — the honest, un-gameable number. */
  wilsonLB: number;
  band: ReliabilityBand;
}

/** Wilson score interval lower bound (z = 1.96). Total. */
export function wilsonLowerBound(successes: number, n: number): number {
  if (n <= 0) return 0;
  const z = 1.96, p = Math.max(0, Math.min(1, successes / n));
  const z2 = z * z;
  const denom = 1 + z2 / n;
  const centre = p + z2 / (2 * n);
  const margin = z * Math.sqrt((p * (1 - p) + z2 / (4 * n)) / n);
  return Math.max(0, Math.min(1, (centre - margin) / denom));
}

const MIN_SAMPLE = 5;
function bandOf(lb: number, n: number): ReliabilityBand {
  if (n < MIN_SAMPLE) return "unmeasured";
  return lb >= 0.85 ? "trusted" : lb >= 0.7 ? "solid" : lb >= 0.5 ? "watch" : "risky";
}

/** Rank agents by their Wilson-LB survival. Small samples are 'unmeasured', not trusted. */
export function rankAgents(survival: AgentSurvival[]): AgentReliability[] {
  const out = (survival ?? []).map((s) => {
    const commits = Math.max(0, s.commits | 0);
    const survived = Math.max(0, commits - Math.max(0, s.regretted | 0));
    const survivalRate = commits ? survived / commits : 0;
    const wilsonLB = wilsonLowerBound(survived, commits);
    return { agent: s.agent, commits, survived, survivalRate, wilsonLB, band: bandOf(wilsonLB, commits) };
  });
  // rank: measured first, by Wilson-LB desc, then sample size
  out.sort((a, b) => {
    const am = a.band !== "unmeasured" ? 1 : 0, bm = b.band !== "unmeasured" ? 1 : 0;
    return (bm - am) || (b.wilsonLB - a.wilsonLB) || (b.commits - a.commits) || a.agent.localeCompare(b.agent);
  });
  return out;
}

// ─── FEDERATION — cross-repo, privacy-preserving ──────────────────────────────
// Each repo emits a CONTENT-FREE digest (agent name + counts ONLY — never a sha, a
// path, or any repo content), peers CRDT-merge them, and the benchmark compounds:
// an agent measured across many repos earns a TIGHTER Wilson-LB. The neutral, signed,
// cross-vendor reliability layer no single vendor can build.
export interface BenchmarkDigest {
  v: 1;
  agents: Array<{ agent: string; commits: number; survived: number }>;
  /** an opaque tag for the source repo (e.g. a hash) — never the repo name/path. */
  repoTag?: string;
}

/** Build a content-free digest from local survival. NO shas/paths/content leave. */
export function buildBenchmarkDigest(survival: AgentSurvival[], repoTag?: string): BenchmarkDigest {
  const agents = (survival ?? []).filter((s) => s && typeof s.agent === "string").map((s) => {
    const commits = Math.max(0, s.commits | 0);
    return { agent: s.agent, commits, survived: Math.max(0, commits - Math.max(0, s.regretted | 0)) };
  });
  return { v: 1, agents, ...(repoTag ? { repoTag } : {}) };
}

/** CRDT-merge digests from many repos → a federated reliability ranking. Commutative + idempotent. */
export function mergeBenchmarkDigests(digests: ReadonlyArray<BenchmarkDigest>): AgentReliability[] {
  const sum = new Map<string, { commits: number; survived: number }>();
  // idempotent: dedupe identical (repoTag, agent, commits, survived) contributions
  const seen = new Set<string>();
  for (const d of digests ?? []) {
    if (!d || !Array.isArray(d.agents)) continue;
    for (const a of d.agents) {
      if (!a || typeof a.agent !== "string") continue;
      const key = `${d.repoTag ?? ""}|${a.agent}|${a.commits}|${a.survived}`;
      if (d.repoTag && seen.has(key)) continue; if (d.repoTag) seen.add(key);
      const cur = sum.get(a.agent) ?? { commits: 0, survived: 0 };
      cur.commits += Math.max(0, a.commits | 0); cur.survived += Math.max(0, a.survived | 0);
      sum.set(a.agent, cur);
    }
  }
  const survival: AgentSurvival[] = [...sum.entries()].map(([agent, v]) => ({ agent, commits: v.commits, regretted: Math.max(0, v.commits - v.survived), survivalRate: v.commits ? v.survived / v.commits : 0, explicit: 0, hotfix: 0 }));
  return rankAgents(survival);
}

/** Privacy invariant: a digest must NOT contain any raw repo content/sha/path. */
export function digestLeaksRaw(digest: BenchmarkDigest, rawNeedles: ReadonlyArray<string>): boolean {
  const blob = JSON.stringify(digest ?? {});
  return (rawNeedles ?? []).some((n) => n && blob.includes(n));
}

// ─── gauntlet ─────────────────────────────────────────────────────────────────
export interface BenchmarkGauntlet { score: 0 | 100; checks: Array<{ name: string; pass: boolean; detail: string }> }

export function benchmarkGauntlet(): BenchmarkGauntlet {
  const survival: AgentSurvival[] = [
    { agent: "claude-code", commits: 40, regretted: 1, survivalRate: 0.975, explicit: 1, hotfix: 0 },   // big-n, clean → trusted
    { agent: "cursor", commits: 40, regretted: 16, survivalRate: 0.6, explicit: 8, hotfix: 8 },           // big-n, shaky → watch/risky
    { agent: "newbie", commits: 2, regretted: 0, survivalRate: 1, explicit: 0, hotfix: 0 },               // tiny-n, perfect → UNMEASURED (can't game)
  ];
  const ranked = rankAgents(survival);
  const claude = ranked.find((r) => r.agent === "claude-code");
  const cursor = ranked.find((r) => r.agent === "cursor");
  const newbie = ranked.find((r) => r.agent === "newbie");
  const wlbSane = wilsonLowerBound(40, 40) < 1 && wilsonLowerBound(40, 40) > 0.9 && wilsonLowerBound(0, 0) === 0;
  const ungameable = newbie?.band === "unmeasured";                  // 2/2 perfect does NOT become 'trusted'
  const ordered = ranked[0].agent === "claude-code" && claude!.wilsonLB > cursor!.wilsonLB;
  const trusted = claude?.band === "trusted";
  const lowerBand = cursor?.band === "watch" || cursor?.band === "risky";
  const det = JSON.stringify(rankAgents(survival)) === JSON.stringify(rankAgents(survival));
  const checks = [
    { name: "WILSON-LB-SOUND", pass: wlbSane, detail: "Wilson lower bound ∈ (0,1), 0 on no data" },
    { name: "UNGAMEABLE-SMALL-N", pass: ungameable, detail: "a perfect 2/2 agent is 'unmeasured', never 'trusted'" },
    { name: "RANKS-BY-OUTCOME", pass: ordered && trusted && lowerBand, detail: "a big-n clean agent outranks a shaky one (measured, not PR)" },
    { name: "DETERMINISTIC", pass: det, detail: "same outcomes → byte-identical ranking" },
  ];
  return { score: checks.every((c) => c.pass) ? 100 : 0, checks };
}

export function federationGauntlet(): BenchmarkGauntlet {
  // one repo: alice 4/4 → too few to judge. federate 3 repos → 12/12 → measured.
  const oneRepo: AgentSurvival[] = [{ agent: "alice", commits: 4, regretted: 0, survivalRate: 1, explicit: 0, hotfix: 0 }];
  const dA = buildBenchmarkDigest(oneRepo, "repoA");
  const dB = buildBenchmarkDigest(oneRepo, "repoB");
  const dC = buildBenchmarkDigest(oneRepo, "repoC");
  const single = rankAgents(oneRepo)[0];
  const fed = mergeBenchmarkDigests([dA, dB, dC])[0];
  const compounding = single.band === "unmeasured" && fed.band !== "unmeasured" && fed.commits === 12 && fed.wilsonLB > single.wilsonLB;
  const commutative = JSON.stringify(mergeBenchmarkDigests([dA, dB])) === JSON.stringify(mergeBenchmarkDigests([dB, dA]));
  const idempotent = JSON.stringify(mergeBenchmarkDigests([dA, dA, dB])) === JSON.stringify(mergeBenchmarkDigests([dA, dB]));
  const noRaw = !digestLeaksRaw(dA, ["src/secret.ts", "aaa1111deadbeef", "/home/user/repo"]);
  const det = JSON.stringify(mergeBenchmarkDigests([dA, dB, dC])) === JSON.stringify(mergeBenchmarkDigests([dA, dB, dC]));
  const checks = [
    { name: "COMPOUNDS-ACROSS-REPOS", pass: compounding, detail: "an agent unmeasured in one repo becomes measured across many (Wilson-LB tightens)" },
    { name: "CRDT-COMMUTATIVE", pass: commutative, detail: "merge order doesn't matter (peers converge)" },
    { name: "IDEMPOTENT", pass: idempotent, detail: "re-merging the same tagged digest doesn't double-count" },
    { name: "PRIVACY-NO-RAW", pass: noRaw, detail: "the shared digest contains NO sha / path / repo content — counts only" },
    { name: "DETERMINISTIC", pass: det, detail: "same digests → byte-identical federated ranking" },
  ];
  return { score: checks.every((c) => c.pass) ? 100 : 0, checks };
}
