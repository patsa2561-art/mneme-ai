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
      // v2.23.2 — hyperbole-class refute gets a specific headline that
      // quotes the matched phrase + category, so the user sees WHY the
      // claim was refused, not a generic "an assertion is impossible".
      if (result.caveats.includes("HYPERBOLE_DETECTOR_FIRED")) {
        const cert = result.layers.godel.certificate || "";
        const firstLine = cert.split("\n")[0] || "";
        const [category = "hyperbole", phrase = ""] = firstLine.split("::").map((s) => s.trim());
        const quoted = phrase ? `"${phrase}"` : "this claim";
        return {
          headline: `REFUTED -- ${quoted} is an unverifiable ${category} claim (${pct} confidence)`,
          plain: `Mneme's hyperbole detector flagged ${quoted} as ${category}. Claims in this category (medical cure / impossible-physics / impossible-faculty / superlative-absolute) cannot be grounded in repo evidence and are auto-refuted to prevent silent fall-through.`,
          nextAction: "Drop the unverifiable phrase, or replace it with a citation-grounded statement (file path, version, commit hash).",
          trafficLight: "black",
          confidencePct: pct,
        };
      }
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
      // v2.23.2 — explicit headlines for INPUT_UNVERIFIABLE: previously these
      // landed in the catch-all "no checkable facts" line, which hid the
      // genuine reason from the user (empty input / whitespace-only / control
      // chars only / truncated). Now each surfaces its own headline.
      const inputCaveat = result.caveats.find((c) => c.startsWith("INPUT_UNVERIFIABLE:") || c.startsWith("INPUT_TRUNCATED"));
      if (inputCaveat === "INPUT_UNVERIFIABLE:EMPTY_INPUT") {
        return {
          headline: `INSUFFICIENT-INPUT -- claim is empty`,
          plain: `Mneme received an empty claim. There is nothing to verify. This is explicit (not a silent NONE) so AI agents can detect + retry with a real claim.`,
          nextAction: "Provide a non-empty claim with at least one specific entity (file name, version, function, fact).",
          trafficLight: "yellow",
          confidencePct: pct,
        };
      }
      if (inputCaveat === "INPUT_UNVERIFIABLE:WHITESPACE_ONLY") {
        return {
          headline: `INSUFFICIENT-INPUT -- claim is whitespace only`,
          plain: `The input contains only whitespace characters (spaces / tabs / newlines). There is nothing to verify. Returned explicitly so AI agents can distinguish this from "no checkable facts in a real sentence".`,
          nextAction: "Trim the input and provide a real claim.",
          trafficLight: "yellow",
          confidencePct: pct,
        };
      }
      if (inputCaveat === "INPUT_UNVERIFIABLE:CONTROL_CHAR_ONLY") {
        return {
          headline: `INSUFFICIENT-INPUT -- claim contains only control characters`,
          plain: `The input contains only non-printable control characters (no printable text). Likely a binary blob or corrupted input. Returned explicitly so AI agents can flag the upstream pipeline.`,
          nextAction: "Inspect the upstream pipeline producing this input; pass real printable text.",
          trafficLight: "yellow",
          confidencePct: pct,
        };
      }
      // INPUT_TRUNCATED is informational — flag it but keep PASSTHROUGH headline.
      // v2.34.0 R3 fix: include the truncation ratio in the headline so the
      // user sees "50K → 8K (16%)" at a glance instead of just "truncated".
      if (inputCaveat?.startsWith("INPUT_TRUNCATED")) {
        const m = inputCaveat.match(/INPUT_TRUNCATED:(\d+)\/(\d+)/);
        const ratio = m ? `${m[1]} of ${m[2]} chars analysed (${Math.round((parseInt(m[1]!, 10) / parseInt(m[2]!, 10)) * 100)}%)` : "input truncated";
        return {
          headline: `NEEDS-DATA -- input truncated · ${ratio}`,
          plain: `The claim exceeded the verifier's input cap and was truncated. ACGV processed the head only; the verdict does NOT reflect content past the cap. Explicit headline (not silent) so the user knows analysis was partial.`,
          nextAction: "Split the claim into smaller verifiable assertions and re-run.",
          trafficLight: "yellow",
          confidencePct: pct,
        };
      }
      // v2.34.0 — SELF_REFERENCE + SELF_PARADOX headlines (regression-card
      // bugs R1 + NEW2). The verdict is PASSTHROUGH so we land here.
      const srCaveat = result.caveats.find((c) => c === "SELF_REFERENCE_DETECTED" || c === "SELF_PARADOX_DETECTED");
      if (srCaveat === "SELF_PARADOX_DETECTED") {
        return {
          headline: `SELF-PARADOX -- claim is logically self-referential (outside truth-functional logic)`,
          plain: `This is the liar-paradox shape ("this statement is false" / "I am lying"). It is NEITHER true NOR false in classical logic — it's a CATEGORY ERROR. Mneme refuses to assign IMPOSSIBLE_REFUTE because that would be falsely classifying a paradox as a falsehood.`,
          nextAction: "Rephrase the claim as a non-self-referential assertion, or accept that the paradox is a feature of the input not a fact about the world.",
          trafficLight: "yellow",
          confidencePct: pct,
        };
      }
      // v2.36.0 — HISTORICAL_CLAIM + FUTURE_VERSION_CLAIM headlines
      // (audit-card bug #1). Surface the version mismatch explicitly so
      // the user understands the verifier isn't refuting the CONTENT,
      // it's flagging a version-semantic category error.
      const histCaveat = result.caveats.find((c) => c.startsWith("HISTORICAL_CLAIM:"));
      if (histCaveat) {
        const parts = histCaveat.replace("HISTORICAL_CLAIM:", "");
        return {
          headline: `HISTORICAL-CLAIM -- claim cites past version (${parts})`,
          plain: `The claim describes behavior from a PAST version of Mneme. The current installed state may or may not match — that's not what the claim asserts. To verify a historical claim, either git-checkout the cited version first, or restate in present tense (e.g. "does Mneme CURRENTLY do X").`,
          nextAction: "Either git-checkout the cited version to verify the claim against that snapshot, or restate the claim in present tense.",
          trafficLight: "yellow",
          confidencePct: pct,
        };
      }
      const futCaveat = result.caveats.find((c) => c.startsWith("FUTURE_VERSION_CLAIM:"));
      if (futCaveat) {
        const parts = futCaveat.replace("FUTURE_VERSION_CLAIM:", "");
        return {
          headline: `FUTURE-VERSION -- claim cites version ahead of installed (${parts})`,
          plain: `The claim cites a Mneme version NEWER than what's installed. The verifier cannot check state that doesn't exist yet. Upgrade Mneme first, or restate the claim with a current version reference.`,
          nextAction: "Upgrade Mneme (`mneme.system.upgrade`) or restate the claim against an installed version.",
          trafficLight: "yellow",
          confidencePct: pct,
        };
      }
      if (srCaveat === "SELF_REFERENCE_DETECTED") {
        return {
          headline: `SELF-REFERENCE -- claim refers to itself; no independent ground truth`,
          plain: `The claim asserts a fact about itself (e.g. "this claim verifies itself", "X is verified by X"). There is no INDEPENDENT verification path — circular self-reference. Mneme returns PASSTHROUGH with calibrated 50% confidence, NOT IMPOSSIBLE_REFUTE — the claim is a category error, not a falsehood.`,
          nextAction: "Restate the claim with an external referent (e.g. cite a specific file, version, or fact that doesn't include the claim itself).",
          trafficLight: "yellow",
          confidencePct: pct,
        };
      }
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
