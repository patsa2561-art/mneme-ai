/**
 * LLM synthesis layer — turns retrieval results into a paragraph answer.
 *
 * Without this, `mneme ask` returns a list of commits and lets the user piece
 * together the answer themselves. With this, the answer reads like a brief
 * from a senior dev: "X exists because Y; here are the commits that prove it."
 *
 * The synthesizer is *grounded* — it MUST cite commit hashes and MUST refuse
 * to invent claims not present in the retrieved evidence. The prompt enforces
 * this; the temperature is low (0.2). On hallucination risk, we err on the
 * side of saying "the evidence is mixed" rather than fabricating a thesis.
 *
 * Falls back to an extractive answer (template over top-3 commits) when no
 * LLM is reachable. The extractive path is itself good enough for most
 * keyword queries — the LLM is the polish.
 */

import type { SearchResult } from "../types.js";
import type { ConfidenceLabel } from "./search.js";

/**
 * Subset of EnricherProvider needed here. We avoid a hard dependency on
 * @mneme-ai/embeddings to keep core dep-free; callers pass an enricher in.
 */
export interface SynthesisEnricher {
  readonly name: string;
  enrich(input: {
    system: string;
    user: string;
    temperature?: number;
    maxTokens?: number;
  }): Promise<{ text: string }>;
}

export interface SynthesizedAnswer {
  /** The paragraph the user reads at the top of `mneme ask` output. */
  answer: string;
  /** Provenance: where the answer came from. */
  source: "llm" | "extractive" | "no-context";
  /** The same confidence label that was passed in (echoed for caller convenience). */
  confidence: ConfidenceLabel;
  /** Hashes of the commits the answer is grounded in. */
  evidenceCommitHashes: string[];
  /** Per-call latency for telemetry / "how slow is this?" calibration. */
  durationMs: number;
}

const SYNTH_SYSTEM_PROMPT = [
  "You are a senior engineer answering a question about a code repository's history.",
  "You are given a question and the top-K commits retrieved from the repo's git history.",
  "Write a 2-4 sentence answer that:",
  "  • Cites at least one commit hash (short form, 7 chars) using inline backticks.",
  "  • Says only what the evidence supports — never invent a claim.",
  "  • If the evidence is thin or contradicts itself, say so plainly.",
  "  • Avoids filler ('the codebase shows', 'as we can see') and lists.",
  "Output the answer as plain text, no markdown lists, no headings, no preamble.",
].join("\n");

/**
 * Synthesize an answer from retrieval results.
 *
 * @param question — the user's original query (already classified as 'specific'
 *                   or 'lookup' by `classifyIntent`).
 * @param results  — top-K SearchResult, ordered by score.
 * @param confidence — pre-computed by `classifyConfidence(results)`.
 * @param enricher — optional. If undefined or fails, we fall back to extractive.
 * @param maxResults — how many top results to ground the answer in (default 5).
 */
export async function synthesize(
  question: string,
  results: SearchResult[],
  confidence: ConfidenceLabel,
  enricher?: SynthesisEnricher,
  maxResults = 5,
): Promise<SynthesizedAnswer> {
  const t0 = Date.now();

  if (confidence === "none" || results.length === 0) {
    return {
      answer: noContextAnswer(question),
      source: "no-context",
      confidence,
      evidenceCommitHashes: [],
      durationMs: Date.now() - t0,
    };
  }

  const top = results.slice(0, maxResults);
  const evidenceHashes = top.map((r) => r.commit.hash);

  if (!enricher) {
    return {
      answer: extractiveAnswer(question, top, confidence),
      source: "extractive",
      confidence,
      evidenceCommitHashes: evidenceHashes,
      durationMs: Date.now() - t0,
    };
  }

  try {
    const userPrompt = buildSynthesisPrompt(question, top, confidence);
    const out = await enricher.enrich({
      system: SYNTH_SYSTEM_PROMPT,
      user: userPrompt,
      temperature: 0.2,
      maxTokens: 250,
    });
    const cleaned = cleanLlmOutput(out.text);
    return {
      answer: cleaned || extractiveAnswer(question, top, confidence),
      source: cleaned ? "llm" : "extractive",
      confidence,
      evidenceCommitHashes: evidenceHashes,
      durationMs: Date.now() - t0,
    };
  } catch {
    // LLM failed (timeout, model not pulled, network) — extractive fallback.
    return {
      answer: extractiveAnswer(question, top, confidence),
      source: "extractive",
      confidence,
      evidenceCommitHashes: evidenceHashes,
      durationMs: Date.now() - t0,
    };
  }
}

/**
 * Build the user-side prompt: question + numbered evidence with hashes,
 * dates, authors, subjects, and a snippet of the body. Compact enough to fit
 * comfortably in any modern LLM's context.
 */
function buildSynthesisPrompt(
  question: string,
  results: SearchResult[],
  confidence: ConfidenceLabel,
): string {
  const lines: string[] = [];
  lines.push(`Question: ${question}`);
  lines.push("");
  lines.push(`Retrieval confidence: ${confidence}`);
  if (confidence === "low") {
    lines.push("(The evidence is thin — say so honestly if the answer cannot be supported.)");
  }
  lines.push("");
  lines.push("Top commits:");
  results.forEach((r, i) => {
    const hash = r.commit.shortHash || r.commit.hash.slice(0, 7);
    const date = r.commit.authorDate.slice(0, 10);
    const author = r.commit.authorName;
    const subject = r.commit.subject;
    const body = (r.commit.body || "").split("\n").slice(0, 3).join(" ").trim().slice(0, 280);
    lines.push(`${i + 1}. \`${hash}\` (${date}, ${author}): ${subject}`);
    if (body) lines.push(`   ${body}`);
  });
  lines.push("");
  lines.push("Answer:");
  return lines.join("\n");
}

/** Strip common LLM artifacts: leading "Answer:", surrounding quotes, trailing meta. */
function cleanLlmOutput(text: string): string {
  let t = text.trim();
  // Drop a leading "Answer:" if the model echoed it back.
  t = t.replace(/^answer\s*:\s*/i, "");
  // Drop wrapping quotes if any.
  if ((t.startsWith('"') && t.endsWith('"')) || (t.startsWith("'") && t.endsWith("'"))) {
    t = t.slice(1, -1).trim();
  }
  // Strip trailing "Sources: ..." or "Citations: ..." (we already render evidence below).
  t = t.replace(/\n+\s*(sources?|citations?|references?)\s*:[\s\S]*$/i, "");
  return t.trim();
}

/**
 * Template-based answer — used when no LLM is configured or LLM fails.
 * Honest and short: "Top X matches: PR #N (author, date) — subject."
 */
function extractiveAnswer(
  _question: string,
  results: SearchResult[],
  confidence: ConfidenceLabel,
): string {
  const top = results.slice(0, 3);
  const parts = top.map((r) => {
    const hash = r.commit.shortHash || r.commit.hash.slice(0, 7);
    const date = r.commit.authorDate.slice(0, 10);
    return `\`${hash}\` (${date}): ${r.commit.subject}`;
  });
  const prefix =
    confidence === "high"
      ? "The most likely answer is in"
      : confidence === "medium"
        ? "Possibly relevant"
        : "Weakly relevant — please verify";
  if (top.length === 1) return `${prefix} ${parts[0]}.`;
  if (top.length === 2) return `${prefix} ${parts[0]} and ${parts[1]}.`;
  return `${prefix} ${parts[0]}; also ${parts[1]} and ${parts[2]}.`;
}

/** Honest "no context found" — never returns a result. */
function noContextAnswer(_question: string): string {
  return [
    "No strong context found for this question.",
    "Either the answer lives outside git (a Slack thread, a design doc, an in-person decision)",
    "or the question is too general for a memory-layer tool — try something specific like",
    '"why does <function or pattern> exist?" or "when did we change <module>?"',
  ].join(" ");
}
