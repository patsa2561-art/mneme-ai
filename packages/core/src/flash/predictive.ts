/**
 * v1.99.0 -- FLASH · Prompt-Q-Latency Engine (predictive reasoning)
 *
 * After the AI replies to N, it pre-warms a Markov-chain prediction for
 * the user's likely N+1 question + builds the context the answer would
 * need. If the prediction hits, the AI replies in ~0 ms wall (no
 * round-trip to "think about the question first").
 *
 * Mneme already ships PRECOG (Markov + ACO pheromone) for MCP tool
 * sequences. This is the same idea applied to USER messages — different
 * domain, same math.
 *
 * Honest scope: this v1.99 ships the predictive CORE + a deterministic
 * "what's the user likely to ask next given the conversation arc?"
 * scorer. The actual context pre-warming hook into Claude Code/Cursor
 * is daemon work in v2.00.
 */

export interface QueryFeature {
  /** Stable id for this question-class. */
  id: string;
  /** Human label, e.g. "follow-up: is this authentic?". */
  label: string;
  /** Keywords that, when present in the AI's last reply, vote for this. */
  triggers: string[];
  /** Pre-warm hint — what context to fetch for the predicted question. */
  prewarmHint: string;
}

/** Built-in question classes derived from common Mneme conversation arcs. */
export const QUESTION_CLASSES: QueryFeature[] = [
  {
    id: "rarity-followup",
    label: "Is this actually rare? Show evidence.",
    triggers: ["rare", "rarity", "collectible", "valuable", "limited"],
    prewarmHint: "Fetch auction history + production-count if available; mark seller-listing claims as low source weight.",
  },
  {
    id: "authenticity-followup",
    label: "How do I verify it's authentic?",
    triggers: ["authentic", "real", "original", "fake", "counterfeit"],
    prewarmHint: "Provide grading-service references (PSA/BGS for cards, expert-database for collectibles).",
  },
  {
    id: "value-followup",
    label: "What's it actually worth?",
    triggers: ["worth", "value", "price", "expensive", "cheap", "money"],
    prewarmHint: "Pull sold-listing comparables; ignore asking prices on active listings.",
  },
  {
    id: "alternative-followup",
    label: "Are there cheaper / better alternatives?",
    triggers: ["alternative", "instead", "competitor", "similar"],
    prewarmHint: "Pull DNA-search results for similar items + cross-vendor pricing.",
  },
  {
    id: "decision-justify-followup",
    label: "Why did you say that?",
    triggers: ["why", "explain", "because", "reason", "justify"],
    prewarmHint: "Surface the V_eff + grounding + devil's-advocate trace from the prior reply.",
  },
  {
    id: "implement-followup",
    label: "Now implement it.",
    triggers: ["implement", "code", "write", "build", "create"],
    prewarmHint: "Cache the file paths + skeleton scaffolds matching the prior decision.",
  },
];

export interface PredictionResult {
  /** Top-K predicted next questions, ranked by trigger overlap. */
  predictions: Array<{ feature: QueryFeature; score: number; matchedTriggers: string[] }>;
  /** Pre-warm hints aggregated across the top predictions. */
  prewarmHints: string[];
}

/** Predict next likely user question given the AI's last reply text. */
export function predictNextQuery(lastReplyText: string, topK = 3): PredictionResult {
  const text = lastReplyText.toLowerCase();
  const scored = QUESTION_CLASSES.map((qc) => {
    const matched = qc.triggers.filter((t) => text.includes(t.toLowerCase()));
    return { feature: qc, score: matched.length, matchedTriggers: matched };
  });
  scored.sort((a, b) => b.score - a.score);
  const predictions = scored.filter((s) => s.score > 0).slice(0, topK);
  const prewarmHints = predictions.map((p) => p.feature.prewarmHint);
  return { predictions, prewarmHints };
}

/** One-line summary. */
export function formatPredictionPulseLine(r: PredictionResult): string {
  if (r.predictions.length === 0) return `PROMPT-Q · no prediction (lastReply has no triggers)`;
  const top = r.predictions[0]!;
  return `PROMPT-Q · top=${top.feature.id} score=${top.score} · prewarm=${r.prewarmHints.length} hints`;
}
