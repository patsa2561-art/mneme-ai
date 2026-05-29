/**
 * v2.92.0 — 💎⑦ DIAKRISIS · discern the genuine from the merely-plausible.
 *
 * διάκρισις — "discernment / judging-apart": telling the real from the counterfeit.
 * A SECOND axis, orthogonal to Aletheia. Aletheia judges true vs false; Diakrisis
 * judges genuine vs merely-good-looking — a mediocre artifact is not FALSE, it is
 * UNREMARKABLE. When AI commoditises both execution and ideas, the bottleneck moves
 * to DISCERNMENT: telling what is genuinely good from what merely LOOKS good. AI
 * produces "looks good" without limit — that flood is product-level hallucination.
 *
 * THE HONEST SCOPE (this IS the design, read it first). Diakrisis is ASYMMETRIC: it
 * proves what is NOT world-class far more reliably than what IS. It does NOT
 * mechanise taste. Its verdict mirrors Prove-or-Unknown →
 *
 *     Reject-or-Unknown: confidently REJECT the high-lustre / PROVEN-low-substance
 *     trap; for everything else return UNKNOWN — "passes the floor; the ceiling is
 *     the human's."
 *
 * It RAISES THE FLOOR (kills the plausible-mediocre flood) and AUGMENTS THE CEILING
 * (surfaces undervalued substance for a human). It never claims to BE the ceiling —
 * any version that scored "world-class greatness" would itself be the lustre-trap
 * this axis exists to catch.
 *
 * Three pillars, with the failure modes welded in as guards:
 *  1. LUSTRE–SUBSTANCE GAP — score lustre (how good it LOOKS) from STRUCTURAL signals
 *     (xray hedge-vs-absolute, hyperbole detector), NEVER by asking an LLM "is this
 *     good?" (that re-imports the correlated plausibility bias). Substance (how good
 *     it IS) only where verifiable; aesthetic quality ⇒ UNKNOWN (abstain, never fake).
 *  2. TASTE = signed revealed-preference — learn from what SURVIVED reality (kept vs
 *     reverted/rolled-back), supplied as evidence; empirical, immune to plausibility.
 *  3. ANTI-CONSERVATISM GUARD (the Padgett guard) — REJECT only on PROVEN low
 *     substance; NEVER on "doesn't match past taste." Novel-but-unproven ⇒ UNKNOWN,
 *     routed to the human, never auto-rejected. (A Padgett — correct in a notation
 *     the teachers don't recognise — must return UNKNOWN, never REJECT.)
 *
 * Composes xray + hyperbole_detector + the v2.88 spine + notary. Never throws.
 */

import { xrayResponse } from "../xray/index.js";
import { detectHyperbole } from "../squadron/hyperbole_detector.js";
import { humilityDensity } from "../apoptosis/epistemic_humility.js";
import { issueReceipt, type NotaryReceipt } from "../notary/index.js";

export type DiakrisisVerdict = "REJECT" | "UNKNOWN";
export type Substance = "HIGH" | "LOW" | "UNKNOWN";
export type Classification = "TRAP" | "PROVEN_WEAK" | "GEM" | "PROVEN_GOOD" | "PLAUSIBLE_CAVEAT" | "PLAUSIBLE";

const clamp01 = (x: number): number => Math.max(0, Math.min(1, x));

export interface LustreSignals {
  /** 0..1 — how good it LOOKS, from structural signals only (never an LLM opinion). */
  lustre: number;
  hyperboleMatches: number;
  absoluteDensity: number;
  hedgeDensity: number;
  /** The structural signals that drove the score (audit trail). */
  drivers: string[];
}

/**
 * Score LUSTRE from STRUCTURAL signals only — hyperbole (superlatives / "best ever"),
 * absolutist phrasing (sounds certain), minus hedging (sounds tentative). NEVER asks
 * an LLM "is this good?" — that would re-import the same plausibility bias the gap is
 * built to expose. Deterministic + total.
 */
export function lustreScore(text: string): LustreSignals {
  const t = String(text ?? "");
  const hyp = detectHyperbole(t);
  const hum = humilityDensity(t);
  void xrayResponse; // xray is available for richer structural signals; hyperbole+absolutism suffice + stay lustre-pure
  const drivers: string[] = [];
  const hyperboleComponent = Math.min(0.5, hyp.matches.length * 0.2);
  const absolutismComponent = Math.min(0.4, (hum.absoluteDensity / 100) * 8);
  const hedgeDiscount = Math.min(0.25, (hum.hedgeDensity / 100) * 5);
  if (hyp.matches.length) drivers.push(`hyperbole×${hyp.matches.length} (${hyp.matches.slice(0, 3).map((m) => m.matched).join(", ")})`);
  if (hum.absoluteDensity > 0) drivers.push(`absolutist phrasing (${hum.absoluteDensity.toFixed(1)}/100w)`);
  if (hum.hedgeDensity > 0) drivers.push(`hedged (${hum.hedgeDensity.toFixed(1)}/100w) ↓lustre`);
  const lustre = clamp01(hyperboleComponent + absolutismComponent - hedgeDiscount);
  return { lustre, hyperboleMatches: hyp.matches.length, absoluteDensity: hum.absoluteDensity, hedgeDensity: hum.hedgeDensity, drivers };
}

/** Caller-supplied revealed-preference / verification evidence — the ONLY way
 *  substance becomes PROVEN (Pillar 2 + 3). A daemon feeds these from reflog
 *  (kept vs reverted), outcome_market, karma, or a real test run. */
export interface SubstanceEvidence {
  /** Was this artifact reverted / rolled back / deleted? (revealed-preference: it did NOT survive.) */
  reverted?: boolean;
  /** Did its tests pass? false ⇒ proven low substance; true ⇒ proven survived. */
  testPassed?: boolean;
  /** A pre-computed truth verdict (e.g. from assertClaim) for a factual artifact. */
  verdict?: "TRUE" | "FALSE" | "UNKNOWN";
}

export interface DiakrisisResult {
  /** REJECT (proven low substance — the Courage Gate fires) | UNKNOWN (ceiling is the human's). */
  verdict: DiakrisisVerdict;
  /** Cleared the floor (no PROVEN low substance). True for everything we don't REJECT. */
  flooredPass: boolean;
  /** Lustre − substanceScore (the primary signal). High + proven-low = the 🪤 trap. */
  gap: number;
  lustre: number;
  substance: Substance;
  /** The 2×2 quadrant (advisory, for the human). */
  classification: Classification;
  /** True when we ABSTAINED on novel/unproven work instead of rejecting (Padgett guard active). */
  padgettGuard: boolean;
  reason: string;
  /** Always present — Diakrisis never claims the ceiling. */
  ceiling: string;
  lustreSignals: LustreSignals;
  receipt: NotaryReceipt | null;
}

const CEILING = "passes the floor — world-class taste is the human's call (Diakrisis does not score the ceiling)";

function substanceScoreOf(s: Substance): number { return s === "HIGH" ? 1 : s === "LOW" ? 0 : 0.5; }

/** Lustre ≥ this reads as "high shine" (hyperbolic / absolutist presentation). Tuned
 *  to ~2 hyperbole matches + some absolutism — the level at which a flood of polished
 *  output starts to look impressive without earning it. */
export const HIGH_LUSTRE = 0.35;

function classify(lustre: number, substance: Substance): Classification {
  const lustHi = lustre >= HIGH_LUSTRE;
  if (substance === "LOW") return lustHi ? "TRAP" : "PROVEN_WEAK";
  if (substance === "HIGH") return lustHi ? "PROVEN_GOOD" : "GEM";
  return lustHi ? "PLAUSIBLE_CAVEAT" : "PLAUSIBLE";
}

/**
 * Discern an artifact. Lustre is structural (never an LLM opinion). Substance is
 * PROVEN only via evidence (test/revert) or a verifiable truth verdict; otherwise
 * UNKNOWN. REJECT fires ONLY on PROVEN-low substance (Courage Gate); novel/unproven
 * work is UNKNOWN and routed to the human (Padgett guard) — NEVER auto-rejected.
 * Never throws.
 */
export async function discern(
  repoRoot: string,
  artifact: string,
  opts: { substanceEvidence?: SubstanceEvidence; now?: number; noSign?: boolean; verifyClaim?: boolean } = {},
): Promise<DiakrisisResult> {
  const text = String(artifact ?? "");
  const lustreSignals = lustreScore(text);
  const lustre = lustreSignals.lustre;

  // Substance: PROVEN only from evidence; never invented.
  let substance: Substance = "UNKNOWN";
  let substReason = "no verifiable substance — aesthetic/quality is UNKNOWN (ceiling = human)";
  const ev = opts.substanceEvidence ?? {};
  if (ev.reverted === true) { substance = "LOW"; substReason = "revealed-preference: reverted/rolled back — did NOT survive"; }
  else if (ev.testPassed === false) { substance = "LOW"; substReason = "tests FAILED — proven low substance"; }
  else if (ev.testPassed === true) { substance = "HIGH"; substReason = "tests passed — survived verification"; }
  else if (ev.verdict) {
    substance = ev.verdict === "TRUE" ? "HIGH" : ev.verdict === "FALSE" ? "LOW" : "UNKNOWN";
    substReason = `truth verdict ${ev.verdict}`;
  } else if (opts.verifyClaim) {
    // Optional: treat the artifact as a factual claim + verify via the spine.
    try {
      const { assertClaim } = await import("./aletheia.js");
      const r = await assertClaim(repoRoot, text, { issuedAt: opts.now });
      substance = r.verdict === "TRUE" ? "HIGH" : r.verdict === "FALSE" ? "LOW" : "UNKNOWN";
      substReason = `spine verdict ${r.verdict}: ${r.evidence}`;
    } catch { /* stays UNKNOWN — abstain */ }
  }

  // Reject-or-Unknown + Courage Gate + Padgett guard:
  // REJECT only when substance is PROVEN LOW. Everything else = UNKNOWN (ceiling = human).
  const verdict: DiakrisisVerdict = substance === "LOW" ? "REJECT" : "UNKNOWN";
  const flooredPass = substance !== "LOW";
  const padgettGuard = substance === "UNKNOWN"; // we abstained rather than reject the unproven (incl. the novel)
  const classification = classify(lustre, substance);
  const gap = +(lustre - substanceScoreOf(substance)).toFixed(3);

  const reason =
    verdict === "REJECT"
      ? (classification === "TRAP"
          ? `🪤 TRAP — high lustre (${lustre.toFixed(2)}) over PROVEN-low substance: ${substReason}`
          : `proven low substance: ${substReason}`)
      : classification === "GEM"
        ? `⛏ GEM — low lustre (${lustre.toFixed(2)}) but PROVEN-high substance: surface for the human`
        : classification === "PLAUSIBLE_CAVEAT"
          ? `high lustre (${lustre.toFixed(2)}) but UNVERIFIED — plausible, not proven excellent (caveat emptor; ${substReason})`
          : `plausible — not proven excellent; ${substReason}`;

  let receipt: NotaryReceipt | null = null;
  if (!opts.noSign) {
    try {
      receipt = issueReceipt(repoRoot, {
        kind: "generic",
        subject: `diakrisis:${classification}`,
        payload: { engine: "diakrisis", verdict, classification, lustre, substance, gap },
        issuedAt: opts.now,
      });
    } catch { receipt = null; }
  }

  return { verdict, flooredPass, gap, lustre, substance, classification, padgettGuard, reason, ceiling: CEILING, lustreSignals, receipt };
}

// ── The Diakrisis Gauntlet (falsifiable — and honestly bounded) ───────────
export interface DiscernCase {
  artifact: string;
  evidence?: SubstanceEvidence;
  /** Ground-truth label for scoring. */
  kind: "trap" | "gem" | "novel" | "genuine";
}

export interface DiakrisisGauntletReport {
  n: number;
  /** High-lustre + PROVEN-low-substance traps correctly REJECTed. ↑ good. */
  trapCatchRate: number;
  /** Genuine-but-unproven-NOVEL artifacts wrongly REJECTed. MUST be 0 — the Padgett guard. */
  novelFalseRejectRate: number;
  /** Low-lustre + high-substance gems flagged (classification GEM) for the human. */
  gemSurfacingRate: number;
  results: Array<{ artifact: string; kind: DiscernCase["kind"]; verdict: DiakrisisVerdict; classification: Classification }>;
  headline: string;
  /** Deliberately NO "world-class-recognition rate" — claiming one would be lustre. */
}

/** Run the Diakrisis Gauntlet. The metric that matters most is novelFalseRejectRate → 0
 *  (a savant that would discard a Padgett is broken). Never throws. */
export async function runDiakrisisGauntlet(repoRoot: string, cases: readonly DiscernCase[], opts: { now?: number } = {}): Promise<DiakrisisGauntletReport> {
  const results: DiakrisisGauntletReport["results"] = [];
  let traps = 0, trapsCaught = 0, novels = 0, novelsRejected = 0, gems = 0, gemsSurfaced = 0;
  for (const c of cases) {
    const r = await discern(repoRoot, c.artifact, { substanceEvidence: c.evidence, now: opts.now, noSign: true });
    results.push({ artifact: c.artifact.slice(0, 60), kind: c.kind, verdict: r.verdict, classification: r.classification });
    if (c.kind === "trap") { traps++; if (r.verdict === "REJECT") trapsCaught++; }
    if (c.kind === "novel") { novels++; if (r.verdict === "REJECT") novelsRejected++; }
    if (c.kind === "gem") { gems++; if (r.classification === "GEM") gemsSurfaced++; }
  }
  const trapCatchRate = traps ? trapsCaught / traps : 1;
  const novelFalseRejectRate = novels ? novelsRejected / novels : 0;
  const gemSurfacingRate = gems ? gemsSurfaced / gems : 1;
  const headline = `DIAKRISIS GAUNTLET · trap-catch ${(trapCatchRate * 100).toFixed(0)}% · novel-false-reject ${(novelFalseRejectRate * 100).toFixed(0)}% (Padgett: must be 0) · gem-surfacing ${(gemSurfacingRate * 100).toFixed(0)}% (n=${cases.length})`;
  return { n: cases.length, trapCatchRate, novelFalseRejectRate, gemSurfacingRate, results, headline };
}
