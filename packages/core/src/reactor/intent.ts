/**
 * v1.62.0 -- REACTOR LAYER 2: INTENT COMPILER.
 *
 * Catch vague prompts BEFORE the AI burns tokens. Classifies the prompt
 * into one of 4 vagueness bands + suggests tighter alternatives that
 * route to a cheaper Mneme tool.
 *
 * The trick: most "explain how X works" prompts can be re-routed to
 * cheaper Mneme tools (mneme.why, mneme.passport, mneme.atrophy, etc)
 * that emit pre-computed summaries instead of letting the AI read N
 * files + chain-of-thought through them.
 */

import { estimateTokens, metricsOf, type ReactorMetrics } from "./measure.js";

export type Vagueness = "tight" | "okay" | "vague" | "very-vague";

export interface IntentRefinement {
  /** Original prompt. */
  prompt: string;
  /** Vagueness classification. */
  vagueness: Vagueness;
  /** Estimated naive AI token burn for this prompt. */
  estimatedBurn: number;
  /** Up to 4 tighter alternatives that route to cheap Mneme tools. */
  alternatives: Array<{
    refined: string;
    suggestedTool: string;
    estimatedTokens: number;
    rationale: string;
  }>;
  metrics: ReactorMetrics;
}

const VAGUE_KEYWORDS = [
  "explain", "tell me about", "what does this do", "how does this work",
  "describe", "summary of", "overview", "tell me everything",
  "what's in", "show me the code",
];

const TIGHT_KEYWORDS = [
  "function", "line", "file", "commit", "v1.", "version", "sha",
  "rev-parse", "show me the function", "rename", "fix",
];

function classify(prompt: string): Vagueness {
  const lower = prompt.toLowerCase();
  const wordCount = prompt.split(/\s+/).filter(Boolean).length;
  let vagueHits = 0;
  for (const v of VAGUE_KEYWORDS) if (lower.includes(v)) vagueHits++;
  let tightHits = 0;
  for (const t of TIGHT_KEYWORDS) if (lower.includes(t)) tightHits++;
  if (tightHits >= 2 && vagueHits === 0) return "tight";
  if (tightHits >= 1 && vagueHits <= 1) return "okay";
  if (vagueHits >= 1 && wordCount <= 12) return "vague";
  if (wordCount <= 5 && vagueHits === 0 && tightHits === 0) return "very-vague";
  return vagueHits >= 2 ? "very-vague" : "vague";
}

/** Estimate the naive token burn for a vague prompt:
 *  - tight:      300 tok base
 *  - okay:       800 tok
 *  - vague:      2000 tok
 *  - very-vague: 4000 tok
 */
function estimateNaiveBurn(v: Vagueness): number {
  return { tight: 300, okay: 800, vague: 2000, "very-vague": 4000 }[v];
}

/** Map vague intent to specific Mneme tool alternatives. */
function buildAlternatives(prompt: string, vagueness: Vagueness): IntentRefinement["alternatives"] {
  const lower = prompt.toLowerCase();
  const out: IntentRefinement["alternatives"] = [];

  if (lower.includes("how") && (lower.includes("work") || lower.includes("auth") || lower.includes("done"))) {
    out.push({
      refined: `${prompt} -- focus on file:line entry point only`,
      suggestedTool: "mneme.why",
      estimatedTokens: 300,
      rationale: "mneme.why returns a pre-computed reason narrative instead of letting AI scan files",
    });
  }
  if (lower.includes("explain") || lower.includes("overview") || lower.includes("describe")) {
    out.push({
      refined: `summarize the lineage / history of "${prompt.replace(/explain|describe|overview/gi, "").trim()}"`,
      suggestedTool: "mneme.heartbeat",
      estimatedTokens: 350,
      rationale: "heartbeat returns a 20-axis MRI snapshot vs raw file walk",
    });
  }
  if (lower.includes("who") || lower.includes("owner") || lower.includes("team")) {
    out.push({
      refined: `who currently owns / understands ${prompt.split(/who|owner/i)[1]?.slice(0, 60) ?? "this code"}`,
      suggestedTool: "mneme.passport",
      estimatedTokens: 250,
      rationale: "passport surfaces the engineer-DNA dossier directly",
    });
  }
  if (lower.includes("changed") || lower.includes("yesterday") || lower.includes("last week") || lower.includes("recent")) {
    out.push({
      refined: `summary of recent commits in this area`,
      suggestedTool: "mneme.memory.search_commits",
      estimatedTokens: 280,
      rationale: "search_commits returns the relevant slice instead of full git log",
    });
  }
  if (vagueness === "very-vague" || vagueness === "vague") {
    out.push({
      refined: `${prompt} -- restate with a specific file path / function name / version`,
      suggestedTool: "(user-action)",
      estimatedTokens: 150,
      rationale: "tighter restatement saves the most tokens",
    });
  }
  return out.slice(0, 4);
}

export function refineIntent(prompt: string): IntentRefinement {
  const v = classify(prompt);
  const baseline = estimateNaiveBurn(v);
  const alternatives = buildAlternatives(prompt, v);
  const cheapest = alternatives.length > 0
    ? Math.min(...alternatives.map((a) => a.estimatedTokens))
    : baseline;
  const spent = v === "tight" ? baseline : Math.min(baseline, cheapest);
  return {
    prompt,
    vagueness: v,
    estimatedBurn: baseline,
    alternatives,
    metrics: metricsOf(spent, baseline, `intent_compiler_${v}`),
  };
}
