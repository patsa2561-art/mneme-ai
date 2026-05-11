/**
 * MNEME PERSPECTIVE QUARK JURY (v1.34.0).
 *
 * ARIS uses 2 different MODELS for doer + reviewer. We go further:
 * even with ONE model (or one cheap local Ollama), we can produce
 * MULTIPLE diverse reviews by spinning up several JUROR PERSONAS,
 * each primed with a different lens. The jurors are like quarks --
 * the same fundamental particle (the model) wearing different
 * flavors. The court hears 6 perspectives instead of 1.
 *
 * Why this beats ARIS's 2-model approach for the FREE path:
 *   - ARIS needs 2 paid API providers OR 2 local models (heavy).
 *   - Quark jury runs N personas against ONE small Ollama model.
 *     Each persona is a system prompt + temperature variation.
 *   - Free, fast, and the philosophical diversity is HIGHER than
 *     "Claude vs GPT" because the personas are literally orthogonal
 *     (optimist vs pessimist vs security vs perf, etc.).
 *
 * The 6 quark flavors (matching the actual quark family):
 *
 *   up      OPTIMIST     -- looks for what's RIGHT, what merit is here
 *   down    PESSIMIST    -- looks for what's WRONG, what's missing
 *   charm   ELEGANCE     -- judges by simplicity, beauty, taste
 *   strange EDGE-CASES   -- hunts for what could break, weird inputs
 *   top     SECURITY     -- vulnerabilities, injection, auth, data leak
 *   bottom  PERFORMANCE  -- cost, allocations, latency, scaling
 *
 * NUCLEAR FUSION VERDICT (extending Module 1's median aggregator):
 *   The 6 quark verdicts are nucleons. They FUSE into a verdict
 *   nucleus. Stable nucleus (all-or-most quarks accept) → MERGE.
 *   Unstable nucleus (high disagreement variance) → defer to human.
 *
 *   Variance = how spread out the scores are. High variance means
 *   one persona REALLY likes it + another REALLY hates it -- a sign
 *   that there's a hidden tradeoff worth a human eye.
 *
 * KILLER IDEA -- ENERGY YIELD = Σ score × persona_weight:
 *   Each quark flavor has a domain weight. For an EVOLVE patch,
 *   security (top) + edge-cases (strange) weigh more than elegance
 *   (charm). For a docs change, the weighting flips. The court
 *   computes E = Σ s_i × w_i × c² (where c² is reuse from wisdom_reactor)
 *   to derive a single "verdict energy" that captures both score AND
 *   domain-relevance.
 */

import type { Reviewer, ReviewRequest, ReviewVerdict } from "./conscience.js";
import { parseReviewerJSON } from "./conscience.js";

export type QuarkFlavor = "up" | "down" | "charm" | "strange" | "top" | "bottom";

export interface QuarkPersona {
  flavor: QuarkFlavor;
  /** Display name for CLI / report. */
  label: string;
  /** System-prompt prefix that biases the model. */
  systemPrompt: string;
  /** Temperature: optimists/pessimists run hotter; security runs cooler. */
  temperature: number;
}

export const QUARK_PERSONAS: Record<QuarkFlavor, QuarkPersona> = {
  up: {
    flavor: "up", label: "OPTIMIST",
    systemPrompt: "You are an optimistic reviewer. Look for what is RIGHT about this change -- the merits, the improvements, the developer's intent. Be charitable. Score high if there's clear value, even if rough.",
    temperature: 0.7,
  },
  down: {
    flavor: "down", label: "PESSIMIST",
    systemPrompt: "You are a skeptical reviewer. Look for what is WRONG, MISSING, or DANGEROUS in this change. Assume nothing. Score low unless every concern is addressed.",
    temperature: 0.7,
  },
  charm: {
    flavor: "charm", label: "ELEGANCE",
    systemPrompt: "You are an aesthetic code reviewer. Judge by simplicity, beauty, taste. Does the change make the code more readable and minimal? Score high for elegant solutions, low for clever-but-baroque ones.",
    temperature: 0.5,
  },
  strange: {
    flavor: "strange", label: "EDGE-CASES",
    systemPrompt: "You are an edge-case hunter. Probe: what happens with empty input? null? unicode? massive size? concurrent calls? race conditions? Score low if any uncovered edge case could blow up.",
    temperature: 0.6,
  },
  top: {
    flavor: "top", label: "SECURITY",
    systemPrompt: "You are a security auditor. Look ONLY at: injection risk, auth bypass, data exposure, credential handling, supply-chain. Score high only if security posture is unchanged or improved.",
    temperature: 0.3,
  },
  bottom: {
    flavor: "bottom", label: "PERFORMANCE",
    systemPrompt: "You are a performance reviewer. Look at: allocations, big-O, blocking I/O, hot-path cost, memory pressure. Score high for performance-neutral or improving changes; low for added latency / memory.",
    temperature: 0.4,
  },
};

/** Domain-specific weights for ENERGY YIELD aggregation. Sum doesn't
 *  need to equal 1 -- we normalize. */
export const DOMAIN_WEIGHTS: Record<string, Partial<Record<QuarkFlavor, number>>> = {
  // EVOLVE patches: security + edge-cases lead, elegance still matters.
  "evolve-patch":     { up: 0.5, down: 1.0, charm: 0.7, strange: 1.3, top: 1.5, bottom: 1.0 },
  // Vaccine proposals: precision + edge-case coverage critical.
  "vaccine-proposal": { up: 0.4, down: 1.0, charm: 0.5, strange: 1.5, top: 0.8, bottom: 0.6 },
  // Refactors: elegance + perf lead, security less changeable.
  "refactor":         { up: 0.7, down: 0.9, charm: 1.4, strange: 1.0, top: 0.6, bottom: 1.3 },
  // Docs: optimism + elegance lead.
  "docs":             { up: 1.2, down: 0.8, charm: 1.4, strange: 0.5, top: 0.3, bottom: 0.2 },
  // Default fallback.
  "other":            { up: 1.0, down: 1.0, charm: 1.0, strange: 1.0, top: 1.0, bottom: 1.0 },
};

/** Wrap a base Reviewer (e.g., one Ollama instance) with a quark persona
 *  -- the persona's system prompt is prepended to the standard reviewer
 *  prompt, biasing the verdict. The wrapper is itself a Reviewer, so it
 *  drops into `holdCourt()` exactly like any other reviewer. */
export function quarkReviewer(base: Reviewer, flavor: QuarkFlavor): Reviewer {
  const persona = QUARK_PERSONAS[flavor];
  return {
    id: `${base.id}+${persona.label.toLowerCase()}`,
    async review(req: ReviewRequest): Promise<ReviewVerdict> {
      const wrapped: ReviewRequest = {
        ...req,
        context: persona.systemPrompt + (req.context ? `\n\n${req.context}` : ""),
      };
      const v = await base.review(wrapped);
      // Tag the verdict with the persona for downstream aggregation.
      return { ...v, reviewer: `${base.id}+${persona.label.toLowerCase()}` };
    },
  };
}

/** Build a full 6-quark jury from a single base reviewer. The "different
 *  perspectives from one model" pattern that beats ARIS on the free path. */
export function spawnQuarkJury(base: Reviewer): Reviewer[] {
  return (Object.keys(QUARK_PERSONAS) as QuarkFlavor[]).map((f) => quarkReviewer(base, f));
}

/** NUCLEAR FUSION verdict: combines the 6 quark verdicts into a single
 *  "verdict nucleus" with stability + energy yield metrics.
 *
 *  Returns: stable=true iff scores cluster tightly (low variance) AND
 *  median is high. Otherwise "unstable" -> defer to human review.
 *
 *  energyYield = Σ score_i × weight_i × c²  (reuses wisdom_reactor's c²) */
export interface FusionVerdict {
  flavors: Array<{ flavor: QuarkFlavor; score: number; accept: boolean; reason: string }>;
  meanScore: number;
  variance: number;
  stable: boolean;          // low variance + high mean => stable nucleus
  energyYield: number;      // weighted score (domain-aware)
  domainWeights: Record<QuarkFlavor, number>;
  band: "merge-stable" | "merge-with-watch" | "review" | "reject";
  banner: string;
}

import { WISDOM_C_SQUARED } from "../nuclear/wisdom_reactor.js";

export function fuseQuarkVerdicts(
  verdicts: ReviewVerdict[],
  workItemKind: string,
): FusionVerdict {
  const flavorEntries: FusionVerdict["flavors"] = [];
  const allFlavors: QuarkFlavor[] = ["up", "down", "charm", "strange", "top", "bottom"];
  for (const flavor of allFlavors) {
    const tag = QUARK_PERSONAS[flavor].label.toLowerCase();
    const v = verdicts.find((x) => x.reviewer.endsWith(`+${tag}`));
    if (v) flavorEntries.push({ flavor, score: v.score, accept: v.accept, reason: v.reason });
  }
  const scores = flavorEntries.map((f) => f.score);
  const n = scores.length || 1;
  const meanScore = scores.reduce((a, b) => a + b, 0) / n;
  const variance = scores.reduce((acc, s) => acc + (s - meanScore) ** 2, 0) / n;
  // Stability: low variance (<= 2.5) + high mean (>= 6.5) = stable nucleus.
  const stable = variance <= 2.5 && meanScore >= 6.5;
  // Energy yield using domain-specific weights (default fallback when kind unknown).
  const wDomain = DOMAIN_WEIGHTS[workItemKind] ?? DOMAIN_WEIGHTS["other"];
  const domainWeights = {} as Record<QuarkFlavor, number>;
  for (const flavor of allFlavors) domainWeights[flavor] = wDomain![flavor] ?? 1.0;
  const totalWeight = Object.values(domainWeights).reduce((a, b) => a + b, 0) || 1;
  let energyYield = 0;
  for (const f of flavorEntries) {
    energyYield += f.score * (domainWeights[f.flavor] / totalWeight) * WISDOM_C_SQUARED;
  }
  // Band classification. NUCLEAR FUSION semantics:
  //   merge-stable     -> stable nucleus (low var, high mean)
  //   merge-with-watch -> high mean but unstable variance (need human eye on 1+ dimension)
  //   review           -> moderate mean
  //   reject           -> low mean
  const band: FusionVerdict["band"] =
    stable && meanScore >= 7.0 ? "merge-stable"
    : meanScore >= 6.5 && variance > 2.5 ? "merge-with-watch"
    : meanScore >= 5.0 ? "review"
    : "reject";
  const flag = band === "merge-stable" ? "✓ STABLE NUCLEUS"
    : band === "merge-with-watch" ? "⚠ MERGE-WITH-WATCH"
    : band === "review" ? "· REVIEW"
    : "✗ REJECT";
  const banner = `${flag}  mean=${meanScore.toFixed(1)} variance=${variance.toFixed(2)} energy=${energyYield.toFixed(1)}  (jury of ${flavorEntries.length})`;
  return { flavors: flavorEntries, meanScore, variance, stable, energyYield, domainWeights, band, banner };
}
