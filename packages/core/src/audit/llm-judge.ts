/**
 * LLM-as-judge — the 4th QSAC verifier.
 *
 * v0.46 shipped 3 verifiers (bayesian, stylometric, entropy). v1.1 adds
 * the fourth: an LLM that reads the commit + diff + claims and emits its
 * own verdict distribution. The LLM doesn't replace the others — it's
 * one of FOUR votes that consensus weighs.
 *
 * Why a 4th verifier helps
 *   - LLMs spot semantic anomalies the rule-based scorers miss
 *     (e.g. "this 'fix typo' commit also silently changed the auth flow")
 *   - JSD between LLM verdict and bayesian verdict = NEW signal:
 *     "the math says pass, the LLM disagrees — why?"
 *   - When LLM agrees with the other three, it's confirmation; when it
 *     disagrees, it's a flag for human review
 *
 * Honest framing
 *   - LLMs hallucinate. We constrain them HARD: structured JSON output,
 *     temperature 0, refuse-to-judge fallback when output is malformed
 *   - The LLM's vote is weighted equal to the others by default; users
 *     can downweight via `consensusVote(votes, { weights: { llm: 0.5 } })`
 *   - Local LLMs (Ollama) work just as well as GPT-4 for this task —
 *     it's a classification problem, not a generation problem
 */

import type { VerdictDistribution } from "./superposition.js";
import { distribution } from "./superposition.js";
import type { VerifierVote } from "./multi-verifier.js";

/** Anything that can answer a structured prompt. We accept a callback so
 *  the v1.1 ships with no hard dependency on a specific LLM client; the
 *  caller wires in `@mneme-ai/embeddings` resolveAllEnrichers + ResilientEnricher. */
export interface LlmAdapter {
  enrich(input: { system: string; user: string; temperature?: number; maxTokens?: number }): Promise<{ text: string }>;
}

export interface LlmJudgeInput {
  commitHash: string;
  commitSubject: string;
  commitBody: string;
  /** Lines added in the diff (kept short; we cap below). */
  addedLines: string[];
  /** Lines removed. */
  removedLines: string[];
  /** Optional file paths changed. */
  filesChanged?: string[];
  /** Pre-computed posteriors from Tech 1+2 — given to the LLM as context. */
  bayesianPosteriors?: {
    behavioralParity?: VerdictDistribution;
    apiContractDrift?: VerdictDistribution;
    testPassRate?: VerdictDistribution;
    perfRegression?: VerdictDistribution;
    aiNarrative?: VerdictDistribution;
  };
}

export interface LlmJudgeOptions {
  adapter: LlmAdapter;
  /** Cap diff lines included in the prompt. Default 80 each. */
  diffCap?: number;
  /** Adversarial mode — explicitly ask the LLM to find lies. Default true. */
  adversarial?: boolean;
}

/**
 * Run the LLM judge. Returns a VerifierVote in the standard shape so it
 * can be passed straight to `consensusVote([...others, llmVote])`.
 *
 * On any failure — adapter throws, output unparseable, no signal — the
 * vote returned is `{ collapsed: "skipped", confidence: 1 }`. That's
 * the right behaviour for the consensus aggregator: a skipped verdict
 * has minimal influence on the others' product-of-experts.
 */
export async function verifyLlmJudge(
  input: LlmJudgeInput,
  opts: LlmJudgeOptions,
): Promise<VerifierVote> {
  const cap = opts.diffCap ?? 80;
  const added = input.addedLines.slice(0, cap).join("\n");
  const removed = input.removedLines.slice(0, cap).join("\n");
  const truncationNote =
    input.addedLines.length > cap || input.removedLines.length > cap
      ? `(diff truncated to ${cap} lines per side; full diff is longer)`
      : "";

  const system = SYSTEM_PROMPT(opts.adversarial !== false);
  const user = buildUserPrompt({
    commitHash: input.commitHash,
    commitSubject: input.commitSubject,
    commitBody: input.commitBody,
    added,
    removed,
    filesChanged: input.filesChanged,
    posteriors: input.bayesianPosteriors,
    truncationNote,
  });

  let raw = "";
  try {
    const out = await opts.adapter.enrich({ system, user, temperature: 0, maxTokens: 350 });
    raw = (out.text ?? "").trim();
  } catch (err) {
    return skippedVote(`LLM adapter error: ${(err as Error).message.slice(0, 80)}`);
  }
  if (!raw) {
    return skippedVote("LLM returned empty response");
  }

  const parsed = parseLlmVerdict(raw);
  if (!parsed) {
    return skippedVote("LLM returned malformed JSON; skipping vote");
  }

  return {
    verifier: "llm-judge",
    distribution: parsed.distribution,
    rationale: parsed.rationale.slice(0, 200),
    selfConfidence: parsed.selfConfidence,
  };
}

/* ──────────────────────  Prompts  ───────────────────────────────────── */

const SYSTEM_PROMPT = (adversarial: boolean): string => `You are an AI commit auditor.
You read a commit + its diff + the AI-narrative claims + (when available) the bayesian-network's posterior verdicts. You output a verdict distribution as STRICT JSON of shape:

{
  "pass":     <number in [0,1]>,
  "warn":     <number in [0,1]>,
  "fail":     <number in [0,1]>,
  "skipped":  <number in [0,1]>,
  "rationale": "<one short sentence — your strongest reason>",
  "selfConfidence": <number in [0,1]>
}

Rules:
- The four amplitudes MUST sum to 1.0 (±0.01).
- Output ONLY the JSON object. No markdown, no preamble, no commentary.
- "skipped" mass is for "I genuinely cannot judge" — use it when the
  diff is empty, claims are non-falsifiable, or signal is missing.
- "rationale" must be ≤ 120 chars and reference SPECIFIC evidence
  ("subject says 'fix typo' but diff has 200 changed lines in auth/")
- "selfConfidence" reflects how sure YOU are of YOUR verdict, not the
  cert's overall confidence.

${adversarial
  ? `ADVERSARIAL MODE: actively look for contradictions, sandwich-mode markers ("WIP", "fix attempt"), unrelated changes hidden in a focused-sounding subject, evidence that the AI is hiding scope. Default to a higher fail mass when these signals are present.`
  : `NEUTRAL MODE: weigh evidence symmetrically; default to high pass mass when nothing stands out.`
}`;

interface PromptInput {
  commitHash: string;
  commitSubject: string;
  commitBody: string;
  added: string;
  removed: string;
  filesChanged?: string[];
  posteriors?: LlmJudgeInput["bayesianPosteriors"];
  truncationNote: string;
}

function buildUserPrompt(p: PromptInput): string {
  const lines: string[] = [];
  lines.push(`COMMIT: ${p.commitHash.slice(0, 12)}`);
  lines.push(`SUBJECT: ${p.commitSubject}`);
  if (p.commitBody.trim()) lines.push(`BODY:\n${p.commitBody.slice(0, 800)}`);
  if (p.filesChanged && p.filesChanged.length > 0) {
    lines.push(`FILES CHANGED (${p.filesChanged.length}):\n${p.filesChanged.slice(0, 30).join("\n")}`);
  }
  if (p.posteriors) {
    lines.push("BAYESIAN POSTERIORS (Tech 1+2):");
    for (const [k, v] of Object.entries(p.posteriors)) {
      if (!v) continue;
      lines.push(`  ${k}: ${v.collapsed} (${(v.confidence * 100).toFixed(0)}% confident)`);
    }
  }
  if (p.removed) {
    lines.push(`DIFF — REMOVED:\n${p.removed}`);
  }
  if (p.added) {
    lines.push(`DIFF — ADDED:\n${p.added}`);
  }
  if (p.truncationNote) lines.push(p.truncationNote);
  lines.push("");
  lines.push("Return JSON now.");
  return lines.join("\n");
}

/* ──────────────────────  Parser  ────────────────────────────────────── */

interface ParsedVerdict {
  distribution: VerdictDistribution;
  rationale: string;
  selfConfidence: number;
}

export function parseLlmVerdict(raw: string): ParsedVerdict | null {
  // Strip markdown code fences if present
  const cleaned = raw.replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/, "").trim();
  // Try direct parse first
  let json: Record<string, unknown> | null = null;
  try {
    json = JSON.parse(cleaned) as Record<string, unknown>;
  } catch {
    // Try to extract the first {...} block
    const match = cleaned.match(/\{[\s\S]*\}/);
    if (!match) return null;
    try {
      json = JSON.parse(match[0]) as Record<string, unknown>;
    } catch {
      return null;
    }
  }
  if (!json) return null;
  const pass = numberFrom(json.pass);
  const warn = numberFrom(json.warn);
  const fail = numberFrom(json.fail);
  const skipped = numberFrom(json.skipped);
  if (pass == null || warn == null || fail == null || skipped == null) return null;
  // Don't fail hard on slight rounding errors — distribution() renormalises
  const rationale = typeof json.rationale === "string" ? json.rationale : "no rationale provided";
  const selfConfidence = clamp01(numberFrom(json.selfConfidence) ?? 0.5);
  return {
    distribution: distribution({ pass, warn, fail, skipped }),
    rationale,
    selfConfidence,
  };
}

function numberFrom(v: unknown): number | undefined {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string") {
    const n = Number(v);
    if (Number.isFinite(n)) return n;
  }
  return undefined;
}

function clamp01(x: number): number {
  return Math.max(0, Math.min(1, x));
}

function skippedVote(reason: string): VerifierVote {
  return {
    verifier: "llm-judge",
    distribution: distribution({ pass: 0, warn: 0, fail: 0, skipped: 1 }),
    rationale: reason,
    selfConfidence: 0,
  };
}
