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
import { noteBotOutcome } from "./acgv_stake.js";

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
  if (prelim.verdict === "PASSTHROUGH" || prelim.verdict === "AUTO_REFUTE" || prelim.verdict === "FUSION") {
    // No need for Z3 upgrade -- propositional already conclusive (or
    // there's nothing to prove against).
    return { ...prelim, engine: "propositional" };
  }

  // Re-run Godel with Z3 over the same grounding + Chandrasekhar.
  const z3Godel = await godelPostMortemZ3(prelim.layers.chandrasekhar, prelim.layers.grounding);
  const upgraded = z3Godel.upgrade && prelim.verdict !== "IMPOSSIBLE_REFUTE";

  // Decide final verdict considering Z3 outcome.
  const finalResult: ACGVResult = upgraded
    ? {
        ...prelim,
        verdict: "IMPOSSIBLE_REFUTE",
        confidence: 0.99,
        caveats: [...prelim.caveats, "Z3_UNSAT_PROOF"].filter((c, i, a) => a.indexOf(c) === i),
        layers: { ...prelim.layers, godel: z3Godel },
        summary: `IMPOSSIBLE_REFUTE -- Z3 SAT solver returned UNSAT for the compound claim. ${prelim.summary}`,
        reasoning: `${prelim.reasoning}\n\n${z3Godel.certificate}`,
      }
    : { ...prelim, layers: { ...prelim.layers, godel: z3Godel } };

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

export function runACGV(input: ACGVRunInput): ACGVResult {
  const claim = (input.claim ?? "").trim();
  const repoRoot = input.repoRoot;
  const caveats: string[] = [];

  // ───── Layer 0: VACCINE CHECK ─────────────────────────────────────────
  const vaccineMatch = checkAgainstVaccines(repoRoot, claim);
  if (vaccineMatch && vaccineMatch.matched) {
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
      confession,
      confessionRequest,
    },
    summary,
    reasoning,
    vaccineEmitted,
  };
}
