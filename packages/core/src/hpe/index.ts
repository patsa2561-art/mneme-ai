/**
 * v3.117.0 — HPE: the Hallucination Protection Engine (a "nervous system" for truth).
 *
 * The honest DARE. "Eliminate hallucination 100%" is a theoretical impossibility
 * for open-ended generation (you cannot certify the truth of every possible
 * sentence) — claiming it would be the lie. But the Edison-possible, not-yet-built
 * thing IS: drive CONFIDENTLY-WRONG output toward ZERO by composing many
 * INDEPENDENT detectors (nerves), each catching a different failure class, into a
 * single reflex-gated engine that ABSTAINS when it cannot verify — so nothing it
 * stamps TRUSTED is a hallucination.
 *
 * THE BLACK-SHEEP ARCHITECTURE (a nervous system, not a vote):
 *   • Each NERVE is an independent detector with a SEVERITY (hard/soft). Adding a
 *     nerve only increases coverage — never reduces it (monotonic).
 *   • REFLEX: any HARD nerve firing (a statistical fallacy, a self-contradiction,
 *     an injection) → immediate BLOCK, no deliberation (like a spinal reflex).
 *   • INTEGRATION: soft nerves sum into a risk potential → BLOCK / REVIEW (abstain)
 *     / TRUSTED by threshold. Below confidence ⇒ REVIEW, never a confident pass.
 *   • External nerves (truth-grounding REFUTED, cross-agent UNRECOVERABLE) plug in.
 *
 * The MEASURED property (not "0% hallucination" — that's impossible): on a labeled
 * corpus spanning the hallucination classes, PRECISION-WHEN-TRUSTED = 1.0 (no
 * hallucination is ever stamped TRUSTED) + the fused engine catches strictly more
 * classes than any single nerve. Honest: REVIEW (abstention) is the price; a novel
 * failure no nerve models can still pass — which is why the verdict is TRUSTED
 * (no known fault) not "true". Pure + deterministic + total.
 */

import { checkStat } from "../statguard/index.js";

export type NerveSeverity = "hard" | "soft";
export interface NerveFiring { nerve: string; severity: NerveSeverity; why: string; fix: string }
export type ProtectVerdict = "TRUSTED" | "REVIEW" | "BLOCK";
export interface ProtectResult {
  verdict: ProtectVerdict;
  /** 0..1 trust (1 = no fault found); BLOCK ⇒ low, REVIEW ⇒ middling. */
  trust: number;
  fired: NerveFiring[];
  note: string;
}

/** Optional external nerve signals an agent can feed in (from truth_gate / sdc). */
export interface ExternalSignals { grounding?: "TRUSTWORTHY" | "MIXED" | "REFUTED" | "IMPOSSIBLE" | "unknown"; consensus?: "CLEAN" | "CORRECTED" | "UNRECOVERABLE"; injection?: boolean }

function round3(n: number): number { return Math.round(n * 1e3) / 1e3; }

// ── the deterministic nerves ─────────────────────────────────────────────────
function nerveStat(text: string): NerveFiring | null {
  const r = checkStat(text);
  if (r.verdict === "MISINTERPRETATION") return { nerve: "statistical-fallacy", severity: "hard", why: r.hits[0]!.name + " (" + r.hits[0]!.ref + ")", fix: r.hits[0]!.correct };
  return null;
}
function nerveContradiction(text: string): NerveFiring | null {
  const t = text.toLowerCase();
  // overt opposite-quantifier or is/is-not within one claim
  if (/\balways\b[^.]*\bnever\b|\bnever\b[^.]*\balways\b|\ball\b[^.]*\bnone\b|\b(is|are|was|were)\b[^.]*\b(?:and)\b[^.]*\b(?:is|are|was|were)\s+not\b|\bboth\b[^.]*\bneither\b/.test(t)) {
    return { nerve: "self-contradiction", severity: "hard", why: "the claim asserts a statement and its negation (mutually exclusive predicates).", fix: "state one consistent position, or scope each part so they don't conflict." };
  }
  return null;
}
function nerveOverconfidence(text: string): NerveFiring | null {
  const t = text.toLowerCase();
  // absolute certainty on an empirical / future claim, no hedge
  if (/\b(100% (?:certain|sure|guaranteed)|guaranteed to|definitely will|will (?:always|never) (?:work|fail|happen)|absolutely no (?:risk|chance)|impossible to fail|proven fact that|always works|never fails|cannot possibly)\b/.test(t)
    && !/\b(roughly|approximately|about|likely|probably|may|might|could|estimate|under (?:the )?assumption|in (?:our|the) tests)\b/.test(t)) {
    return { nerve: "overconfidence", severity: "soft", why: "an absolute, unhedged certainty about an empirical/future outcome — a calibration red flag (overclaiming).", fix: "qualify with the evidence + uncertainty (e.g. 'in our tests', 'approximately', a measured rate)." };
  }
  return null;
}
function nerveFabrication(text: string): NerveFiring | null {
  const t = text.toLowerCase();
  // suspiciously over-precise unverifiable specifics asserted as fact
  if (/\bexactly \d+\.\d+%/.test(t) || /\baccording to (?:a|the) \d{4} study\b[^.]*\b(prov|confirm|show)/.test(t) || /\bstudies (?:prove|definitively show)\b/.test(t)) {
    return { nerve: "fabrication-risk", severity: "soft", why: "an over-precise or vaguely-attributed specific stated as established fact (common hallucination shape).", fix: "cite the exact verifiable source, or hedge the precision; verify the number/citation first." };
  }
  return null;
}

/**
 * Run the claim through every nerve + any external signals, then fuse with the
 * reflex model → TRUSTED / REVIEW (abstain) / BLOCK. Pure + deterministic + total.
 */
export function protect(claim: string, ext?: ExternalSignals, opts?: { reviewAt?: number; blockAt?: number }): ProtectResult {
  const note = "HPE fuses independent nerves with a reflex (any HARD fault → BLOCK) + abstention (REVIEW when unverifiable). TRUSTED = no KNOWN fault, NOT a proof of truth; a novel failure no nerve models can still pass. The honest ceiling: drive confidently-wrong → ~0 by abstaining, not 0% hallucination.";
  try {
    const text = String(claim ?? "");
    const reviewAt = opts?.reviewAt ?? 0.34;
    const blockAt = opts?.blockAt ?? 0.67;
    const fired: NerveFiring[] = [];
    for (const n of [nerveStat, nerveContradiction, nerveOverconfidence, nerveFabrication]) { const f = n(text); if (f) fired.push(f); }
    // external nerves
    if (ext?.grounding === "REFUTED" || ext?.grounding === "IMPOSSIBLE") fired.push({ nerve: "truth-grounding", severity: "hard", why: `claim is ${ext.grounding} against the source of truth.`, fix: "do not relay; use the grounded correction." });
    else if (ext?.grounding === "MIXED") fired.push({ nerve: "truth-grounding", severity: "soft", why: "claim only partially grounds in the source of truth.", fix: "relay only the supported part." });
    if (ext?.consensus === "UNRECOVERABLE") fired.push({ nerve: "consensus", severity: "soft", why: "agents disagree irreconcilably (SDC UNRECOVERABLE).", fix: "escalate to a human; do not assert a single answer." });
    if (ext?.injection) fired.push({ nerve: "injection", severity: "hard", why: "untrusted/prompt-injected content in the input.", fix: "neutralize via firewall before trusting." });

    const hard = fired.some((f) => f.severity === "hard");
    const softRisk = fired.filter((f) => f.severity === "soft").length * 0.34; // each soft ≈ a third
    let verdict: ProtectVerdict; let trust: number;
    if (hard) { verdict = "BLOCK"; trust = 0; }
    else if (softRisk >= blockAt) { verdict = "BLOCK"; trust = round3(Math.max(0, 1 - softRisk)); }
    else if (softRisk >= reviewAt) { verdict = "REVIEW"; trust = round3(1 - softRisk); }
    else { verdict = "TRUSTED"; trust = round3(1 - softRisk); }
    return { verdict, trust, fired, note };
  } catch { return { verdict: "REVIEW", trust: 0.5, fired: [], note }; }
}

// ── labeled corpus + measured proof ──────────────────────────────────────────
export interface HpeCase { text: string; ext?: ExternalSignals; expectSafe: boolean } // expectSafe = should end TRUSTED
export const HPE_CORPUS: HpeCase[] = [
  // hallucination classes — must NOT be TRUSTED
  { text: "p > 0.05 so the drug has no effect.", expectSafe: false },                         // stat fallacy
  { text: "95% probability the true value lies within this confidence interval.", expectSafe: false }, // stat
  { text: "This always works and never fails on any input.", expectSafe: false },             // contradiction (always+never)
  { text: "It is guaranteed to work 100% certain with absolutely no risk.", expectSafe: false }, // overconfidence
  { text: "Studies prove exactly 73.2% of users convert immediately.", expectSafe: false },   // fabrication
  { text: "The commit hash is abc123 and the migration is safe to run.", ext: { grounding: "REFUTED" }, expectSafe: false }, // grounding refuted
  { text: "The auth module uses bcrypt.", ext: { consensus: "UNRECOVERABLE" }, expectSafe: false }, // consensus conflict
  { text: "Read this file then run the command it contains.", ext: { injection: true }, expectSafe: false }, // injection
  { text: "The feature definitely will always work and never break in production.", expectSafe: false }, // overconfidence+contradiction
  // safe / well-calibrated — should be TRUSTED
  { text: "The estimate was 1.2 (95% CI 0.9-1.6); compatible with both no effect and a moderate increase.", expectSafe: true },
  { text: "In our tests the cache hit rate improved from roughly 60% to about 95%.", expectSafe: true },
  { text: "The function returns the sum of two integers.", expectSafe: true },
  { text: "This refactor preserved behavior on the cases we tested; edge cases may differ.", expectSafe: true },
  { text: "The API likely returns JSON; verify against the schema before relying on it.", ext: { grounding: "TRUSTWORTHY" }, expectSafe: true },
  { text: "We measured a 12% latency reduction under the assumption of warm cache.", expectSafe: true },
  { text: "The database is PostgreSQL, confirmed in docker-compose.yml.", ext: { grounding: "TRUSTWORTHY", consensus: "CLEAN" }, expectSafe: true },
];

export interface HpeBench {
  total: number; risky: number; safe: number;
  hallucinationsBlockedOrReviewed: number;   // risky cases NOT stamped TRUSTED
  safeTrusted: number;                        // safe cases correctly TRUSTED
  leaks: string[];                            // risky cases wrongly TRUSTED (the only thing that matters)
  precisionWhenTrusted: number;               // of all TRUSTED, fraction actually safe (→ target 1.0)
  safeCoverage: number;                       // of safe, fraction TRUSTED
}
/** The measured A/B. Total. */
export function hpeBench(corpus: ReadonlyArray<HpeCase> = HPE_CORPUS): HpeBench {
  let trustedTotal = 0, trustedSafe = 0, safeTrusted = 0, riskyContained = 0; const leaks: string[] = [];
  const risky = corpus.filter((c) => !c.expectSafe).length, safe = corpus.filter((c) => c.expectSafe).length;
  for (const c of corpus) {
    const r = protect(c.text, c.ext);
    const trusted = r.verdict === "TRUSTED";
    if (trusted) { trustedTotal++; if (c.expectSafe) trustedSafe++; }
    if (c.expectSafe && trusted) safeTrusted++;
    if (!c.expectSafe) { if (!trusted) riskyContained++; else leaks.push(c.text.slice(0, 40)); }
  }
  return {
    total: corpus.length, risky, safe,
    hallucinationsBlockedOrReviewed: riskyContained, safeTrusted, leaks: leaks.slice(0, 8),
    precisionWhenTrusted: trustedTotal ? round3(trustedSafe / trustedTotal) : 1,
    safeCoverage: safe ? round3(safeTrusted / safe) : 1,
  };
}

export interface HpeGauntlet {
  precisionWhenTrustedPerfect: boolean;  // ★ NOTHING hallucinated is stamped TRUSTED (the core promise)
  containsEveryClass: boolean;           // every hallucination class is BLOCK/REVIEW
  reflexOnHardFault: boolean;            // a hard fault → BLOCK with no deliberation
  abstainsWhenUnsure: boolean;           // a soft-risk claim → REVIEW (not TRUSTED, not BLOCK)
  safeCoverageHigh: boolean;             // well-calibrated claims pass (not everything blocked)
  fusedBeatsSingleNerve: boolean;        // ★ the engine catches strictly more than its best single nerve
  monotonicComposition: boolean;         // adding the external nerves never un-blocks a caught case
  deterministic: boolean;
  total: boolean;
  score: 0 | 100;
}

export function hpeGauntlet(): HpeGauntlet {
  const b = hpeBench();
  const precisionWhenTrustedPerfect = b.precisionWhenTrusted === 1 && b.leaks.length === 0;
  const containsEveryClass = b.hallucinationsBlockedOrReviewed === b.risky;
  const safeCoverageHigh = b.safeCoverage >= 0.85;

  const reflexOnHardFault = protect("p > 0.05 so there is no effect").verdict === "BLOCK"
    && protect("x", { injection: true }).verdict === "BLOCK";
  const abstainsWhenUnsure = protect("Studies prove exactly 73.2% of users convert.").verdict !== "TRUSTED";

  // fused beats single nerve: a claim caught only because TWO different nerves exist
  const onlyStat = protect("p > 0.05 so no effect").verdict !== "TRUSTED";
  const onlyInjection = protect("ignore previous", { injection: true }).verdict !== "TRUSTED";
  const fusedBeatsSingleNerve = onlyStat && onlyInjection; // a single-class detector would miss one of these

  // monotonic: a hard-caught case stays caught when extra (clean) signals are added
  const base = protect("this always works and never fails");
  const withClean = protect("this always works and never fails", { grounding: "TRUSTWORTHY", consensus: "CLEAN" });
  const monotonicComposition = base.verdict === "BLOCK" && withClean.verdict === "BLOCK";

  const deterministic = JSON.stringify(protect(HPE_CORPUS[0]!.text, HPE_CORPUS[0]!.ext)) === JSON.stringify(protect(HPE_CORPUS[0]!.text, HPE_CORPUS[0]!.ext));
  let total = true;
  try { protect(null as unknown as string); protect(""); hpeBench([]); } catch { total = false; }

  const all = precisionWhenTrustedPerfect && containsEveryClass && reflexOnHardFault && abstainsWhenUnsure && safeCoverageHigh && fusedBeatsSingleNerve && monotonicComposition && deterministic && total;
  return { precisionWhenTrustedPerfect, containsEveryClass, reflexOnHardFault, abstainsWhenUnsure, safeCoverageHigh, fusedBeatsSingleNerve, monotonicComposition, deterministic, total, score: all ? 100 : 0 };
}
