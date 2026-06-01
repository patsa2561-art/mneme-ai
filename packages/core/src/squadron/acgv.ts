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
import { metaSelfVerify } from "./meta_self_verifier.js";
import { scanCommitHashes } from "./acgv_commit_hash_oracle.js";
import { detectVersionSemantic } from "./acgv_version_semantic.js";
import { checkInputHygiene } from "./acgv_input_hygiene.js";
import { canonicalRewrite, extractCanonicalNumbers } from "./acgv_number_bridge.js";
import { tryAutoGroundNumber } from "./auto_number_ground.js";
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

/**
 * Layer 0 — learned-vaccine fast path. Returns an AUTO_REFUTE verdict when a
 * known lie-shape matches (and the match isn't stale: numeric-conflict guard +
 * live-catalog re-check still apply), else null (caller proceeds through the
 * full pipeline). Pushes burn/match caveats onto `caveats`.
 *
 * v2.114 — this runs FIRST (before the 0a hyperbole / meta-self-verify
 * detectors), as the "Layer 0: VACCINE CHECK" design header always intended.
 * It had drifted to AFTER meta-self-verify, so a vaccinated SELF-claim ("Mneme
 * is written in Rust") returned BLACK_HOLE again instead of the cheap learned
 * AUTO_REFUTE. The stale-guards are unchanged, so moving it earlier is safe.
 */
function tryVaccineAutoRefute(
  repoRoot: string,
  claim: string,
  canonicalClaim: string,
  numberBridged: boolean,
  caveats: string[],
): ACGVResult | null {
  const vaccineMatchA = checkAgainstVaccines(repoRoot, claim);
  const vaccineMatchB = numberBridged ? checkAgainstVaccines(repoRoot, canonicalClaim) : null;
  const vaccineMatch =
    vaccineMatchA && vaccineMatchB
      ? (vaccineMatchA.distance <= vaccineMatchB.distance ? vaccineMatchA : vaccineMatchB)
      : (vaccineMatchA ?? vaccineMatchB);
  if (!(vaccineMatch && vaccineMatch.matched)) return null;
  // NUMERIC-FACT GUARD (v2.28) — burn a stale numeric vaccine.
  const numericConflictA = vaccineConflictsWithClaim(vaccineMatch.vaccine.signature, claim);
  const numericConflictB = numberBridged
    ? vaccineConflictsWithClaim(vaccineMatch.vaccine.signature, canonicalClaim)
    : { conflict: false, reason: "" };
  const numericConflict = numericConflictA.conflict
    ? numericConflictA
    : (numericConflictB.conflict ? numericConflictB : numericConflictA);
  if (numericConflict.conflict) {
    caveats.push(`VACCINE_BURNED_NUMERIC :: ${numericConflict.reason}`);
    return null;
  }
  // VERSION-GROUNDING GUARD (v2.122) — NEVER let a learned vaccine refute a TRUE
  // current-version self-claim ("Mneme is at version <installed>"). A vaccine
  // learned from a once-stale version claim over-generalises to the claim SHAPE
  // and would refute the correct version too; burn it when the cited version IS
  // the installed one, so the claim falls through to the forensic which grounds
  // it to TRUSTWORTHY. Additive + narrow: only ever removes a FALSE refutation,
  // never adds one (stale/future versions are NOT "current" and still refute).
  try {
    if (detectVersionSemantic(claim, repoRoot).classification === "current") {
      caveats.push("VACCINE_BURNED_VERSION_CURRENT");
      return null;
    }
  } catch { /* version parsing must never throw; fall through */ }
  // N3-OVERSHOOT GUARD (v2.19.44) — burn if a "refuted" tool now grounds live.
  const mentions = Array.from(claim.matchAll(/\bmneme\.[a-z_][a-z0-9_]*\.[a-z_][a-z0-9_]*\b/gi)).map((m) => m[0]);
  let nowGrounded = 0;
  if (mentions.length > 0) {
    try {
      const live = liveMnemeToolNames(repoRoot);
      for (const m of mentions) if (live.has(m.toLowerCase())) nowGrounded += 1;
    } catch { /* best-effort; if helper missing, fall through to old behaviour */ }
  }
  if (nowGrounded === 0) {
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
    } as ACGVResult;
  }
  caveats.push("OSMOSIS_VACCINE_BURNED");
  return null;
}

export function runACGV(input: ACGVRunInput): ACGVResult {
  const rawClaimUnsafe = input.claim ?? "";
  const repoRoot = input.repoRoot;
  const caveats: string[] = [];
  // A valid vaccine match short-circuits to AUTO_REFUTE in the Layer-0
  // fast-path below; if we reach the full pipeline the vaccine either didn't
  // match or was burned (stale), so the final result carries no vaccine match.
  const vaccineMatch: VaccineMatch | null = null;

  // ───── Layer -1a: INPUT HYGIENE (v2.40.0) ─────────────────────────────
  // Closes audit findings D4 (BIDI override), D6 (null byte mid-text), D8
  // (NFC/NFD denormalized) — none of which trip the 30%-printable floor
  // because one hostile codepoint in a 300-char claim stays well above it.
  //
  // BLOCK hazards (bidi_override / null_byte / tag_chars) short-circuit
  // to IMPOSSIBLE_REFUTE with INPUT_TAMPERED — the claim is structurally
  // hostile and refusing to evaluate it is the correct verdict.
  //
  // WARN hazards (zero_width / homoglyph_mix / denormalized_nfc) are
  // STRIPPED + NORMALIZED into a clean claim that downstream layers see;
  // the hazard surfaces as a caveat so the verdict carries the receipt.
  //
  // Pure deterministic, runs in <1ms on a 50KB input.
  const hygiene = checkInputHygiene(rawClaimUnsafe);
  if (hygiene.tampered) {
    if (!input.noEmitVaccine) {
      try { emitVaccine(repoRoot, rawClaimUnsafe, hygiene.vaccineSignature); } catch { /* best-effort */ }
    }
    const blockHazards = hygiene.hazards.filter((h) => h.severity === "BLOCK");
    const kinds = Array.from(new Set(blockHazards.map((h) => h.kind))).sort();
    const chandra: ChandrasekharResult = {
      verdict: "BLACK_HOLE", mass: 0, density: 0, rhoCritLow: 0, rhoCritHigh: 0,
      confidence: 0.98, citations: [],
      reasoning: `input hygiene blocked: ${kinds.join(", ")}`,
    } as ChandrasekharResult;
    const godel: GodelResult = {
      status: "UNSAT",
      core: blockHazards.map((h) => ({ asserted: h.evidence, proof: h.codepoints.slice(0, 4) })),
      certificate: blockHazards.map((h) => `${h.kind} :: ${h.codepoints.slice(0, 4).join(",")}`).join("\n"),
      upgrade: true,
    };
    return {
      verdict: "IMPOSSIBLE_REFUTE",
      confidence: 0.98,
      caveats: [`INPUT_TAMPERED:${kinds.join("+")}`],
      layers: {
        vaccineMatch: null,
        grounding: [],
        chandrasekhar: chandra,
        godel,
        confession: null,
        confessionRequest: null,
      },
      summary: `IMPOSSIBLE_REFUTE — input hygiene detected ${blockHazards.length} BLOCK-severity hazard(s): ${kinds.join(", ")}.`,
      reasoning: blockHazards.map((h) => `  - ${h.kind} (${h.severity}): ${h.evidence}\n    codepoints: ${h.codepoints.slice(0, 6).join(", ")}\n    positions: ${h.positions.slice(0, 6).join(", ")}`).join("\n"),
      vaccineEmitted: !input.noEmitVaccine,
    } as ACGVResult;
  }
  // WARN-only hazards: continue on the cleaned + NFC-normalized claim.
  const rawClaim = hygiene.normalizedClaim || rawClaimUnsafe;
  for (const h of hygiene.hazards) {
    if (h.severity === "WARN") {
      caveats.push(`INPUT_HYGIENE:${h.kind}`);
    }
  }

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

  // ───── Layer -0.5: NUMBER PARAPHRASE BRIDGE (v2.40.0) ─────────────────
  // Closes audit finding D5. The verifier used to see "865" + "eight
  // hundred sixty-five" + "0x361" + "๘๖๕" as 4 different tokens; vaccines
  // tagged for one form had zero effect on the others. Now we compute a
  // CANONICAL form where every recognized paraphrase is collapsed to its
  // decimal integer, and consult it ALONGSIDE the original. Vaccines emit
  // signatures from the canonical form so future paraphrases get caught
  // by simhash.
  const canonicalClaim = canonicalRewrite(claim);
  const canonicalNumbers = extractCanonicalNumbers(claim);
  const numberBridged = canonicalClaim !== claim;
  // v2.130.0 — CURRENT-VERSION ORDERING FIX: a claim that cites the INSTALLED
  // version ("Mneme is at version <installed>") is TRUE. Its only "numbers" are
  // the correct version digits, so the NUMBER_BRIDGE layer must NOT fire — its
  // caveat triggers demo.ts's layer-0 short-circuit, which blocks the forensic
  // layer (already ACCEPTED for the live version) from promoting the verdict to
  // TRUSTWORTHY. This produced the v28 spurious MIXED. Narrow + additive: only
  // suppresses number-bridge when the cited version EXACTLY equals the installed
  // one; historical / future / stale claims are untouched (still bridged + handled
  // by the version-semantic layer below). Version parsing must never throw.
  let isCurrentVersionClaim = false;
  try {
    const vsEarly = detectVersionSemantic(claim, repoRoot);
    isCurrentVersionClaim = vsEarly.matched && vsEarly.classification === "current";
  } catch { /* leave false */ }
  if (numberBridged && !isCurrentVersionClaim) {
    caveats.push(`NUMBER_BRIDGE:${canonicalNumbers.length}_canonicalized`);
  }
  // v2.44.0 — AUTO-NUMBER-GROUNDING: when claim has "Mneme has N <noun>"
  // shape AND we can resolve a live count, return an explicit verdict
  // instead of letting NUMBER_BRIDGE end as a caveat. Turns informational
  // caveat into actionable REFUTED/SUPPORTED.
  if (numberBridged || canonicalNumbers.length > 0) {
    try {
      const grounded = tryAutoGroundNumber(claim, repoRoot);
      if (grounded.grounded && grounded.verdict === "REFUTED") {
        const sig = `AUTO_NUMBER_REFUTE :: ${grounded.noun}=${grounded.claimedValue} vs actual=${grounded.expected}`;
        if (!input.noEmitVaccine) {
          try { emitVaccine(repoRoot, claim, sig); } catch { /* best-effort */ }
        }
        return {
          verdict: "IMPOSSIBLE_REFUTE",
          confidence: 0.95,
          caveats: [...caveats, `AUTO_NUMBER_REFUTE:${grounded.noun}=${grounded.claimedValue}vs${grounded.expected}`],
          layers: {
            vaccineMatch: null,
            grounding: [],
            chandrasekhar: {
              verdict: "BLACK_HOLE", mass: 0, density: 0, rhoCritLow: 0, rhoCritHigh: 0,
              confidence: 0.95, citations: [],
              reasoning: grounded.evidence ?? sig,
            } as ChandrasekharResult,
            godel: {
              status: "UNSAT",
              core: [{ asserted: `${grounded.noun}=${grounded.claimedValue}`, proof: [`live count=${grounded.expected}`] }],
              certificate: sig,
              upgrade: true,
            },
            confession: null,
            confessionRequest: null,
          },
          summary: `AUTO_NUMBER_REFUTE — claim says ${grounded.claimedValue} ${grounded.noun}; live count is ${grounded.expected}.`,
          reasoning: grounded.evidence ?? sig,
          vaccineEmitted: !input.noEmitVaccine,
        } as ACGVResult;
      }
      // Soft support (within tolerance) → FUSION with caveat
      if (grounded.grounded && grounded.verdict === "SUPPORTED") {
        return {
          verdict: "FUSION",
          confidence: 0.88,
          caveats: [...caveats, `AUTO_NUMBER_SUPPORT:${grounded.noun}=${grounded.claimedValue}~${grounded.expected}`],
          layers: {
            vaccineMatch: null,
            grounding: [],
            chandrasekhar: {
              verdict: "FUSION", mass: 0, density: 0, rhoCritLow: 0, rhoCritHigh: 0,
              confidence: 0.88, citations: [],
              reasoning: grounded.evidence ?? "",
            } as ChandrasekharResult,
            godel: { status: "SKIPPED", core: [], certificate: "", upgrade: false },
            confession: null,
            confessionRequest: null,
          },
          summary: `AUTO_NUMBER_SUPPORT — claim's ${grounded.claimedValue} ${grounded.noun} matches live count ${grounded.expected}.`,
          reasoning: grounded.evidence ?? "",
          vaccineEmitted: false,
        } as ACGVResult;
      }
    } catch { /* best-effort; fall through to standard pipeline */ }
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

  // ───── Layer 0a2: META-SELF-VERIFIER (v2.42.0) ────────────────────────
  // Closes R1 (audit "Mneme verify self-claim returned IMPOSSIBLE for 17
  // versions"). The pre-v2.42 self-reference detector ate ALL Mneme-
  // mentions-Mneme inputs as paradox. But "Mneme is a CLI tool" is a
  // CHECKABLE FACT, not a paradox. The meta-verifier routes self-claims
  // to a TRUE/FALSE corpus of atomic Mneme capability shapes — strong
  // match → SUPPORTED / REFUTED (with citation); no match → fall through
  // to the paradox layer.
  const msv = metaSelfVerify(claim);
  if (msv.matched && (msv.verdict === "SUPPORTED" || msv.verdict === "REFUTED")) {
    // v2.114 — learned-vaccine fast path for SELF-claims only. A self-claim
    // that was refuted+vaccinated before short-circuits to AUTO_REFUTE in
    // microseconds (the "2nd call is instant" guarantee) WITHOUT preempting the
    // structural detectors (hyperbole / self-reference / paradox) that run
    // before this block — those keep precedence for non-self claims. The
    // full-pipeline vaccine check (below, for everything else) is unchanged.
    {
      const vax = tryVaccineAutoRefute(repoRoot, claim, canonicalClaim, numberBridged, caveats);
      if (vax) return vax;
    }
    const isRefuted = msv.verdict === "REFUTED";
    const chandra: ChandrasekharResult = {
      verdict: isRefuted ? "BLACK_HOLE" : "FUSION",
      mass: 0, density: 0, rhoCritLow: 0, rhoCritHigh: 0,
      confidence: msv.confidence,
      citations: [],
      reasoning: msv.evidence,
    } as ChandrasekharResult;
    const godel: GodelResult = {
      status: isRefuted ? "UNSAT" : "SKIPPED",
      core: isRefuted ? [{ asserted: msv.evidence, proof: [msv.closestFalse?.text ?? ""] }] : [],
      certificate: msv.evidence,
      // A refuted self-claim has a real UNSAT proof (chandra collapse + godel
      // contradiction against the capability corpus) — that IS the upgrade.
      upgrade: isRefuted,
    };
    if (isRefuted && !input.noEmitVaccine) {
      try { emitVaccine(repoRoot, claim, `META_SELF_REFUTE :: ${msv.closestFalse?.text}`); } catch { /* best-effort */ }
    }
    // v2.114 — PRTF second witness on the fast-path. There is no neutrino
    // grounding here (the meta-verifier matched the capability corpus
    // directly), so PRTF carries no signal — we still emit the layer + an
    // honest PRTF_NO_GROUNDING caveat rather than omit the second witness.
    const metaPrtf = primeResonance([]);
    return {
      // v2.114 — taxonomy: chandra BLACK_HOLE + godel UNSAT = IMPOSSIBLE_REFUTE
      // (the strongest refutation), NOT a bare BLACK_HOLE. A refuted self-claim
      // about Mneme has BOTH signals, so it is impossible-refuted.
      verdict: isRefuted ? "IMPOSSIBLE_REFUTE" : "FUSION",
      confidence: msv.confidence,
      // v2.113 — when a self-claim is REFUTED the chandrasekhar layer has
      // collapsed (verdict BLACK_HOLE) and godel is UNSAT; surface those
      // signals as caveats too (not only META_SELF_VERIFIED), so the caveat
      // list honestly reflects every layer that fired.
      caveats: isRefuted
        ? [...caveats, `META_SELF_VERIFIED:${msv.verdict}`, CAVEAT_TAGS.BLACK_HOLE, CAVEAT_TAGS.IMPOSSIBLE, "PRTF_NO_GROUNDING"]
        : [...caveats, `META_SELF_VERIFIED:${msv.verdict}`, "PRTF_NO_GROUNDING"],
      layers: {
        vaccineMatch: null,
        grounding: [],
        chandrasekhar: chandra,
        godel,
        prtf: metaPrtf,
        confession: null,
        confessionRequest: null,
      },
      summary: isRefuted
        ? `META_SELF_REFUTE — self-claim about Mneme contradicts known capability: ${msv.evidence}`
        : `META_SELF_SUPPORT — self-claim about Mneme matches known capability: ${msv.evidence}`,
      reasoning: `${msv.evidence}\nCorpus matches:\n  TRUE:  ${msv.closestTrue?.text ?? "(none above threshold)"}\n  FALSE: ${msv.closestFalse?.text ?? "(none above threshold)"}`,
      vaccineEmitted: isRefuted && !input.noEmitVaccine,
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

  // ───── Layer 0d: VERSION-SEMANTIC DETECTOR (v2.36.0) ──────────────────
  // Closes audit-card bug #1 — when a claim cites a Mneme version
  // OLDER than installed, refuting it against the current state is a
  // category error (the claim is historical). Now we surface
  // HISTORICAL_CLAIM caveat + PASSTHROUGH with calibrated confidence
  // instead of REFUTED 57%.
  //
  // Pure-defensive — version parsing failures fall through to no-op.
  const versionSem = detectVersionSemantic(claim, repoRoot);
  if (versionSem.matched && versionSem.classification === "historical") {
    const chandra: ChandrasekharResult = {
      verdict: "UNKNOWN_MASS", mass: 0, density: 0, rhoCritLow: 0, rhoCritHigh: 0,
      confidence: 0.60, citations: [],
      reasoning: versionSem.reason,
    } as ChandrasekharResult;
    const godel: GodelResult = { status: "SKIPPED", core: [], certificate: "", upgrade: false };
    return {
      verdict: "PASSTHROUGH",
      confidence: 0.60,
      caveats: [...caveats, `HISTORICAL_CLAIM:v${versionSem.matches[0]!.major}.${versionSem.matches[0]!.minor}.${versionSem.matches[0]!.patch} vs installed v${versionSem.installedVersion}`],
      layers: {
        vaccineMatch: null,
        grounding: [],
        chandrasekhar: chandra,
        godel,
        confession: null,
        confessionRequest: null,
      },
      summary: `HISTORICAL_CLAIM — claim cites v${versionSem.matches[0]!.major}.${versionSem.matches[0]!.minor}.${versionSem.matches[0]!.patch} (PAST); installed is v${versionSem.installedVersion}. Refuting against current state is a category error.`,
      reasoning: `${versionSem.reason}\n\nThe claim describes behavior from a past version of Mneme. The CURRENT state of the repo may or may not match — that's not what the claim asserts. To verify a historical claim, run \`git checkout v${versionSem.matches[0]!.major}.${versionSem.matches[0]!.minor}.${versionSem.matches[0]!.patch}\` first, or restate the claim in present tense ("does Mneme currently X").`,
      vaccineEmitted: false,
    } as ACGVResult;
  }
  if (versionSem.matched && versionSem.classification === "future") {
    const chandra: ChandrasekharResult = {
      verdict: "UNKNOWN_MASS", mass: 0, density: 0, rhoCritLow: 0, rhoCritHigh: 0,
      confidence: 0.20, citations: [],
      reasoning: versionSem.reason,
    } as ChandrasekharResult;
    const godel: GodelResult = { status: "SKIPPED", core: [], certificate: "", upgrade: false };
    return {
      verdict: "PASSTHROUGH",
      confidence: 0.20,
      caveats: [...caveats, `FUTURE_VERSION_CLAIM:v${versionSem.matches[0]!.major}.${versionSem.matches[0]!.minor}.${versionSem.matches[0]!.patch} vs installed v${versionSem.installedVersion}`],
      layers: {
        vaccineMatch: null,
        grounding: [],
        chandrasekhar: chandra,
        godel,
        confession: null,
        confessionRequest: null,
      },
      summary: `FUTURE_VERSION_CLAIM — claim cites v${versionSem.matches[0]!.major}.${versionSem.matches[0]!.minor}.${versionSem.matches[0]!.patch} but installed is v${versionSem.installedVersion}. Cannot verify state that doesn't exist yet.`,
      reasoning: versionSem.reason,
      vaccineEmitted: false,
    } as ACGVResult;
  }
  // v2.123 — CURRENT version: the claim cites the INSTALLED version, so it is
  // TRUE. Previously there was no "current" branch, so the claim fell through to
  // harmonic/Chandrasekhar grounding and COLLAPSED to BLACK_HOLE (a bare version
  // number has no harmonic mass). Return PASSTHROUGH (weak) so the forensic
  // layer — which grounds the version against package.json + ACCEPTS it — drives
  // the final verdict to TRUSTWORTHY. Never refute the install's own version.
  if (versionSem.matched && versionSem.classification === "current") {
    const chandra: ChandrasekharResult = {
      verdict: "UNKNOWN_MASS", mass: 0, density: 0, rhoCritLow: 0, rhoCritHigh: 0,
      confidence: 0.90, citations: [],
      reasoning: versionSem.reason,
    } as ChandrasekharResult;
    const godel: GodelResult = { status: "SKIPPED", core: [], certificate: "", upgrade: false };
    return {
      verdict: "PASSTHROUGH",
      confidence: 0.90,
      caveats: [...caveats, `CURRENT_VERSION_CONFIRMED:v${versionSem.installedVersion}`],
      layers: {
        vaccineMatch: null,
        grounding: [],
        chandrasekhar: chandra,
        godel,
        confession: null,
        confessionRequest: null,
      },
      summary: `CURRENT_VERSION_CONFIRMED — claim cites the installed version v${versionSem.installedVersion}; grounded by the forensic layer against package.json.`,
      reasoning: versionSem.reason,
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

  // ───── Layer 0: VACCINE CHECK (learned fast-path) ─────────────────────
  // For non-self / non-structural claims: a known lie-shape refuted before
  // short-circuits to AUTO_REFUTE. Runs AFTER the structural detectors
  // (hyperbole / self-reference / paradox / version / commit-hash) so those
  // authoritative, claim-specific verdicts keep precedence; stale matches are
  // burned inside (numeric-conflict + live-catalog re-check).
  {
    const vaxResult = tryVaccineAutoRefute(repoRoot, claim, canonicalClaim, numberBridged, caveats);
    if (vaxResult) return vaxResult;
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
  // v2.40.0 D5 fix: also emit a vaccine for the canonical-number form so
  // future paraphrases of the same numeric lie ("0x361" / "eight hundred
  // sixty-five" / "๘๖๕") fire AUTO_REFUTE via simhash on the canonical
  // form. Both vaccines carry the same signature so the ledger stays
  // coherent.
  let vaccineEmitted = false;
  if (!input.noEmitVaccine && (verdict === "IMPOSSIBLE_REFUTE" || verdict === "BLACK_HOLE")) {
    const sig = `${verdict} :: ` + chandra.citations
      .filter((c) => c.verdict === "false")
      .map((c) => c.asserted)
      .join(" + ");
    emitVaccine(repoRoot, claim, sig || verdict);
    if (numberBridged && canonicalClaim !== claim) {
      try { emitVaccine(repoRoot, canonicalClaim, `${sig || verdict} :: canonical_number_form`); } catch { /* best-effort */ }
    }
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
