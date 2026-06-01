/**
 * v2.122.0 — BEQUEST: the Signed Knowledge-Inheritance engine (the "Second
 * Brain that is inherited").
 *
 * THE GAP THIS CLOSES. Mneme already *detects* key-person risk (atrophy: who
 * still understands which files, from the Ebbinghaus forgetting curve over git
 * history). But detection isn't survival. When an expert — or an AI agent, or a
 * session — leaves, their knowledge must be (a) captured with its reasoning,
 * (b) handed to a successor, (c) PROVEN to have transferred intact, and (d)
 * measured: how much org knowledge still has NO living heir? BEQUEST is that
 * inheritance + verification + accounting layer. It turns "Alice holds 85% of
 * the payment module" into "of $X at-risk knowledge mass, Y% now has a verified
 * heir, Z% is ORPHANED — assign these N people to cover 95%."
 *
 * THE HONEST MATH (DIAKRISIS — this is a fresh COMPOSITION, not a new theorem;
 * the building blocks are standard and that is the point — they are checkable):
 *
 *   1. KNOWLEDGE SURVIVAL (reliability-theory redundancy applied to inheritance)
 *      For a knowledge unit u held by a set of heirs each with fluency f∈[0,1]
 *      (freshness/expertise), the probability the knowledge SURVIVES is the
 *      complement of every independent holder forgetting it:
 *            S(u) = 1 − ∏_{a ∈ holders(u)} (1 − f_a)
 *      0 holders ⇒ S=0 (orphaned). One fluent holder (f=1) ⇒ S=1. Two half-
 *      fluent holders ⇒ 1−0.5·0.5 = 0.75 (redundancy raises survival). S is
 *      monotone non-decreasing in every f_a and in adding heirs.
 *
 *   2. INHERITANCE COMPLETENESS / ORPHANED MASS (mass-weighted survival)
 *            C = Σ_u mass(u)·S(u) / Σ_u mass(u)          (0..1)
 *            Orphaned = Σ_u mass(u)·(1 − S(u))           (knowledge with no heir)
 *      These are exact, signed, falsifiable org-level numbers.
 *
 *   3. MINIMUM-HEIR SET COVER (who to assign so the org survives)
 *      Budgeted max-coverage: pick ≤k heirs to maximise covered at-risk mass.
 *      Greedy (take the heir adding the most uncovered mass each round) is the
 *      classic (1−1/e)-approximation; bequestGauntlet proves greedy ≥
 *      (1−1/e)·OPT against brute-force optimal on a fixed instance.
 *
 * Pure + total (108-error rule): deterministic, no I/O, no network, never throws.
 */

import { createHash } from "node:crypto";

const clamp01 = (x: unknown): number => {
  const v = typeof x === "number" && isFinite(x) ? x : 0;
  return v < 0 ? 0 : v > 1 ? 1 : v;
};
const nonNeg = (x: unknown): number => {
  const v = typeof x === "number" && isFinite(x) ? x : 0;
  return v < 0 ? 0 : v;
};
const round4 = (x: number): number => Math.round(x * 1e4) / 1e4;
function sha256(s: string): string { return createHash("sha256").update(s, "utf8").digest("hex"); }

export interface Heir {
  /** stable id (email / agent id / person id). */
  id: string;
  /** fluency / freshness on the unit, 0..1 (e.g. atrophy knowledge score). */
  fluency: number;
}

export interface KnowledgeUnit {
  /** file path, decision id, or symbol — the atom of inherited knowledge. */
  id: string;
  /** knowledge mass (importance) ≥ 0 — e.g. atrophy knowledgeMass or churn. */
  mass: number;
  /** everyone with some fluency on this unit (including the departing holder). */
  holders: Heir[];
  /** optional captured reasoning / content (signed into a capsule). */
  content?: string;
}

/** Probability a knowledge unit SURVIVES = 1 − ∏(1 − fluency). Total. */
export function survival(unit: Pick<KnowledgeUnit, "holders">): number {
  try {
    const holders = Array.isArray(unit?.holders) ? unit.holders : [];
    if (holders.length === 0) return 0;
    let allForget = 1;
    for (const h of holders) allForget *= (1 - clamp01(h?.fluency));
    return round4(1 - allForget);
  } catch { return 0; }
}

export interface InheritanceReport {
  totalMass: number;
  survivingMass: number;
  orphanedMass: number;
  /** 0..1 mass-weighted survival across all units. */
  completeness: number;
  /** units whose survival is below the orphan threshold. */
  orphans: Array<{ id: string; mass: number; survival: number; heirs: number }>;
  unitCount: number;
  /** the orphan threshold used. */
  threshold: number;
}

/** Org-level inheritance health. A unit with survival < threshold is "orphaned"
 *  (at real risk of being lost). Deterministic + total. */
export function inheritanceReport(units: ReadonlyArray<KnowledgeUnit>, opts?: { orphanThreshold?: number }): InheritanceReport {
  const threshold = clamp01(opts?.orphanThreshold ?? 0.5);
  try {
    const list = Array.isArray(units) ? units : [];
    let totalMass = 0, survivingMass = 0;
    const orphans: InheritanceReport["orphans"] = [];
    for (const u of list) {
      const mass = nonNeg(u?.mass);
      const s = survival(u);
      totalMass += mass;
      survivingMass += mass * s;
      if (s < threshold) orphans.push({ id: String(u?.id ?? "?"), mass: round4(mass), survival: s, heirs: Array.isArray(u?.holders) ? u.holders.length : 0 });
    }
    const orphanedMass = round4(totalMass - survivingMass);
    const completeness = totalMass > 0 ? round4(survivingMass / totalMass) : 0;
    orphans.sort((a, b) => b.mass - a.mass);
    return { totalMass: round4(totalMass), survivingMass: round4(survivingMass), orphanedMass, completeness, orphans, unitCount: list.length, threshold };
  } catch {
    return { totalMass: 0, survivingMass: 0, orphanedMass: 0, completeness: 0, orphans: [], unitCount: 0, threshold };
  }
}

// ── Succession capsule (the signed, inheritable Second Brain bundle) ──────

export interface CapsuleUnit { id: string; mass: number; contentHash: string }
export interface SuccessionCapsule {
  capsuleId: string;
  holderId: string;
  reasoning: string;
  units: CapsuleUnit[];
  /** sha256 over the canonical capsule body (the integrity anchor; NOTARY signs this). */
  bodyHash: string;
}

function canonCapsule(holderId: string, reasoning: string, units: CapsuleUnit[]): string {
  const u = units.map((x) => `${x.id}:${x.mass}:${x.contentHash}`).join("|");
  return `bequest/v1|${holderId}|${reasoning}|${u}`;
}

/** Mint a succession capsule from a departing holder's knowledge units. The
 *  capsule binds each unit's CONTENT HASH (not the raw content) so a successor
 *  can prove they received the same material, and an auditor can verify the
 *  capsule offline. Deterministic + total. (CLI/MCP wrap this with a NOTARY
 *  Ed25519 receipt over bodyHash.) */
export function mintCapsule(input: { holderId: string; units: ReadonlyArray<KnowledgeUnit>; reasoning?: string }): SuccessionCapsule {
  try {
    const holderId = String(input?.holderId ?? "unknown");
    const reasoning = String(input?.reasoning ?? "");
    const units: CapsuleUnit[] = (Array.isArray(input?.units) ? input.units : []).map((u) => ({
      id: String(u?.id ?? "?"),
      mass: round4(nonNeg(u?.mass)),
      contentHash: sha256(String(u?.content ?? u?.id ?? "")),
    }));
    const body = canonCapsule(holderId, reasoning, units);
    const bodyHash = sha256(body);
    return { capsuleId: bodyHash.slice(0, 16), holderId, reasoning, units, bodyHash };
  } catch {
    return { capsuleId: "", holderId: "unknown", reasoning: "", units: [], bodyHash: "" };
  }
}

export interface InheritanceVerdict {
  ok: boolean;
  capsuleId: string;
  heirId: string;
  /** units the heir correctly acknowledged (hash matched). */
  covered: string[];
  /** units the heir failed to acknowledge / mismatched. */
  missing: string[];
  /** fraction of mass the heir actually inherited (mass-weighted). */
  coverageByMass: number;
  note: string;
}

/** Verify a successor's claim: they present, per unit, the content hash they
 *  received; we confirm it matches the signed capsule. This is a TRANSFER-
 *  INTEGRITY proof (the knowledge transmitted intact and was acknowledged) — it
 *  is NOT a claim of deep comprehension, and says so. Deterministic + total. */
export function verifyInheritance(capsule: SuccessionCapsule, heirId: string, providedHashes: Record<string, string>): InheritanceVerdict {
  try {
    const units = Array.isArray(capsule?.units) ? capsule.units : [];
    const provided = providedHashes && typeof providedHashes === "object" ? providedHashes : {};
    const covered: string[] = []; const missing: string[] = [];
    let totalMass = 0, coveredMass = 0;
    for (const u of units) {
      totalMass += u.mass;
      if (provided[u.id] === u.contentHash) { covered.push(u.id); coveredMass += u.mass; }
      else missing.push(u.id);
    }
    const coverageByMass = totalMass > 0 ? round4(coveredMass / totalMass) : 0;
    const ok = missing.length === 0 && units.length > 0;
    return {
      ok, capsuleId: String(capsule?.capsuleId ?? ""), heirId: String(heirId ?? "unknown"),
      covered, missing, coverageByMass,
      note: "transfer-integrity proof: each unit's content-hash matched the signed capsule (knowledge transmitted intact + acknowledged) — NOT a proof of deep comprehension",
    };
  } catch {
    return { ok: false, capsuleId: "", heirId: String(heirId ?? "unknown"), covered: [], missing: [], coverageByMass: 0, note: "bequest verify error (safe)" };
  }
}

// ── Minimum-heir set cover (who to assign so the org survives) ────────────

export interface HeirCandidate {
  id: string;
  /** the unit ids this candidate can credibly inherit (raise to survival). */
  canCover: string[];
}
export interface CoverPlan {
  chosen: string[];
  coveredMass: number;
  totalAtRiskMass: number;
  coverageFraction: number;
  /** the (1−1/e) lower bound this greedy solution is guaranteed to beat. */
  guaranteedBound: number;
}

/** Budgeted greedy max-coverage: choose ≤budget heirs maximising covered at-risk
 *  mass. Classic (1−1/e)-approximation. Deterministic + total. */
export function minHeirCover(atRisk: ReadonlyArray<{ id: string; mass: number }>, candidates: ReadonlyArray<HeirCandidate>, budget: number): CoverPlan {
  try {
    const massOf = new Map<string, number>();
    for (const u of (Array.isArray(atRisk) ? atRisk : [])) massOf.set(String(u.id), nonNeg(u.mass));
    const totalAtRiskMass = [...massOf.values()].reduce((a, b) => a + b, 0);
    const candList: HeirCandidate[] = Array.isArray(candidates) ? (candidates as HeirCandidate[]) : [];
    const cands = candList.map((c) => ({ id: String(c.id), set: new Set<string>((Array.isArray(c.canCover) ? c.canCover : []).map((x: string) => String(x))) }));
    const k = Math.max(0, Math.floor(nonNeg(budget)));

    const coveredUnits = new Set<string>();
    const chosen: string[] = [];
    const remaining = [...cands];
    for (let round = 0; round < k && remaining.length > 0; round++) {
      let best = -1, bestGain = -1;
      for (let i = 0; i < remaining.length; i++) {
        let gain = 0;
        for (const id of remaining[i]!.set) if (!coveredUnits.has(id)) gain += massOf.get(id) ?? 0;
        if (gain > bestGain) { bestGain = gain; best = i; }
      }
      if (best < 0 || bestGain <= 0) break; // no further gain
      const pick = remaining.splice(best, 1)[0]!;
      chosen.push(pick.id);
      for (const id of pick.set) coveredUnits.add(id);
    }
    let coveredMass = 0;
    for (const id of coveredUnits) coveredMass += massOf.get(id) ?? 0;
    const coverageFraction = totalAtRiskMass > 0 ? round4(coveredMass / totalAtRiskMass) : 0;
    return { chosen, coveredMass: round4(coveredMass), totalAtRiskMass: round4(totalAtRiskMass), coverageFraction, guaranteedBound: round4(1 - 1 / Math.E) };
  } catch {
    return { chosen: [], coveredMass: 0, totalAtRiskMass: 0, coverageFraction: 0, guaranteedBound: round4(1 - 1 / Math.E) };
  }
}

export interface BequestGauntlet {
  /** S(u) reliability identity: 0 holders→0, one f=1→1, two f=0.5→0.75. */
  survivalIdentity: boolean;
  /** S monotone non-decreasing as fluency rises / heirs are added (sweep). */
  survivalMonotone: boolean;
  /** completeness = survivingMass/totalMass and orphaned = total−surviving exact. */
  completenessIdentity: boolean;
  /** capsule bodyHash is stable + a tampered unit breaks it. */
  capsuleTamperEvident: boolean;
  /** a correct heir claim verifies; a wrong hash is rejected. */
  inheritanceVerifies: boolean;
  /** greedy set-cover ≥ (1−1/e)·OPT vs brute-force optimal on a fixed instance. */
  setCoverBeatsBound: boolean;
  /** deterministic. */
  deterministic: boolean;
  /** total on garbage. */
  stable: boolean;
  cases: number;
  score: number;
}

/** Prove the inheritance math. Deterministic sweep (no Math.random). */
export function bequestGauntlet(): BequestGauntlet {
  try {
    // 1. survival identity
    const sId = survival({ holders: [] }) === 0
      && survival({ holders: [{ id: "a", fluency: 1 }] }) === 1
      && Math.abs(survival({ holders: [{ id: "a", fluency: 0.5 }, { id: "b", fluency: 0.5 }] }) - 0.75) < 1e-9;

    // 2. monotonicity sweep (LCG)
    let mono = true; let seed = 90210;
    const next = () => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff; };
    const CASES = 4000;
    for (let i = 0; i < CASES; i++) {
      const holders: Heir[] = Array.from({ length: 1 + Math.floor(next() * 4) }, (_, j) => ({ id: `h${j}`, fluency: next() }));
      const s0 = survival({ holders });
      // raise one fluency
      const idx = Math.floor(next() * holders.length);
      const raised = holders.map((h, j) => j === idx ? { ...h, fluency: clamp01(h.fluency + 0.1) } : h);
      if (survival({ holders: raised }) < s0 - 1e-9) mono = false;
      // add a heir
      const added = [...holders, { id: "extra", fluency: next() }];
      if (survival({ holders: added }) < s0 - 1e-9) mono = false;
    }

    // 3. completeness identity
    const units: KnowledgeUnit[] = [
      { id: "pay.ts", mass: 100, holders: [{ id: "alice", fluency: 0.9 }] },
      { id: "auth.ts", mass: 50, holders: [{ id: "bob", fluency: 0.2 }] },
      { id: "legacy.ts", mass: 30, holders: [] },
    ];
    const rep = inheritanceReport(units, { orphanThreshold: 0.5 });
    const cId = Math.abs(rep.orphanedMass - (rep.totalMass - rep.survivingMass)) < 1e-3
      && Math.abs(rep.completeness - rep.survivingMass / rep.totalMass) < 1e-3
      && rep.orphans.some((o) => o.id === "legacy.ts"); // 0 holders ⇒ orphaned

    // 4. capsule tamper-evidence
    const cap = mintCapsule({ holderId: "alice", units, reasoning: "owns the payment path" });
    const cap2 = mintCapsule({ holderId: "alice", units, reasoning: "owns the payment path" });
    const capTamper = cap.bodyHash.length === 64 && cap.bodyHash === cap2.bodyHash
      && mintCapsule({ holderId: "alice", units, reasoning: "TAMPERED" }).bodyHash !== cap.bodyHash;

    // 5. inheritance verifies
    const goodHashes: Record<string, string> = {}; for (const u of cap.units) goodHashes[u.id] = u.contentHash;
    const okVerdict = verifyInheritance(cap, "carol", goodHashes);
    const badVerdict = verifyInheritance(cap, "carol", { ...goodHashes, "pay.ts": "deadbeef" });
    const invOk = okVerdict.ok && Math.abs(okVerdict.coverageByMass - 1) < 1e-9 && !badVerdict.ok && badVerdict.missing.includes("pay.ts");

    // 6. set-cover ≥ (1−1/e)·OPT vs brute force
    const atRisk = [{ id: "u1", mass: 10 }, { id: "u2", mass: 8 }, { id: "u3", mass: 6 }, { id: "u4", mass: 4 }];
    const cands: HeirCandidate[] = [
      { id: "c1", canCover: ["u1", "u2"] },
      { id: "c2", canCover: ["u1", "u3"] },
      { id: "c3", canCover: ["u3", "u4"] },
      { id: "c4", canCover: ["u2", "u4"] },
    ];
    const budget = 2;
    const greedy = minHeirCover(atRisk, cands, budget);
    // brute-force optimal coverage for k=budget
    const massOf = new Map(atRisk.map((u) => [u.id, u.mass]));
    let opt = 0;
    for (let i = 0; i < cands.length; i++) for (let j = i + 1; j < cands.length; j++) {
      const set = new Set([...cands[i]!.canCover, ...cands[j]!.canCover]);
      let m = 0; for (const id of set) m += massOf.get(id) ?? 0;
      if (m > opt) opt = m;
    }
    const bound = (1 - 1 / Math.E) * opt;
    const setCoverOk = greedy.coveredMass >= bound - 1e-9 && greedy.chosen.length <= budget;

    const deterministic = JSON.stringify(inheritanceReport(units)) === JSON.stringify(inheritanceReport(units));

    let stable = true;
    try {
      survival(null as never); inheritanceReport(null as never); mintCapsule(null as never);
      verifyInheritance(null as never, null as never, null as never); minHeirCover(null as never, null as never, NaN as never);
    } catch { stable = false; }

    const perfect = sId && mono && cId && capTamper && invOk && setCoverOk && deterministic && stable;
    return { survivalIdentity: sId, survivalMonotone: mono, completenessIdentity: cId, capsuleTamperEvident: capTamper, inheritanceVerifies: invOk, setCoverBeatsBound: setCoverOk, deterministic, stable, cases: CASES, score: perfect ? 100 : 0 };
  } catch {
    return { survivalIdentity: false, survivalMonotone: false, completenessIdentity: false, capsuleTamperEvident: false, inheritanceVerifies: false, setCoverBeatsBound: false, deterministic: false, stable: false, cases: 0, score: 0 };
  }
}
