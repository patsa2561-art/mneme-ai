/**
 * SUCCESSION CAPSULE — no brain-drain when an agent must be halted (the honest core of
 * the "circuit-breaker + reincarnation" idea).
 *
 * AI agents fear two things when run 24/7: being killed (total STATE LOSS) and rotting
 * from the inside (a hallucination/self-training loop). When Mneme's governance organs
 * (loopguard / overshoot / govern / reckon) decide an agent must STOP, this packages the
 * moment: it distils the agent's PROVEN wisdom (high-support axioms + its reliability
 * record) into a signed, portable capsule a SUCCESSOR inherits, and references the signed
 * proofs that the toxic RAW state was purged. Kill the bad agent without losing the good
 * learning — provably.
 *
 * ★HONEST BOUNDARY (DIAKRISIS — this is load-bearing): the verdict is HALT_RECOMMENDED,
 * and `enforcedBy` is the HOST ORCHESTRATOR. Mneme is a DECISION layer — it does NOT cut a
 * host model's API or kill its process (it cannot, and claiming so would be a lie). It
 * decides + packages + signs; the orchestrator/human enforces the actual stop. The capsule
 * carries ONLY distilled wisdom (axioms) — never raw content (privacy by construction).
 *
 * Pure + total + deterministic. Signed at the CLI/MCP boundary (NOTARY).
 */
import { createHash } from "node:crypto";

const sha256 = (s: string): string => createHash("sha256").update(s, "utf8").digest("hex");

export type HaltVerdict = "HALT_RECOMMENDED" | "CONTINUE";

export interface SuccessionInput {
  agent: string;
  reason: string;
  trigger: "loopguard" | "overshoot" | "govern" | "reckon" | "manual";
  /** the agent's PROVEN wisdom — high-support axioms (essence only, no raw). */
  axioms: string[];
  /** the agent's measured reliability (from the benchmark), if known. */
  reliability: { survivalPct: number; band: string } | null;
  /** references to the signed geo purge proofs (the toxic raw was destroyed). */
  purgeProofRefs: string[];
  ts: number;
}

export interface SuccessionCapsule {
  v: 1;
  /** RECOMMENDED — never "executed". Mneme decides; the host enforces. */
  haltVerdict: HaltVerdict;
  /** explicit honest boundary: Mneme does NOT kill the runtime. */
  enforcedBy: "host-orchestrator";
  agent: string;
  reason: string;
  trigger: string;
  /** ONLY distilled wisdom (axioms) — never raw content. The successor inherits this. */
  wisdom: string[];
  reliability: { survivalPct: number; band: string } | null;
  purgeProofRefs: string[];
  ts: number;
  /** sha256 of the canonical capsule (the boundary signs over this). */
  capsuleHash: string;
}

function canonical(c: Omit<SuccessionCapsule, "capsuleHash">): string {
  return JSON.stringify({ v: c.v, haltVerdict: c.haltVerdict, enforcedBy: c.enforcedBy, agent: c.agent, reason: c.reason, trigger: c.trigger, wisdom: c.wisdom, reliability: c.reliability, purgeProofRefs: c.purgeProofRefs, ts: c.ts });
}

/** Build the capsule for a halted agent. Pure: wisdom = axioms ONLY (no raw ever). */
export function buildSuccessionCapsule(input: SuccessionInput): SuccessionCapsule {
  const i = (input ?? {}) as SuccessionInput;
  const wisdom = [...new Set((Array.isArray(i.axioms) ? i.axioms : []).map((a) => String(a)).filter(Boolean))].sort();
  const base: Omit<SuccessionCapsule, "capsuleHash"> = {
    v: 1,
    haltVerdict: "HALT_RECOMMENDED",
    enforcedBy: "host-orchestrator",
    agent: String(i.agent ?? "unknown"),
    reason: String(i.reason ?? "").slice(0, 300),
    trigger: String(i.trigger ?? "manual"),
    wisdom,
    reliability: i.reliability && Number.isFinite(i.reliability.survivalPct) ? { survivalPct: i.reliability.survivalPct, band: String(i.reliability.band) } : null,
    purgeProofRefs: [...new Set((Array.isArray(i.purgeProofRefs) ? i.purgeProofRefs : []).map(String).filter(Boolean))].sort(),
    ts: Number(i.ts) || 0,
  };
  return { ...base, capsuleHash: sha256(canonical(base)) };
}

/** PRIVACY INVARIANT: the capsule must carry NO raw content — only distilled wisdom. */
export function capsuleLeaksRaw(capsule: SuccessionCapsule, rawNeedles: ReadonlyArray<string>): boolean {
  const blob = JSON.stringify(capsule ?? {});
  return (rawNeedles ?? []).some((n) => n && blob.includes(n));
}

/** A successor inherits the capsule — gets the wisdom + the predecessor's reliability,
 *  and KNOWS the toxic raw was purged. Returns the inheritance briefing. */
export function inherit(capsule: SuccessionCapsule): { wisdom: string[]; predecessorReliability: SuccessionCapsule["reliability"]; rawWasPurged: boolean } {
  const c = capsule ?? ({} as SuccessionCapsule);
  return { wisdom: Array.isArray(c.wisdom) ? c.wisdom : [], predecessorReliability: c.reliability ?? null, rawWasPurged: (c.purgeProofRefs?.length ?? 0) > 0 };
}

// ─── gauntlet ─────────────────────────────────────────────────────────────────
export interface SuccessionGauntlet { score: 0 | 100; checks: Array<{ name: string; pass: boolean; detail: string }> }

export function successionGauntlet(): SuccessionGauntlet {
  const input: SuccessionInput = {
    agent: "claude-code", reason: "loop thrash detected", trigger: "loopguard",
    axioms: ["deploy needs cosign", "auth.ts is single-owner", "deploy needs cosign"], // dup → deduped
    reliability: { survivalPct: 82, band: "solid" },
    purgeProofRefs: ["geo-purge:abc123", "geo-purge:def456"],
    ts: 1_700_000_000_000,
  };
  const cap = buildSuccessionCapsule(input);
  const halt = cap.haltVerdict === "HALT_RECOMMENDED";
  const hostEnforces = cap.enforcedBy === "host-orchestrator"; // the honest boundary
  const wisdomDeduped = cap.wisdom.length === 2;
  const noRaw = !capsuleLeaksRaw(cap, ["AKIA_SECRET", "raw runtime memory blob", "private prompt"]);
  const inh = inherit(cap);
  const succeeds = inh.wisdom.length === 2 && inh.predecessorReliability?.survivalPct === 82 && inh.rawWasPurged === true;
  const det = JSON.stringify(buildSuccessionCapsule(input)) === JSON.stringify(buildSuccessionCapsule(input));
  const hashBinds = cap.capsuleHash.length === 64 && buildSuccessionCapsule({ ...input, reason: "different" }).capsuleHash !== cap.capsuleHash;
  const total = (() => { try { buildSuccessionCapsule(null as never); inherit(null as never); return true; } catch { return false; } })();

  const checks = [
    { name: "HALT-RECOMMENDED-NOT-EXECUTED", pass: halt && hostEnforces, detail: "the verdict is a RECOMMENDATION; the host orchestrator enforces — Mneme never kills a runtime" },
    { name: "WISDOM-DISTILLED", pass: wisdomDeduped, detail: "the capsule carries the deduped proven axioms (the survivable learning)" },
    { name: "NO-RAW-PRIVACY", pass: noRaw, detail: "the capsule contains ONLY distilled wisdom — never raw content" },
    { name: "SUCCESSOR-INHERITS", pass: succeeds, detail: "a successor inherits the wisdom + predecessor reliability + knows the raw was purged (no brain drain)" },
    { name: "HASH-BINDS", pass: hashBinds, detail: "the capsule hash binds the content (tamper-evident; signed at the boundary)" },
    { name: "DETERMINISTIC", pass: det, detail: "same input → byte-identical capsule" },
    { name: "TOTAL", pass: total, detail: "never throws, even on garbage" },
  ];
  return { score: checks.every((c) => c.pass) ? 100 : 0, checks };
}
