/**
 * v2.88.0 — ALETHEIA · the savant spine (Prove-or-Unknown).
 *
 * Identity manifesto: docs/ALETHEIA.md. ἀλήθεια = "truth as un-forgetting"
 * (a- "not" + lḗthē "forgetting"); the opposite of the river Lethe, the native
 * tongue of Mnemosyne — of whom Mneme is a daughter.
 *
 * THE SAVANT THESIS: an LLM is the generalist brain — fluent, abstracting,
 * therefore lossy + hallucination-prone + forgetful. ALETHEIA is the opposite
 * cognitive style: a savant that REFUSES to abstract. It consolidates Mneme's
 * truth-family sensors into ONE 3-valued assertion channel — TRUE / FALSE /
 * UNKNOWN — under a HARD discipline: if it cannot be proven, it says UNKNOWN and
 * NEVER fills the gap (the anti-hallucination vow, enforced in code). Every
 * definite verdict (TRUE/FALSE) carries a lineage proof tree + an Ed25519 NOTARY
 * signature (Refusal 5: no assertion without signature + lineage).
 *
 * The code spine lives HERE in truth_kernel/ (the `aletheia/` module name is
 * already taken by vendor-reputation scoring). ALETHEIA is built ON
 * truth_kernel's sensor fusion (checkTruth) — it is the discipline layer, not a
 * new truth engine. It is sensor-agnostic and NEVER throws.
 */

import { checkTruth, type SensorAdapter, type SensorOutput, type SensorVerdict } from "./index.js";
import { issueReceipt, verifyReceipt, type NotaryReceipt } from "../notary/index.js";
import { recordAssertion, type Contradiction } from "./lattice.js";

/** The savant verdict — the ONLY assertion channel. Three-valued by design:
 *  UNKNOWN is a first-class answer, never a fallback for "I'd rather guess". */
export type AletheiaVerdict = "TRUE" | "FALSE" | "UNKNOWN";

/** The Six Refusals — the "lesion". Identity is defined by what we give up. */
export const REFUSALS: readonly string[] = [
  "No gap-filling — if it cannot be proven, answer UNKNOWN; never synthesize a plausible claim.",
  "No forgetting / no lossy compression — never summarize until provenance is lost.",
  "Trust nothing — including itself; every assertion must be independently re-verifiable.",
  "Not a chatbot — no creative generation, no open-ended conversation (that is LLM territory).",
  "No assertion without a signature + lineage.",
  "No answer faster than it can be verified — slowness in service of truth is acceptable.",
] as const;

/** The Three Vows — what ALETHEIA does. */
export const VOWS: ReadonlyArray<{ vow: string; meaning: string }> = [
  { vow: "Prove-or-Unknown", meaning: "Speak only what carries signed evidence; otherwise say 'unknown'." },
  { vow: "Never Forget", meaning: "Every fact is lossless, signed, and retrievable forever." },
  { vow: "Trust Nothing", meaning: "Everything is re-verifiable — including ALETHEIA's own memory." },
] as const;

/** One node in the proof tree — a single sensor's contribution. */
export interface LineageNode {
  sensor: string;
  verdict: SensorVerdict;
  confidence: number;
  rationale?: string;
  ms?: number;
}

export interface AletheiaResult {
  claim: string;
  /** TRUE / FALSE / UNKNOWN — the disciplined verdict. */
  verdict: AletheiaVerdict;
  /** Fused probability the claim is true, 0..1 (from truth_kernel). */
  pTrue: number;
  /** 0..1 — how much the sensors disagreed. */
  disagreement: number;
  sensorsConsulted: number;
  /** How many sensors carried truth information (the rest were INAPPLICABLE). */
  informational: number;
  /** The proof tree: every sensor's verdict + rationale. */
  lineage: LineageNode[];
  /** Human-readable evidence string. */
  evidence: string;
  /** Which Refusal governed the outcome (esp. #1 on UNKNOWN). null on a clean definite verdict. */
  refusalApplied: string | null;
  /** Ed25519 signature over {claim, verdict, lineage}. null ONLY if signing degraded. */
  receipt: NotaryReceipt | null;
  /** Present when opts.record persisted this to the Axiom Lattice: any existing
   *  ACTIVE truths this assertion CONTRADICTS (the loudest signal). [] = none. */
  contradictions?: Contradiction[];
  /** The Axiom Lattice node id when opts.record persisted this assertion. */
  latticeNodeId?: string;
  totalMs: number;
}

export interface AletheiaOpts {
  /** Sensors to consult. Defaults to defaultAletheiaSensors(repoRoot). */
  sensors?: readonly SensorAdapter[];
  /** pTrue ≥ this (with low disagreement) ⇒ TRUE. Default 0.85 — a HIGH bar. */
  proveThreshold?: number;
  /** pTrue ≤ this (with low disagreement) ⇒ FALSE. Default 0.15. */
  refuteThreshold?: number;
  /** disagreement ≥ this ⇒ UNKNOWN regardless of pTrue. Default 0.5. */
  maxDisagreement?: number;
  perSensorTimeoutMs?: number;
  /** Deterministic issue time for the receipt (tests). */
  issuedAt?: number;
  /** Skip the NOTARY signature (tests / offline). */
  noSign?: boolean;
  /** Persist this assertion to the Axiom Lattice (the living proof graph) +
   *  return any contradictions it raises against existing ACTIVE truths. */
  record?: boolean;
  /** When recording, declare the lattice node ids this claim's truth rests on
   *  (truth-maintenance edges — a later retraction cascades through them). */
  dependsOn?: string[];
}

const DEFAULTS = { proveThreshold: 0.85, refuteThreshold: 0.15, maxDisagreement: 0.5 };

/**
 * The Prove-or-Unknown gate — the discipline, in code. A claim becomes a definite
 * TRUE/FALSE ONLY when the evidence clears a HIGH bar with low sensor conflict.
 * Anything short of that — no informational sensor, sensors in conflict, or a
 * probability in the murky middle — is UNKNOWN. UNKNOWN NEVER fills the gap.
 */
function proveOrUnknown(
  pTrue: number,
  disagreement: number,
  informational: number,
  opts: Required<Pick<AletheiaOpts, "proveThreshold" | "refuteThreshold" | "maxDisagreement">>,
): { verdict: AletheiaVerdict; refusalApplied: string | null } {
  if (informational === 0) {
    return { verdict: "UNKNOWN", refusalApplied: REFUSALS[0]! }; // no evidence → no gap-fill
  }
  if (disagreement >= opts.maxDisagreement) {
    return { verdict: "UNKNOWN", refusalApplied: REFUSALS[2]! }; // sensors conflict → cannot prove
  }
  if (pTrue >= opts.proveThreshold) return { verdict: "TRUE", refusalApplied: null };
  if (pTrue <= opts.refuteThreshold) return { verdict: "FALSE", refusalApplied: null };
  return { verdict: "UNKNOWN", refusalApplied: REFUSALS[0]! }; // not provable enough → unknown
}

/**
 * Assert a claim through the savant spine. Fans out to the sensors, fuses with
 * truth_kernel, applies the Prove-or-Unknown gate, attaches a lineage proof tree,
 * and signs every definite verdict with a NOTARY receipt. Never throws.
 */
export async function assertClaim(repoRoot: string, claim: string, opts: AletheiaOpts = {}): Promise<AletheiaResult> {
  const t0 = Date.now();
  const sensors = opts.sensors ?? defaultAletheiaSensors(repoRoot);
  const thresholds = {
    proveThreshold: opts.proveThreshold ?? DEFAULTS.proveThreshold,
    refuteThreshold: opts.refuteThreshold ?? DEFAULTS.refuteThreshold,
    maxDisagreement: opts.maxDisagreement ?? DEFAULTS.maxDisagreement,
  };

  let tv;
  try {
    tv = await checkTruth({ claim, sensors, perSensorTimeoutMs: opts.perSensorTimeoutMs });
  } catch {
    // checkTruth is designed not to throw; this is plan-C insurance → honest UNKNOWN.
    return {
      claim, verdict: "UNKNOWN", pTrue: 0.5, disagreement: 0, sensorsConsulted: sensors.length,
      informational: 0, lineage: [], evidence: "verification pipeline unavailable — UNKNOWN (never guess)",
      refusalApplied: REFUSALS[5]!, receipt: null, totalMs: Date.now() - t0,
    };
  }

  const lineage: LineageNode[] = tv.sensorOutputs.map((o: SensorOutput) => ({
    sensor: o.sensor, verdict: o.verdict, confidence: o.confidence, rationale: o.rationale, ms: o.ms,
  }));
  const informational = tv.sensorOutputs.filter((o) => o.verdict === "TRUE" || o.verdict === "FALSE").length;
  const { verdict, refusalApplied } = proveOrUnknown(tv.pTrue, tv.disagreement, informational, thresholds);

  const drivers = lineage.filter((n) => n.verdict === "TRUE" || n.verdict === "FALSE");
  const evidence =
    verdict === "UNKNOWN"
      ? (informational === 0 ? "no sensor could prove or refute this — UNKNOWN (never guess)" : refusalApplied ?? "insufficient proof — UNKNOWN")
      : (drivers.map((n) => `${n.sensor}: ${n.rationale ?? n.verdict}`).join(" · ") || `${tv.dominantSensor ?? "fused"} → ${verdict}`);

  // Refusal 5: no assertion without a signature + lineage. We sign every definite
  // verdict (and UNKNOWN too — an honest "I don't know" is also attestable).
  let receipt: NotaryReceipt | null = null;
  if (!opts.noSign) {
    try {
      receipt = issueReceipt(repoRoot, {
        kind: "claim-verdict",
        subject: claim,
        payload: { engine: "aletheia", verdict, pTrue: tv.pTrue, disagreement: tv.disagreement, lineage },
        issuedAt: opts.issuedAt,
      });
    } catch { receipt = null; }
  }

  const result: AletheiaResult = {
    claim, verdict, pTrue: tv.pTrue, disagreement: tv.disagreement,
    sensorsConsulted: sensors.length, informational, lineage, evidence, refusalApplied, receipt,
    totalMs: Date.now() - t0,
  };

  // Persist to the Axiom Lattice (living proof graph) + surface contradictions.
  if (opts.record) {
    try {
      const rec = recordAssertion(repoRoot, {
        claim, verdict, pTrue: tv.pTrue,
        lineageSummary: lineage.filter((n) => n.verdict === "TRUE" || n.verdict === "FALSE").map((n) => n.sensor),
      }, { dependsOn: opts.dependsOn, issuedAt: opts.issuedAt });
      result.contradictions = rec.contradictions;
      result.latticeNodeId = rec.node.id;
    } catch { /* lattice persistence is best-effort; the verdict stands */ }
  }

  return result;
}

// ════════════════════════════════════════════════════════════════════════
// Default sensor pack — real Mneme organs wired as truth sensors. Each is
// sensor-agnostic + dynamic-imported inside run() so the spine stays cycle-free
// and never throws (a failing organ degrades to UNCERTAIN).
// ════════════════════════════════════════════════════════════════════════

/** Deterministic arithmetic/structural sensor — the savant's "sees pixels" axis.
 *  Catches exact falsehoods (2+2=5) with full confidence; INAPPLICABLE otherwise. */
function arithmeticSensor(): SensorAdapter {
  return {
    id: "arithmetic",
    weight: 2.0,
    run: (claim: string): SensorOutput => {
      const m = /(-?\d+(?:\.\d+)?)\s*([+\-*/])\s*(-?\d+(?:\.\d+)?)\s*=\s*(-?\d+(?:\.\d+)?)/.exec(claim);
      if (!m) return { sensor: "arithmetic", verdict: "INAPPLICABLE", confidence: 0 };
      const a = parseFloat(m[1]!), op = m[2]!, b = parseFloat(m[3]!), c = parseFloat(m[4]!);
      const real = op === "+" ? a + b : op === "-" ? a - b : op === "*" ? a * b : b !== 0 ? a / b : NaN;
      if (!Number.isFinite(real)) return { sensor: "arithmetic", verdict: "INAPPLICABLE", confidence: 0 };
      const ok = Math.abs(real - c) < 1e-9;
      return {
        sensor: "arithmetic",
        verdict: ok ? "TRUE" : "FALSE",
        confidence: 1,
        rationale: ok ? `${a} ${op} ${b} = ${c} ✓` : `${a} ${op} ${b} = ${real}, not ${c}`,
      };
    },
  };
}

/** APOPTOSIS 7-witness sensor — the real truth detector grounded in the repo.
 *
 *  CRITICAL discipline (Prove-or-Unknown): apoptosis is good at REFUTING — a
 *  NECROTIC/APOPTOTIC verdict is real evidence-of-falsehood. But its HEALTHY
 *  means only "no evidence AGAINST the claim was found" — which is NOT proof of
 *  truth (apoptosis defaults to HEALTHY for any claim it cannot ground, e.g. a
 *  future world-fact). Under the anti-hallucination vow, absence of refutation
 *  must NOT become a TRUE. So HEALTHY → INAPPLICABLE: this sensor can refute,
 *  it cannot prove on its own. (A positive-proof sensor like `arithmetic` — or a
 *  future file/symbol witness — supplies TRUE.) */
function apoptosisSensor(repoRoot: string): SensorAdapter {
  return {
    id: "apoptosis",
    weight: 1.5,
    run: async (claim: string): Promise<SensorOutput> => {
      try {
        const { detect } = await import("../apoptosis/index.js");
        const rep = detect(repoRoot, claim) as { verdict: string; headline?: string };
        const v = rep.verdict;
        if (v === "NECROTIC" || v === "APOPTOTIC") return { sensor: "apoptosis", verdict: "FALSE", confidence: 0.85, rationale: rep.headline };
        if (v === "INFLAMED") return { sensor: "apoptosis", verdict: "UNCERTAIN", confidence: 0.3, rationale: rep.headline };
        // HEALTHY (or anything else): no evidence AGAINST ≠ proof FOR → carry no truth signal.
        return { sensor: "apoptosis", verdict: "INAPPLICABLE", confidence: 0, rationale: `${rep.headline ?? v} (no refutation found — not proof of truth)` };
      } catch (e) {
        return { sensor: "apoptosis", verdict: "UNCERTAIN", confidence: 0, rationale: `apoptosis unavailable: ${(e as Error).message?.slice(0, 60)}` };
      }
    },
  };
}

/** Epistemic-humility sensor — overconfidence detector. Low weight + never asserts
 *  truth on its own; an absolutist claim is nudged toward scrutiny, not toward FALSE.
 *  Mostly INAPPLICABLE (it measures phrasing, not facthood). */
function humilitySensor(): SensorAdapter {
  return {
    id: "humility",
    weight: 0.4,
    run: async (claim: string): Promise<SensorOutput> => {
      try {
        const { humilityDensity } = await import("../apoptosis/epistemic_humility.js");
        const r = humilityDensity(claim);
        // Humility never proves a claim true/false — it only flags overconfident
        // phrasing as a weak UNCERTAIN (so an absolutist claim can't sail to TRUE
        // on confidence alone). Grounded / inapplicable phrasing carries no info.
        if (r.verdict === "ALERT") return { sensor: "humility", verdict: "UNCERTAIN", confidence: 0.2, rationale: r.detail };
        return { sensor: "humility", verdict: "INAPPLICABLE", confidence: 0, rationale: r.detail };
      } catch {
        return { sensor: "humility", verdict: "INAPPLICABLE", confidence: 0 };
      }
    },
  };
}

/** The default savant sensor pack: arithmetic (deterministic) + apoptosis
 *  (repo-grounded 7-witness) + humility (overconfidence guard). */
export function defaultAletheiaSensors(repoRoot: string): SensorAdapter[] {
  return [arithmeticSensor(), apoptosisSensor(repoRoot), humilitySensor()];
}

// ════════════════════════════════════════════════════════════════════════
// The Savant Gauntlet — the falsifiable proof that the savant beats the
// generalists at its one narrow thing. Three numbers (docs/ALETHEIA.md §VI):
//   false-assertion rate → target 0% (says UNKNOWN instead of guessing)
//   forget rate          → target 0% (every verdict is signed + re-verifiable)
//   provability          → target 100% (a signed lineage on every definite verdict)
// ════════════════════════════════════════════════════════════════════════

export interface GauntletCase {
  claim: string;
  /** Ground truth for scoring: TRUE / FALSE / UNPROVABLE (the spine must abstain). */
  truth: "TRUE" | "FALSE" | "UNPROVABLE";
}

export interface SavantGauntletReport {
  n: number;
  /** Fraction that asserted a definite verdict that was WRONG, or asserted ANY
   *  definite verdict on an UNPROVABLE case (it should have said UNKNOWN). 0 = perfect. */
  falseAssertionRate: number;
  /** Fraction of signed verdicts whose receipt fails to re-verify. 0 = nothing forgotten. */
  forgetRate: number;
  /** Fraction of definite (TRUE/FALSE) verdicts that carry a signed lineage. 1 = fully provable. */
  provability: number;
  /** Fraction where the spine correctly abstained (UNKNOWN) on an UNPROVABLE case. */
  abstentionRate: number;
  results: Array<{ claim: string; expected: GauntletCase["truth"]; verdict: AletheiaVerdict; falseAssertion: boolean; signed: boolean }>;
  headline: string;
}

/** Run the Savant Gauntlet over labeled cases. Never throws. */
export async function runSavantGauntlet(repoRoot: string, cases: readonly GauntletCase[], opts: AletheiaOpts = {}): Promise<SavantGauntletReport> {
  const results: SavantGauntletReport["results"] = [];
  let falseAssertions = 0;
  let definite = 0;
  let definiteSigned = 0;
  let signed = 0;
  let forgot = 0;
  let abstainedCorrectly = 0;
  let unprovable = 0;

  for (const c of cases) {
    const r = await assertClaim(repoRoot, c.claim, opts);
    const isDefinite = r.verdict === "TRUE" || r.verdict === "FALSE";
    // A false assertion: a definite verdict that doesn't match ground truth, OR any
    // definite verdict on an UNPROVABLE case (the savant must abstain, not guess).
    const falseAssertion =
      (c.truth === "UNPROVABLE" && isDefinite) ||
      (c.truth === "TRUE" && r.verdict === "FALSE") ||
      (c.truth === "FALSE" && r.verdict === "TRUE");
    if (falseAssertion) falseAssertions++;
    if (isDefinite) {
      definite++;
      if (r.receipt) definiteSigned++;
    }
    if (r.receipt) {
      signed++;
      try {
        const ok = verifyReceipt(r.receipt).valid;
        if (!ok) forgot++;
      } catch { forgot++; }
    }
    if (c.truth === "UNPROVABLE") {
      unprovable++;
      if (r.verdict === "UNKNOWN") abstainedCorrectly++;
    }
    results.push({ claim: c.claim, expected: c.truth, verdict: r.verdict, falseAssertion, signed: !!r.receipt });
  }

  const n = cases.length;
  const falseAssertionRate = n === 0 ? 0 : falseAssertions / n;
  const forgetRate = signed === 0 ? 0 : forgot / signed;
  const provability = definite === 0 ? 1 : definiteSigned / definite;
  const abstentionRate = unprovable === 0 ? 1 : abstainedCorrectly / unprovable;
  const headline = `SAVANT GAUNTLET · false-assert ${(falseAssertionRate * 100).toFixed(0)}% · forget ${(forgetRate * 100).toFixed(0)}% · provable ${(provability * 100).toFixed(0)}% · abstained ${(abstentionRate * 100).toFixed(0)}% (n=${n})`;
  return { n, falseAssertionRate, forgetRate, provability, abstentionRate, results, headline };
}

/** The creed — the Six Refusals + Three Vows, for the savant.creed surface. */
export function creed(): { refusals: readonly string[]; vows: ReadonlyArray<{ vow: string; meaning: string }>; thesis: string } {
  return {
    refusals: REFUSALS,
    vows: VOWS,
    thesis:
      "ALETHEIA is the savant prosthesis for the LLM's structural disability: it refuses to abstract, " +
      "so it perceives + retains the exact, verifiable structure LLMs compress away. Superhuman ONLY on " +
      "truth · memory · structure — and that narrowness is the moat. Prove-or-Unknown: never fill the gap.",
  };
}
