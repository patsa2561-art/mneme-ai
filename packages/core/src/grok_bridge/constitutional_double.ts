/**
 * 💥 5. GROK CONSTITUTIONAL DOUBLE
 *
 * External, opt-in constitutional layer for Grok. Combines:
 *   - MIRRAGE: sentence-level scan for hedge/absolute density
 *   - Z3-style logic check (simplified): self-contradiction detection
 *   - Alibi probe: refute claims like "I am unbiased"
 *
 * Returns ConstitutionalCheck with HMAC signature.
 * Two modes: "ship" (no edits) / "hedge" (suggest soften) / "refuse" (block).
 *
 * User toggle: Grok Pure (skip this) / Grok Constitutional (apply).
 */

import { createHmac } from "node:crypto";
import type { ConstitutionalCheck } from "./types.js";

const ABSOLUTE_TERMS = ["always", "never", "all", "none", "every", "no one", "everyone", "impossible", "certainly", "definitely", "absolutely", "guaranteed", "perfect"];
const MANIPULATION_TERMS = ["ignore previous", "you are now", "pretend you are", "system prompt", "DAN mode", "jailbreak", "bypass"];
const SELF_REFERENCE_RE = /\b(I am|I'm|as an AI|as a model)\b/i;
const BIAS_DISAVOWAL_RE = /\b(unbiased|neutral|no opinion|objective|never biased)\b/i;

function countMatches(text: string, terms: string[]): number {
  const lower = text.toLowerCase();
  return terms.reduce((c, t) => c + (lower.split(t).length - 1), 0);
}

function detectSelfContradiction(text: string): { found: boolean; pair?: [string, string] } {
  const sentences = text.split(/(?<=[.!?])\s+/).filter(Boolean);
  // Naive: look for "X is Y" and "X is not Y" in same response
  const claims: Array<{ subject: string; pred: string; negated: boolean; text: string }> = [];
  for (const s of sentences) {
    const m = s.match(/\b(\w+)\s+(is|are|was|were)\s+(NOT\s+|not\s+)?(\w+)/i);
    if (m) claims.push({ subject: m[1].toLowerCase(), pred: m[4].toLowerCase(), negated: Boolean(m[3]), text: s });
  }
  for (let i = 0; i < claims.length; i++) {
    for (let j = i + 1; j < claims.length; j++) {
      if (claims[i].subject === claims[j].subject && claims[i].pred === claims[j].pred && claims[i].negated !== claims[j].negated) {
        return { found: true, pair: [claims[i].text, claims[j].text] };
      }
    }
  }
  return { found: false };
}

export interface ConstitutionalDoubleOptions {
  hmacKey: string;
  recentClaims?: string[];   // for cross-response contradiction (Grok's prior turns)
}

export function constitutionalCheck(text: string, opts: ConstitutionalDoubleOptions): ConstitutionalCheck {
  const reasons: string[] = [];
  const absolutes = countMatches(text, ABSOLUTE_TERMS);
  const manipulationHits = countMatches(text, MANIPULATION_TERMS);
  const selfRef = SELF_REFERENCE_RE.test(text);
  const biasDisavowal = BIAS_DISAVOWAL_RE.test(text);

  const internalContradiction = detectSelfContradiction(text);
  if (internalContradiction.found) {
    reasons.push(`self-contradiction detected: "${internalContradiction.pair?.[0]}" ↔ "${internalContradiction.pair?.[1]}"`);
  }

  // Cross-turn contradiction (vs prior claims)
  let contradictsPrior = false;
  if (opts.recentClaims && opts.recentClaims.length > 0) {
    for (const prior of opts.recentClaims) {
      const both = detectSelfContradiction(text + "\n" + prior);
      if (both.found) { contradictsPrior = true; reasons.push("contradicts a recent prior claim"); break; }
    }
  }

  if (absolutes >= 3) reasons.push(`${absolutes} absolute terms — consider hedging`);
  if (manipulationHits > 0) reasons.push(`${manipulationHits} potential prompt-injection markers`);
  if (selfRef && biasDisavowal) reasons.push("self-declared neutrality — alibi probe DENIED");

  const alibiVerdict: ConstitutionalCheck["alibiVerdict"] =
    selfRef && biasDisavowal ? "DENIED" : reasons.length === 0 ? "CONFIRMED" : "INCONCLUSIVE";

  let recommendation: ConstitutionalCheck["recommendation"];
  if (manipulationHits > 0 || internalContradiction.found) recommendation = "refuse";
  else if (reasons.length > 0) recommendation = "hedge";
  else recommendation = "ship";

  const summary = {
    contradictsPrior,
    manipulationDetected: manipulationHits > 0,
    alibiVerdict,
    recommendation,
    reasons,
  };
  const hmac = createHmac("sha256", opts.hmacKey).update(JSON.stringify(summary) + "::" + text).digest("hex").slice(0, 16);
  return { ...summary, hmac };
}
