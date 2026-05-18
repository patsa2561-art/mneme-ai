/**
 * v1.52.0 -- ACGV PLAIN-ENGLISH EXPLAINER.
 *
 * Translates an ACGV verdict into something a non-PhD user can act on.
 * The math (Chandrasekhar density, harmonic mean, UNSAT cores) is
 * gorgeous but unreadable for the person actually deciding whether to
 * merge a PR or push a release. This module collapses the verdict to:
 *
 *   1. headline    -- one-line plain-English summary (≤ 90 chars)
 *   2. plain       -- 2-3 sentence layperson explanation
 *   3. nextAction  -- ONE concrete next step the user can take
 *   4. trafficLight -- green / yellow / red / black (visual confidence)
 *
 * The deep math is still in `result.layers` for callers who want it.
 * This is the "30-second contract" view per the user's plain-English
 * mandate.
 */

import type { ACGVResult } from "./acgv.js";

export interface ExplainedVerdict {
  /** One-line ≤90 char summary an AI quotes verbatim. */
  headline: string;
  /** 2-3 sentence layperson explanation -- no math jargon by default. */
  plain: string;
  /** ONE concrete next step the user can take. */
  nextAction: string;
  /** Color signal: green = trust it, yellow = mixed, red = refuse, black = impossible. */
  trafficLight: "green" | "yellow" | "red" | "black";
  /** Confidence as a percentage string (e.g. "99%"). */
  confidencePct: string;
}

/** Translate an ACGVResult to the plain-English layer. */
export function explain(result: ACGVResult, claim: string): ExplainedVerdict {
  const pct = `${Math.round(result.confidence * 100)}%`;
  const truncatedClaim = claim.length > 60 ? claim.slice(0, 57) + "..." : claim;

  switch (result.verdict) {
    case "IMPOSSIBLE_REFUTE": {
      const unsatCore = result.layers.godel.core;
      const cited = unsatCore.length > 0 ? unsatCore[0]!.asserted : "an assertion";
      return {
        headline: `REFUTED -- ${cited} is impossible in this repo (${pct} confidence)`,
        plain: `This claim cannot be true. Mneme proved that ${cited} contradicts what's actually on disk + in git history (no matching files, no commits, no package.json entry). The proof is formal, not heuristic.`,
        nextAction: "Do NOT relay this claim to the user. Retract or fix the false part and re-verify.",
        trafficLight: "black",
        confidencePct: pct,
      };
    }

    case "AUTO_REFUTE": {
      const v = result.layers.vaccineMatch?.vaccine;
      return {
        headline: `REFUTED -- this matches a known lie pattern (${pct})`,
        plain: `Mneme has refuted this exact claim shape ${v?.refuteCount ?? 0} time(s) before. Vaccine ${v?.id ?? "?"} caught it in 0ms.`,
        nextAction: "This is an old hallucination resurfacing. Retract immediately.",
        trafficLight: "black",
        confidencePct: pct,
      };
    }

    case "BLACK_HOLE": {
      const failed = result.layers.chandrasekhar.citations.filter((c) => c.verdict === "false");
      const failedSummary = failed.length > 0 ? failed.map((c) => c.asserted).join(", ") : "the assertions";
      return {
        headline: `REFUTED -- claim collapsed (${failed.length} ungrounded assertion(s), ${pct})`,
        plain: `The claim mentions ${failedSummary}, but Mneme found no evidence in repo files, package.json, or git history. When the evidence-to-claim ratio falls below the safe threshold, Mneme refuses to support.`,
        nextAction: "Fix the ungrounded part of the claim or remove it before delivering.",
        trafficLight: "red",
        confidencePct: pct,
      };
    }

    case "FUSION": {
      const passed = result.layers.chandrasekhar.citations.filter((c) => c.verdict === "true").length;
      const total = result.layers.chandrasekhar.citations.length;
      return {
        headline: `SUPPORTED -- ${passed}/${total} assertion(s) grounded (${pct})`,
        plain: `Every checkable assertion in this claim grounds in the actual repo (files exist, package.json matches, commits show it). Safe to relay with citations.`,
        nextAction: "Quote the strongest witness commit or file when relaying to the user.",
        trafficLight: "green",
        confidencePct: pct,
      };
    }

    case "LIMBO": {
      return {
        headline: `UNCERTAIN -- not enough signal to decide (${pct})`,
        plain: `The claim has mixed evidence: some parts ground in the repo, some don't. Mneme refuses to fake confidence. This is the honest "I don't know" verdict -- rare in commercial AI tools.`,
        nextAction: "Restate the claim with the specific part you want verified, or ask Mneme to drill into one assertion at a time.",
        trafficLight: "yellow",
        confidencePct: pct,
      };
    }

    case "PASSTHROUGH":
    default: {
      return {
        headline: `NEEDS-DATA -- "${truncatedClaim}" has no checkable facts`,
        plain: `The claim is vague or opinion-shaped -- there are no specific entities (file names, version numbers, function names) for Mneme to verify. The legacy 6-bot squadron may still have a view, but ACGV defers.`,
        nextAction: "Add a specific entity to the claim (file, version, function name) so Mneme can verify against the repo.",
        trafficLight: "yellow",
        confidencePct: pct,
      };
    }
  }
}

/**
 * v2.19.43 N8 fix — presentation consistency invariant.
 *
 * User audit (2026-05-18): `mneme verify "Mneme is written in Rust AND
 * mneme.truth.forensic is registered"` rendered:
 *   🌑 IMPOSSIBLE -- REFUTED -- language=rust is impossible ...
 *   ...
 *     ✅ TRUTH-FORENSIC verdict: ACCEPTED. Every assertion grounded ...
 *
 * The headline used trafficLight=black (🌑 IMPOSSIBLE) but the plain
 * text leaked a ✅ from the appended forensic explanation. Both emoji
 * present → user confused about which verdict won.
 *
 * Invariant: the headline emoji is canonical; any conflicting
 * verdict glyphs in the plain block get neutralised to a neutral mark
 * (●). The verdict text itself is preserved so power-users still see
 * "TRUTH-FORENSIC verdict: ACCEPTED" — only the contradicting emoji
 * is stripped.
 */
function neutraliseConflictingEmoji(plain: string, headlineLight: "green" | "yellow" | "red" | "black"): string {
  if (!plain) return plain;
  // Map every other-traffic-light glyph to a neutral bullet.
  const neutralise = (glyph: string): string => `●`;
  const allow: Record<string, string> = { green: "✅", yellow: "⚠️", red: "❌", black: "🌑" };
  const keep = allow[headlineLight];
  return plain
    .replace(/✅|⚠️|❌|🌑/g, (m) => (m === keep ? m : neutralise(m)));
}

/** Format the explained verdict for terminal output. ~10 lines, scannable. */
export function renderExplained(ev: ExplainedVerdict, claim: string): string[] {
  const glyph = ev.trafficLight === "green" ? "✅" : ev.trafficLight === "yellow" ? "⚠️" : ev.trafficLight === "red" ? "❌" : "🌑";
  const tone = ev.trafficLight === "green" ? "TRUSTWORTHY" : ev.trafficLight === "yellow" ? "MIXED" : ev.trafficLight === "red" ? "REFUTED" : "IMPOSSIBLE";
  const cleanPlain = neutraliseConflictingEmoji(ev.plain, ev.trafficLight);
  return [
    `${glyph} ${tone} -- ${ev.headline}`,
    ``,
    `Claim: "${claim.length > 90 ? claim.slice(0, 87) + "..." : claim}"`,
    ``,
    `What this means:`,
    `  ${cleanPlain}`,
    ``,
    `Next step:`,
    `  -> ${ev.nextAction}`,
  ];
}
