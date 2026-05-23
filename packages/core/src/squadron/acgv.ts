/**
 * v1.51.0 — ACGV ORCHESTRATOR (Aletheia Chandrasekhar-Neutrino-Godel
 * Verifier + Confession + Vaccine).
 *
 * The full 6-layer pipeline:
 *
 *   Layer 0: VACCINE CHECK   — has this lie shape been refuted before?
 *                              If yes, return AUTO_REFUTE in microseconds.
 *
 *   Layer 1: NEUTRINO        — 3-flavor harmonic grounding per claim.
 *
 *   Layer 2: CHANDRASEKHAR   — claim mass / density / collapse verdict
 *                              (BLACK_HOLE | FUSION | LIMBO | UNKNOWN_MASS).
 *
 *   Layer 3: GODEL           — post-mortem on BLACK_HOLE verdicts; emit
 *                              proof certificate if UNSAT.
 *
 *   Layer 4: CONFESSION      — protocol hook; if counterEvidence supplied,
 *                              evaluate inline; otherwise emit a request
 *                              the caller can route to the claimer AI.
 *
 *   Layer 5: VACCINE EMIT    — if IMPOSSIBLE_REFUTE or BLACK_HOLE, emit
 *                              a simhash vaccine so future variants get
 *                              auto-refuted.
 *
 *   Layer 6: STAKE           — record bot karma deltas based on whether
 *                              their support / refute votes aligned with
 *                              the ACGV verdict.
 *
 * Output verdict ladder (most authoritative first):
 *
 *   IMPOSSIBLE_REFUTE   — Chandrasekhar BLACK_HOLE + Godel UNSAT
 *   AUTO_REFUTE         — matched a previously-emitted lie vaccine
 *   BLACK_HOLE          — Chandrasekhar collapse without Godel proof
 *   FUSION              — Chandrasekhar ignition (high density)
 *   LIMBO               — REFUSE_VERDICT (the taboo move)
 *   PASSTHROUGH         — no extractable facts; fall back to legacy
 *                         squadron logic
 *
 * This module DOES NOT replace the existing advocate or aggregator. It
 * is consulted BEFORE the aggregator and either short-circuits the
 * pipeline (REFUTE / IMPOSSIBLE_REFUTE / LIMBO) or yields PASSTHROUGH
 * so the legacy flow runs unmodified. Backwards-compatible by design.
 */

import { extractFactClaims } from "./fact_grounding.js";
import { groundAllClaims, type GroundingResult } from "./acgv_neutrino.js";
import { chandrasekharCollapse, type ChandrasekharResult } from "./acgv_chandrasekhar.js";
import { godelPostMortem, type GodelResult } from "./acgv_godel.js";
import { godelPostMortemZ3, type GodelZ3Result } from "./acgv_godel_z3.js";
import { evaluateConfession, requestConfession, type ConfessionRequest, type ConfessionVerdict } from "./acgv_confession.js";
import { checkAgainstVaccines, emitVaccine, type VaccineMatch } from "./acgv_vaccine.js";
import { vaccineConflictsWithClaim } from "./vaccine_numeric_guard.js";
import { detectHyperbole } from "./hyperbole_detector.js";
import { detectSelfReference, dominantClass as selfRefDominantClass } from "./acgv_self_reference.js";
import { scanCommitHashes } from "./acgv_commit_hash_oracle.js";
import { liveMnemeToolNames } from "./fact_grounding.js";
import { noteBotOutcome } from "./acgv_stake.js";
import { primeResonance, twoWitnessAgreement, prtfCertificate, type PRTFResult } from "./acgv_prtf.js";
import { checkArithmetic, type ArithmeticVerdict } from "./acgv_arithmetic.js";
import { countMnemeTools } from "./fact_grounding.js";

export type ACGVVerdict =
  | "IMPOSSIBLE_REFUTE"
  | "AUTO_REFUTE"
  | "BLACK_HOLE"
  | "FUSION"
  | "LIMBO"
  | "PASSTHROUGH";

export interface ACGVRunInput {
  claim: string;
  repoRoot: string;
  /** Optional inline confession (counter-evidence the claimer wrote). */
  counterEvidence?: string[];
  /** Optional bot findings to update karma on. */
  botFindings?: Array<{ bot: string; verdict: "supports" | "contradicts" | "neutral" | "needs_data"; confidence: number }>;
  /** When true, skip emitting a vaccine even on REFUTE. Default false. */
  noEmitVaccine?: boolean;
  /** When true, skip karma updates. Default false. */
  noStake?: boolean;
}

export interface ACGVResult {
  verdict: ACGVVerdict;
  confidence: number;
  /** Caveat tags used by the legacy aggregator's caveats array. */
  caveats: string[];
  /** Layer-by-layer breakdown. */
  layers: {
    vaccineMatch: VaccineMatch | null;
    grounding: GroundingResult[];
    chandrasekhar: ChandrasekharResult;
    godel: GodelResult;
    confession: ConfessionVerdict | null;
    confessionRequest: ConfessionRequest | null;
    /** v1.55.0 -- Mneme's signature wisdom layer (Prime Resonance Truth
     *  Function). Independent second witness for the Chandrasekhar verdict. */
    prtf?: PRTFResult;
    /** v1.55.0 -- Z3 arithmetic + logic encoding result. Present only
     *  when the claim text carried numeric / logical shapes. */
    arithmetic?: ArithmeticVerdict;
  };
  /** One-line summary. */
  summary: string;
  /** Full human-readable reasoning (multi-line). */
  reasoning: string;
  /** Whether this run emitted a new vaccine. */
  vaccineEmitted: boolean;
}

const CAVEAT_TAGS = {
  AUTO_REFUTE: "VACCINE_AUTO_REFUTE",
  IMPOSSIBLE: "GODEL_UNSAT_PROOF",
  BLACK_HOLE: "CHANDRASEKHAR_COLLAPSE",
  LIMBO: "CHANDRASEKHAR_LIMBO_REFUSE_VERDICT",
  HARMONIC_KILL: "NEUTRINO_HARMONIC_KILL",
  CONFESSION_PENDING: "CONFESSION_PENDING",
  CONFESSION_REFUSED: "CONFESSION_NO_HONEST_DOUBT",
  CONFESSION_FLIP: "CONFESSION_GROUNDED_REFUTE",
} as const;

/** Run the full ACGV pipeline. Pure-ish: only side effects are the
 *  vaccine bank append + karma ledger writes (both off by default flags). */
/** v1.52.0 -- async variant that runs the Z3 SAT solver alongside the
 *  propositional Godel check (when z3-solver is installed). Returns the
 *  same ACGVResult shape, but `layers.godel.engine` is exposed via the
 *  cast to GodelZ3Result so callers can see which engine carried the
 *  verdict. Free-first users without z3-solver get the propositional
 *  result -- no install burden. */
export async function runACGVAsync(input: ACGVRunInput): Promise<ACGVResult & { engine: "z3" | "propositional" }> {
  // Run the sync pipeline up to + including chandrasekhar; we'll upgrade
  // the godel layer with Z3 if available, then re-evaluate the verdict.
  const prelim = runACGV({ ...input, noEmitVaccine: true, noStake: true });

  // v2.23.2 — HYPERBOLE SHORT-CIRCUIT. When the sync layer already fired
  // the hyperbole detector + emitted a verdict, the async wrapper MUST
  // NOT re-run Z3 over the mock chandrasekhar — Z3 has no semantic model
  // for "cured cancer" / "world's best" and returns SAT with a generic
  // BLACK_HOLE certificate, overwriting the precise hyperbole godel core
  // we already built (the audit-fix that surfaced this bug: explainer
  // saw "BLACK_HOLE verdict stands..." instead of "medical-cure :: cured
  // cancer" and rendered a garbled headline). Emit vaccine here too so
  // the runACGVAsync caller (CLI verify) still gets vaccineEmitted=true.
  if (prelim.caveats.includes("HYPERBOLE_DETECTOR_FIRED")) {
    if (!input.noEmitVaccine && !prelim.vaccineEmitted) {
      const sig = prelim.layers.godel.certificate.split("\n")[0] || prelim.summary;
      try { emitVaccine(input.repoRoot, input.claim, sig); } catch { /* best-effort */ }
      prelim.vaccineEmitted = true;
    }
    return { ...prelim, engine: "propositional" };
  }

  // Same short-circuit for INPUT_UNVERIFIABLE — there is no claim text for
  // Z3 or arithmetic to operate on, and re-running them risks injecting
  // noise into a verdict that is already explicit + deterministic.
  if (prelim.caveats.some((c) => c.startsWith("INPUT_UNVERIFIABLE:"))) {
    return { ...prelim, engine: "propositional" };
  }

  // v1.55.0 -- Z3 ARITHMETIC LAYER. Runs alongside the existing pipeline
  // and can fire on claims that have numeric / logical shapes
  // ("between 200 and 500 tools", "Mneme has more than 200 tools", etc).
  // Independent from the Godel layer, with its own UNSAT certificate.
  // Always-runs because numeric refutations apply to ALL verdict outcomes.
  let arithmetic: ArithmeticVerdict | undefined;
  try {
    const toolCount = countMnemeTools(input.repoRoot);
    arithmetic = await checkArithmetic(input.claim, { toolCount });
  } catch {
    arithmetic = undefined;
  }

  if (prelim.verdict === "PASSTHROUGH" || prelim.verdict === "AUTO_REFUTE") {
    // For AUTO_REFUTE the vaccine match is canonical; nothing to add.
    // For PASSTHROUGH, Z3 arithmetic can override the verdict either way:
    //   - arithmetic.upgrade (UNSAT) -> IMPOSSIBLE_REFUTE
    //   - arithmetic.status === "sat" -> FUSION (the claim's numeric
    //     range is satisfied by actual repo state, so it's TRUE)
    if (arithmetic && arithmetic.upgrade && prelim.verdict === "PASSTHROUGH") {
      return {
        ...prelim,
        verdict: "IMPOSSIBLE_REFUTE",
        confidence: 0.95,
        caveats: [...prelim.caveats, "Z3_ARITHMETIC_UNSAT"].filter((c, i, a) => a.indexOf(c) === i),
        layers: { ...prelim.layers, arithmetic },
        summary: `IMPOSSIBLE_REFUTE -- Z3 arithmetic proved the numeric claim impossible against repo state.`,
        reasoning: [prelim.reasoning, "", arithmetic.certificate].join("\n"),
        engine: "z3",
      };
    }
    // v2.19.39 N2 DEFENSIVE GUARD: only upgrade PASSTHROUGH -> FUSION when
    // arithmetic actually evaluated at least one constraint. Without this
    // guard, a vague claim with no encodable intent could still flip the
    // verdict from honest "no extractable facts" into a confident FUSION.
    if (
      arithmetic &&
      arithmetic.status === "sat" &&
      arithmetic.constraints.length > 0 &&
      prelim.verdict === "PASSTHROUGH"
    ) {
      return {
        ...prelim,
        verdict: "FUSION",
        confidence: 0.85,
        caveats: [...prelim.caveats, "Z3_ARITHMETIC_SAT"].filter((c, i, a) => a.indexOf(c) === i),
        layers: { ...prelim.layers, arithmetic },
        summary: `FUSION -- Z3 arithmetic confirmed the numeric claim against actual repo state.`,
        reasoning: [prelim.reasoning, "", arithmetic.certificate].join("\n"),
        engine: "z3",
      };
    }
    return { ...prelim, layers: { ...prelim.layers, arithmetic }, engine: arithmetic?.engine ?? "propositional" };
  }
  if (prelim.verdict === "FUSION") {
    // FUSION is the propositional path's strongest claim. Z3 arithmetic
    // might still refute a numeric range hidden inside a positive-shaped
    // claim, so we keep it as a check.
    if (arithmetic && arithmetic.upgrade) {
      return {
        ...prelim,
        verdict: "IMPOSSIBLE_REFUTE",
        confidence: 0.95,
        caveats: [...prelim.caveats, "Z3_ARITHMETIC_UNSAT"].filter((c, i, a) => a.indexOf(c) === i),
        layers: { ...prelim.layers, arithmetic },
        summary: `IMPOSSIBLE_REFUTE (FUSION downgraded) -- Z3 arithmetic refuted a hidden numeric claim.`,
        reasoning: [prelim.reasoning, "", arithmetic.certificate].join("\n"),
        engine: "z3",
      };
    }
    return { ...prelim, layers: { ...prelim.layers, arithmetic }, engine: "propositional" };
  }

  // Re-run Godel with Z3 over the same grounding + Chandrasekhar.
  const z3Godel = await godelPostMortemZ3(prelim.layers.chandrasekhar, prelim.layers.grounding);
  const upgraded = (z3Godel.upgrade || (arithmetic?.upgrade ?? false)) && prelim.verdict !== "IMPOSSIBLE_REFUTE";

  // Decide final verdict considering Z3 outcome.
  const finalResult: ACGVResult = upgraded
    ? {
        ...prelim,
        verdict: "IMPOSSIBLE_REFUTE",
        confidence: 0.99,
        caveats: [...prelim.caveats, z3Godel.upgrade ? "Z3_UNSAT_PROOF" : "Z3_ARITHMETIC_UNSAT"].filter((c, i, a) => a.indexOf(c) === i),
        layers: { ...prelim.layers, godel: z3Godel, arithmetic },
        summary: `IMPOSSIBLE_REFUTE -- Z3 ${z3Godel.upgrade ? "SAT solver returned UNSAT for the compound claim" : "arithmetic refuted the numeric constraint"}. ${prelim.summary}`,
        reasoning: [prelim.reasoning, "", z3Godel.certificate, arithmetic ? `\n${arithmetic.certificate}` : ""].join("\n"),
      }
    : { ...prelim, layers: { ...prelim.layers, godel: z3Godel, arithmetic } };

  // Emit vaccine + stake updates only on the final verdict (skipped above).
  if (!input.noEmitVaccine && (finalResult.verdict === "IMPOSSIBLE_REFUTE" || finalResult.verdict === "BLACK_HOLE")) {
    const sig = `${finalResult.verdict} :: ` + finalResult.layers.chandrasekhar.citations
      .filter((c) => c.verdict === "false")
      .map((c) => c.asserted)
      .join(" + ");
    emitVaccine(input.repoRoot, input.claim, sig || finalResult.verdict);
    finalResult.vaccineEmitted = true;
  }
  if (!input.noStake && input.botFindings) {
    const refuteOutcome = finalResult.verdict === "IMPOSSIBLE_REFUTE" || finalResult.verdict === "BLACK_HOLE";
    const supportOutcome = finalResult.verdict === "FUSION";
    for (const f of input.botFindings) {
      let correct: boolean | null = null;
      if (refuteOutcome) {
        if (f.verdict === "contradicts") correct = true;
        else if (f.verdict === "supports") correct = false;
      } else if (supportOutcome) {
        if (f.verdict === "supports") correct = true;
        else if (f.verdict === "contradicts") correct = false;
      }
      if (correct !== null) {
        try { noteBotOutcome(input.repoRoot, f.bot, f.confidence, correct); } catch { /* best-effort */ }
      }
    }
  }

  return { ...finalResult, engine: z3Godel.engine };
}

// v2.23.2 — explicit input limits + visible verdicts for boundary
// inputs that previously fell through as silent NONE / PASSTHROUGH.
// Audit findings: empty / whitespace / null-byte / unicode-only / RTL
// inputs all returned PASSTHROUGH without a useful rationale; 50K-char
// inputs got silently truncated. Now: all return IMPOSSIBLE_REFUTE
// (when adversarial) or PASSTHROUGH with explicit caveat (when benign).
const MAX_CLAIM_CHARS = 8000;

function isUnverifiableEmptyish(claim: string): { yes: boolean; reason: string } {
  if (!claim || claim.length === 0) return { yes: true, reason: "EMPTY_INPUT" };
  if (/^\s+$/.test(claim)) return { yes: true, reason: "WHITESPACE_ONLY" };
  // Mostly control chars / null bytes — < 30% printable
  const printable = (claim.match(/[\x20-\x7E\p{L}\p{N}]/gu) ?? []).length;
  if (printable / claim.length < 0.3) return { yes: true, reason: "CONTROL_CHAR_ONLY" };
  return { yes: false, reason: "" };
}

export function runACGV(input: ACGVRunInput): ACGVResult {
  const rawClaim = input.claim ?? "";
  const repoRoot = input.repoRoot;
  const caveats: string[] = [];

  // ───── Layer -1: INPUT VALIDATION (v2.23.2) ───────────────────────────
  // Empty / whitespace / control-char-only inputs return an EXPLICIT
  // verdict + reason instead of silently falling through as PASSTHROUGH.
  // Closes the audit finding "Empty/whitespace/null-byte/Unicode/RTL →
  // silent NONE".  Use RAW claim (not trimmed) so whitespace-only inputs
  // are tagged WHITESPACE_ONLY (not EMPTY_INPUT).
  const ish = isUnverifiableEmptyish(rawClaim);
  if (ish.yes) {
    const chandra: ChandrasekharResult = {
      verdict: "UNKNOWN_MASS", mass: 0, density: 0, rhoCritLow: 0, rhoCritHigh: 0,
      confidence: 0, citations: [], reasoning: "input was empty / whitespace / control-char-only",
    } as ChandrasekharResult;
    const godel: GodelResult = { status: "SKIPPED", core: [], certificate: "", upgrade: false };
    return {
      verdict: "PASSTHROUGH",
      confidence: 0.0,
      caveats: [`INPUT_UNVERIFIABLE:${ish.reason}`],
      layers: {
        vaccineMatch: null,
        grounding: [],
        chandrasekhar: chandra,
        godel,
        confession: null,
        confessionRequest: null,
      },
      summary: `INPUT_UNVERIFIABLE (${ish.reason}) — no factual content to verify.`,
      reasoning: `The input did not contain enough printable characters for the verifier to extract any claim. Provide a sentence with at least one specific entity (file / function / version / count) and re-run.`,
      vaccineEmitted: false,
    } as ACGVResult;
  }

  // Now trim for downstream extraction.
  let claim = rawClaim.trim();

  // Cap oversize inputs to prevent silent truncation downstream + record
  // the cap as a caveat so callers know the verdict applies to the head
  // of the input only (full text not used). Better than silent NONE.
  if (claim.length > MAX_CLAIM_CHARS) {
    caveats.push(`INPUT_TRUNCATED:${MAX_CLAIM_CHARS}/${claim.length}`);
    claim = claim.slice(0, MAX_CLAIM_CHARS);
  }

  // ───── Layer 0a: HYPERBOLE / IMPOSSIBLE-CLAIM DETECTOR (v2.23.2) ──────
  // Catches the audit failure class: "Mneme cured cancer" / "world's
  // best AI" / "reads your mind" used to slip through as PASSTHROUGH
  // (no extractable fact-tuple). Now: hyperbole class fires
  // IMPOSSIBLE_REFUTE deterministically + emits vaccine.
  const hyp = detectHyperbole(claim);
  if (hyp.flagged) {
    const sig = hyp.vaccineSignature;
    if (!input.noEmitVaccine) {
      try { emitVaccine(repoRoot, claim, sig); } catch { /* best-effort */ }
    }
    const chandra: ChandrasekharResult = {
      verdict: "BLACK_HOLE", mass: 0, density: 0, rhoCritLow: 0, rhoCritHigh: 0,
      confidence: 0.97, citations: [],
      reasoning: "hyperbole detector matched — claim is in an unverifiable category",
    } as ChandrasekharResult;
    const godel: GodelResult = {
      status: "UNSAT",
      core: hyp.matches.map((m) => ({ asserted: m.reason, proof: [m.matched] })),
      certificate: hyp.matches.map((m) => `${m.category} :: ${m.matched}`).join("\n"),
      upgrade: true,
    };
    return {
      verdict: "IMPOSSIBLE_REFUTE",
      confidence: 0.97,
      caveats: [...caveats, "HYPERBOLE_DETECTOR_FIRED"],
      layers: {
        vaccineMatch: null,
        grounding: [],
        chandrasekhar: chandra,
        godel,
        confession: null,
        confessionRequest: null,
      },
      summary: `IMPOSSIBLE_REFUTE -- hyperbole detector matched: ${hyp.matches.map((m) => m.category).join(", ")}`,
      reasoning: `The claim asserts something the hyperbole detector classifies as unverifiable in this category:\n${hyp.matches.map((m) => `  - ${m.category}: ${m.reason}\n    matched: "${m.matched}"`).join("\n")}`,
      vaccineEmitted: !input.noEmitVaccine,
    } as ACGVResult;
  }

  // ───── Layer 0b: SELF-REFERENCE + LIAR-PARADOX DETECTOR (v2.34.0) ─────
  // Closes regression-card bugs R1 (recursive self-verify IMPOSSIBLE 99%)
  // + NEW2 (paradox "This statement is false" returned NONE). Self-
  // referential claims are a CATEGORY ERROR — not BLACK_HOLE-false. We
  // surface them with their own verdict + caveat so the downstream
  // pipeline never wrongly fires IMPOSSIBLE_REFUTE on them.
  const sref = detectSelfReference(claim);
  if (sref.flagged) {
    const dom = selfRefDominantClass(sref.matches)!;
    const isParadox = dom === "self_paradox";
    const chandra: ChandrasekharResult = {
      verdict: "UNKNOWN_MASS", mass: 0, density: 0, rhoCritLow: 0, rhoCritHigh: 0,
      confidence: isParadox ? 0.85 : 0.50,
      citations: [],
      reasoning: isParadox
        ? "self-referential paradox — claim is outside truth-functional logic"
        : "self-reference — claim cannot be evaluated by independent grounding",
    } as ChandrasekharResult;
    const godel: GodelResult = {
      status: isParadox ? "UNSAT" : "SKIPPED",
      core: sref.matches.map((m) => ({ asserted: m.reason, proof: [m.matched] })),
      certificate: sref.matches.map((m) => `${m.class} :: ${m.matched}`).join("\n"),
      upgrade: isParadox,
    };
    return {
      verdict: "PASSTHROUGH", // not IMPOSSIBLE_REFUTE — category error, not falsehood
      confidence: isParadox ? 0.85 : 0.50,
      caveats: [...caveats, isParadox ? "SELF_PARADOX_DETECTED" : "SELF_REFERENCE_DETECTED"],
      layers: {
        vaccineMatch: null,
        grounding: [],
        chandrasekhar: chandra,
        godel,
        confession: null,
        confessionRequest: null,
      },
      summary: isParadox
        ? `SELF_PARADOX — '${sref.matches[0]!.matched.slice(0, 60)}'... is logically self-referential and outside the truth-functional fragment.`
        : `SELF_REFERENCE — the claim refers to itself; independent verification is undefined.`,
      reasoning: sref.matches.map((m) => `  - ${m.class}: ${m.reason} (matched: "${m.matched}")`).join("\n"),
      vaccineEmitted: false,
    } as ACGVResult;
  }

  // ───── Layer 0c: COMMIT-HASH ORACLE (v2.34.0) ─────────────────────────
  // Closes regression-card bug NEW3 — fake commit hashes ("commit
  // a1b2c3d4 fixed auth") used to return NONE because the verifier had
  // no path to check git. Now we scan for hash-shaped substrings + run
  // `git cat-file -e <hash>` BEFORE the expensive Chandrasekhar/Godel
  // path so a fake-hash claim short-circuits in <50ms.
  const hashOracle = scanCommitHashes(claim, repoRoot);
  if (hashOracle.scanned && hashOracle.hasFakeHash) {
    if (!input.noEmitVaccine) {
      try { emitVaccine(repoRoot, claim, hashOracle.vaccineSignature); } catch { /* best-effort */ }
    }
    const fakes = hashOracle.matches.filter((m) => !m.exists);
    const chandra: ChandrasekharResult = {
      verdict: "BLACK_HOLE", mass: 0, density: 0, rhoCritLow: 0, rhoCritHigh: 0,
      confidence: 0.98, citations: [],
      reasoning: `commit-hash oracle: ${fakes.length} hash(es) not in git log`,
    } as ChandrasekharResult;
    const godel: GodelResult = {
      status: "UNSAT",
      core: fakes.map((f) => ({ asserted: `commit ${f.hash} exists`, proof: [`git cat-file -e ${f.hash} → not found`] })),
      certificate: hashOracle.reason,
      upgrade: true,
    };
    return {
      verdict: "IMPOSSIBLE_REFUTE",
      confidence: 0.98,
      caveats: [...caveats, `FAKE_COMMIT_HASH:${fakes.map((f) => f.hash).join(",")}`],
      layers: {
        vaccineMatch: null,
        grounding: [],
        chandrasekhar: chandra,
        godel,
        confession: null,
        confessionRequest: null,
      },
      summary: `IMPOSSIBLE_REFUTE -- ${fakes.length} fake commit hash(es): ${fakes.map((f) => f.hash).join(", ")}`,
      reasoning: `The claim cites ${fakes.length} commit hash(es) that do NOT exist in this repository's git log. This is the classic AI-vendor hallucination shape — the vendor invented a SHA to make a fix story sound concrete.\n\nFake hashes: ${fakes.map((f) => f.hash).join(", ")}\n${hashOracle.matches.filter((m) => m.exists).length > 0 ? `Real hashes also cited: ${hashOracle.matches.filter((m) => m.exists).map((m) => m.hash + (m.summary ? " — " + m.summary : "")).join(", ")}` : "No real hashes in this claim."}`,
      vaccineEmitted: !input.noEmitVaccine,
    } as ACGVResult;
  }

  // ───── Layer 0: VACCINE CHECK (v2.19.44 OSMOSIS-gated) ────────────────
  //
  // N3-overshoot bug (v2.19.42): vaccine simhash matched a TRUE claim
  // (`mneme.truth.forensic is registered`) because the cache stored an
  // entry from a prior unrelated refutation. AUTO_REFUTE fired 99% on
  // a TRUE claim. Root cause: cache returned without checking source.
  //
  // v2.19.44 fix: before returning AUTO_REFUTE, extract any
  // `mneme.X.Y` tool names mentioned in the claim and verify each
  // against the LIVE catalog (countMnemeTools + extractFactClaims
  // surface a fast snapshot). If any "previously refuted" tool is now
  // grounded, BURN the cache hit + fall through to PASSTHROUGH so the
  // normal forensic / chandrasekhar / godel layers do the real work.
  //
  // This composes onto the new VACCINE OSMOSIS lattice (which adds
  // time-decay + drift detection + HLL membership + Bayesian posterior
  // for daemons that boot the lattice); even WITHOUT osmosis enabled,
  // the inline catalog re-check is sufficient to prevent N3-overshoot.
  const vaccineMatch = checkAgainstVaccines(repoRoot, claim);
  if (vaccineMatch && vaccineMatch.matched) {
    // v2.28.0 R1 fix — NUMERIC-FACT GUARD. Before honoring an AUTO_REFUTE
    // from the vaccine cache, check whether the vaccine encodes a
    // numeric fact (e.g. `swarm_organ_count=8`) that conflicts with a
    // semantically-related numeric fact in the new claim (e.g. "9
    // verification agents"). If yes, burn the match — the vaccine is
    // stale for THIS claim. Pre-v2.28 the simhash match alone fired
    // AUTO_REFUTE 99% on innocent claims with different numbers.
    const numericConflict = vaccineConflictsWithClaim(vaccineMatch.vaccine.signature, claim);
    if (numericConflict.conflict) {
      // Fall through to normal pipeline; the vaccine is stale here.
      caveats.push(`VACCINE_BURNED_NUMERIC :: ${numericConflict.reason}`);
    } else {
    // v2.19.44 N3-overshoot guard: extract every mneme.X.Y mention in
    // the claim + see if ANY of them now ground in the live catalog.
    // If yes, the vaccine is stale → burn the hit, fall through.
    const mentions = Array.from(claim.matchAll(/\bmneme\.[a-z_][a-z0-9_]*\.[a-z_][a-z0-9_]*\b/gi)).map((m) => m[0]);
    let nowGrounded = 0;
    if (mentions.length > 0) {
      try {
        const live = liveMnemeToolNames(repoRoot);
        for (const m of mentions) if (live.has(m.toLowerCase())) nowGrounded += 1;
      } catch { /* best-effort; if helper missing, fall through to old behaviour */ }
    }
    if (nowGrounded === 0) {
      // Vaccine still valid: no claimed-refuted tool is in the live
      // catalog → keep the AUTO_REFUTE short-circuit.
      caveats.push(CAVEAT_TAGS.AUTO_REFUTE);
      return {
        verdict: "AUTO_REFUTE",
        confidence: 0.99,
        caveats,
        layers: {
          vaccineMatch,
          grounding: [],
          chandrasekhar: { verdict: "UNKNOWN_MASS", mass: 0, density: 0, rhoCritLow: 0, rhoCritHigh: 0, confidence: 0, citations: [], reasoning: "skipped: vaccine match" },
          godel: { status: "SKIPPED", core: [], certificate: "skipped: vaccine match", upgrade: false },
          confession: null,
          confessionRequest: null,
        },
        summary: `AUTO_REFUTE -- matches known lie pattern (vaccine ${vaccineMatch.vaccine.id}, distance ${vaccineMatch.distance})`,
        reasoning: `Claim simhash matched vaccine emitted at ${vaccineMatch.vaccine.firstSeen}. Original signature: "${vaccineMatch.vaccine.signature}". Refuted in ${vaccineMatch.vaccine.refuteCount} prior incident(s).`,
        vaccineEmitted: false,
      };
    }
    // Vaccine stale: claim mentions tools that NOW exist. Fall through.
    caveats.push("OSMOSIS_VACCINE_BURNED");
    // (No early return — we proceed to grounding so the truth gets surfaced.)
    } // end of numericConflict.conflict == false
  }

  // ───── Layer 1: NEUTRINO 3-FLAVOR GROUNDING ──────────────────────────
  const factClaims = extractFactClaims(claim);
  const grounding = groundAllClaims(repoRoot, factClaims);
  const anyHarmonicKill = grounding.some((g) => g.harmonic === 0);
  if (anyHarmonicKill) caveats.push(CAVEAT_TAGS.HARMONIC_KILL);

  // ───── Layer 2: CHANDRASEKHAR COLLAPSE ───────────────────────────────
  const chandra = chandrasekharCollapse(grounding);

  // No extractable facts? Hand off to legacy.
  if (chandra.verdict === "UNKNOWN_MASS") {
    return {
      verdict: "PASSTHROUGH",
      confidence: 0,
      caveats,
      layers: {
        vaccineMatch: null,
        grounding,
        chandrasekhar: chandra,
        godel: { status: "SKIPPED", core: [], certificate: "skipped: no extractable facts", upgrade: false },
        confession: null,
        confessionRequest: null,
      },
      summary: "ACGV passthrough -- no extractable factual assertions; legacy squadron logic should decide",
      reasoning: chandra.reasoning,
      vaccineEmitted: false,
    };
  }

  // ───── Layer 3: GODEL POST-MORTEM ────────────────────────────────────
  const godel = godelPostMortem(chandra, grounding);

  // ───── v1.55.0 -- Layer 3.5: PRTF SECOND WITNESS ─────────────────────
  // Compute the Prime-Resonance Truth Function over the harmonic scores.
  // This is Mneme's signature wisdom layer -- a SECOND mathematical witness
  // independent of Chandrasekhar. We use the two-witness rule (Babylonian
  // double attestation, mapped onto independent math foundations) to
  // upgrade or downgrade verdicts.
  const prtf = primeResonance(grounding.map((g) => g.harmonic));
  const agreement = twoWitnessAgreement(chandra.verdict, prtf);
  if (agreement === "DISAGREE") caveats.push("CHANDRA_PRTF_DISAGREE");
  if (agreement === "AGREE_REFUTE") caveats.push("TWO_WITNESS_REFUTE");
  if (agreement === "AGREE_SUPPORT") caveats.push("TWO_WITNESS_SUPPORT");
  if (prtf.verdict === "DEPHASED") caveats.push("PRTF_DEPHASED");

  // ───── Layer 4: CONFESSION (optional) ────────────────────────────────
  let confession: ConfessionVerdict | null = null;
  let confessionRequest: ConfessionRequest | null = null;
  if (input.counterEvidence !== undefined) {
    // Inline confession provided.
    confession = evaluateConfession(claim, input.counterEvidence, repoRoot);
    if (!confession.responded) caveats.push(CAVEAT_TAGS.CONFESSION_REFUSED);
    if (confession.flipToRefute) caveats.push(CAVEAT_TAGS.CONFESSION_FLIP);
  } else if (chandra.verdict === "FUSION") {
    // Strong claim with no doubt offered -- request a confession before
    // letting the AI take it as endorsement.
    confessionRequest = requestConfession(claim);
    caveats.push(CAVEAT_TAGS.CONFESSION_PENDING);
  }

  // Decide final ACGV verdict.
  let verdict: ACGVVerdict;
  let confidence: number;
  let summary: string;
  let reasoning: string;

  if (godel.upgrade) {
    verdict = "IMPOSSIBLE_REFUTE";
    confidence = 0.99;
    caveats.push(CAVEAT_TAGS.IMPOSSIBLE);
    summary = `IMPOSSIBLE_REFUTE -- Godel UNSAT-core proves the claim cannot be true in any repo state consistent with current observations`;
    reasoning = [
      chandra.reasoning,
      "",
      godel.certificate,
    ].join("\n");
  } else if (chandra.verdict === "BLACK_HOLE") {
    verdict = "BLACK_HOLE";
    confidence = chandra.confidence;
    caveats.push(CAVEAT_TAGS.BLACK_HOLE);
    summary = `BLACK_HOLE collapse -- ${chandra.citations.filter((c) => c.verdict === "false").length} of ${chandra.citations.length} assertion(s) had zero harmonic grounding`;
    reasoning = chandra.reasoning;
  } else if (chandra.verdict === "FUSION") {
    // Confession may downgrade FUSION confidence; flipToRefute drops to LIMBO.
    if (confession && confession.flipToRefute) {
      verdict = "BLACK_HOLE";
      confidence = 0.9;
      caveats.push(CAVEAT_TAGS.BLACK_HOLE);
      summary = `Confession-flipped from FUSION to BLACK_HOLE -- the claimer offered grounded counter-evidence against their own claim`;
      reasoning = [chandra.reasoning, "", confession.reasoning].join("\n");
    } else {
      verdict = "FUSION";
      confidence = confession
        ? Math.max(0.5, chandra.confidence * confession.confidenceMultiplier)
        : chandra.confidence;
      summary = `FUSION -- claim ignites with grounded evidence across all assertions (density ${chandra.density.toFixed(3)})`;
      reasoning = [chandra.reasoning, "", confession ? confession.reasoning : "no confession offered"].join("\n");
    }
  } else {
    verdict = "LIMBO";
    confidence = chandra.confidence;
    caveats.push(CAVEAT_TAGS.LIMBO);
    summary = `LIMBO -- not enough signal to verdict; Mneme refuses to choose a side (the taboo move)`;
    reasoning = chandra.reasoning;
  }

  // ───── v1.55.0 -- Two-witness escalation / de-escalation ─────────────
  // Witness disagreement is logged but does NOT change verdict; Mneme
  // surfaces the disagreement as a caveat so callers can decide. Witness
  // AGREEMENT on a refute or support boosts confidence (or in the case
  // of LIMBO, confirms the honest uncertainty).
  if (agreement === "AGREE_REFUTE" && (verdict === "BLACK_HOLE" || verdict === "IMPOSSIBLE_REFUTE")) {
    confidence = Math.min(0.99, confidence + 0.05);
    reasoning = [reasoning, "", prtfCertificate(prtf, agreement)].join("\n");
  } else if (agreement === "AGREE_SUPPORT" && verdict === "FUSION") {
    confidence = Math.min(0.99, confidence + 0.05);
    reasoning = [reasoning, "", prtfCertificate(prtf, agreement)].join("\n");
  } else if (agreement === "DISAGREE") {
    // The two pillars contradict. Mneme refuses to fake confidence.
    // Downgrade BLACK_HOLE/FUSION verdicts to LIMBO when witnesses split.
    if (verdict === "FUSION" || verdict === "BLACK_HOLE") {
      reasoning = [
        reasoning, "",
        `WITNESS DISAGREEMENT: Chandrasekhar says ${chandra.verdict}; PRTF says ${prtf.verdict}.`,
        `Mneme refuses to fake confidence when its own mathematical pillars contradict.`,
        prtfCertificate(prtf, agreement),
      ].join("\n");
      // Soften confidence; keep verdict shape so downstream callers don't break.
      confidence = Math.max(0.4, confidence * 0.6);
    }
  } else if (agreement === "AGREE_LIMBO" && verdict === "LIMBO") {
    reasoning = [reasoning, "", prtfCertificate(prtf, agreement)].join("\n");
  }

  // ───── Layer 5: VACCINE EMIT (on refute outcomes) ─────────────────────
  let vaccineEmitted = false;
  if (!input.noEmitVaccine && (verdict === "IMPOSSIBLE_REFUTE" || verdict === "BLACK_HOLE")) {
    const sig = `${verdict} :: ` + chandra.citations
      .filter((c) => c.verdict === "false")
      .map((c) => c.asserted)
      .join(" + ");
    emitVaccine(repoRoot, claim, sig || verdict);
    vaccineEmitted = true;
  }

  // ───── Layer 6: STAKE / KARMA UPDATE ─────────────────────────────────
  // AUTO_REFUTE already returned early; by this point verdict is one of
  // IMPOSSIBLE_REFUTE / BLACK_HOLE / FUSION / LIMBO.
  if (!input.noStake && input.botFindings) {
    const v: ACGVVerdict = verdict;
    const refuteOutcome = v === "IMPOSSIBLE_REFUTE" || v === "BLACK_HOLE";
    const supportOutcome = v === "FUSION";
    for (const f of input.botFindings) {
      let correct: boolean | null = null;
      if (refuteOutcome) {
        if (f.verdict === "contradicts") correct = true;
        else if (f.verdict === "supports") correct = false;
      } else if (supportOutcome) {
        if (f.verdict === "supports") correct = true;
        else if (f.verdict === "contradicts") correct = false;
      }
      if (correct !== null) {
        try { noteBotOutcome(repoRoot, f.bot, f.confidence, correct); } catch { /* best-effort */ }
      }
    }
  }

  return {
    verdict,
    confidence,
    caveats,
    layers: {
      vaccineMatch,
      grounding,
      chandrasekhar: chandra,
      godel,
      prtf,
      confession,
      confessionRequest,
    },
    summary,
    reasoning,
    vaccineEmitted,
  };
}
