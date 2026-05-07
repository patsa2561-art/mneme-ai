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
import { verifyAnswerLeviathan } from "./leviathan.js";

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
  source: "llm" | "extractive" | "no-context" | "audit-refused";
  /** The same confidence label that was passed in (echoed for caller convenience). */
  confidence: ConfidenceLabel;
  /** Hashes of the commits the answer is grounded in. */
  evidenceCommitHashes: string[];
  /**
   * Hallucination guard — list of inline backtick-hashes the LLM cited that
   * are NOT present in the retrieved evidence. Empty array means audit-clean.
   */
  unverifiedCitations: string[];
  /**
   * Trust score 0..1 — combines confidence label + citation validity.
   *   - "audit-refused" → 0
   *   - "no-context" → 0
   *   - extractive → 0.5–0.7 (no LLM risk)
   *   - LLM clean (no unverified citations) → 0.8–1.0
   *   - LLM with unverified citations → < 0.5 (risk of hallucination)
   */
  trustScore: number;
  /** Per-call latency for telemetry / "how slow is this?" calibration. */
  durationMs: number;
}

/** Options for the synthesizer. */
export interface SynthesizeOptions {
  /** Top-K to ground the answer in (default 5). */
  maxResults?: number;
  /**
   * Audit mode — refuse to answer below a confidence floor instead of
   * returning best-effort prose. Use this when the consumer is an audit
   * surface (CI gate, MCP tool result, security review).
   */
  auditMode?: boolean;
  /**
   * Minimum confidence label that audit mode allows. Defaults to "medium".
   * Anything below is refused with a "audit-refused" source.
   */
  auditFloor?: ConfidenceLabel;
  /**
   * v0.24 HTC: pre-compressed Layer-1 abstracts keyed by commit hash. When
   * provided, the prompt uses the abstract (~30 tok) instead of the raw
   * commit body (~500 tok) → 10× fewer tokens for the same answer quality.
   * Source `"llm-htc"` is reported on the answer when this path is used.
   */
  htcAbstracts?: Map<string, string>;
}

const SYNTH_SYSTEM_PROMPT = [
  "You are a senior engineer answering a question about a code repository's history.",
  "You receive the user's question and the top-K commits retrieved from git.",
  "",
  "Write a VERDICT-SHAPED answer:",
  "  Line 1: A single declarative sentence stating the verdict.",
  "  Line 2-3: 1-2 sentences of supporting evidence, citing at least one",
  "            commit hash using `inline backticks`.",
  "  Optionally line 4: A 1-line caveat IF the evidence is thin.",
  "",
  "Strict rules:",
  "  • Never invent claims. If evidence is contradictory, say \"the evidence is mixed\".",
  "  • No lists, no markdown headings, no preamble like \"Based on the commits...\".",
  "  • Don't hedge with \"Possibly\", \"Likely\", \"It seems\" in line 1 — STATE the verdict.",
  "  • The user already sees the evidence cards below. Don't repeat them.",
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
  optsOrMax: number | SynthesizeOptions = 5,
): Promise<SynthesizedAnswer> {
  const t0 = Date.now();
  const opts: SynthesizeOptions =
    typeof optsOrMax === "number" ? { maxResults: optsOrMax } : optsOrMax;
  const maxResults = opts.maxResults ?? 5;
  const auditFloor = opts.auditFloor ?? "medium";

  if (confidence === "none" || results.length === 0) {
    return {
      answer: noContextAnswer(question),
      source: "no-context",
      confidence,
      evidenceCommitHashes: [],
      unverifiedCitations: [],
      trustScore: 0,
      durationMs: Date.now() - t0,
    };
  }

  // Audit mode — refuse below floor (audit-grade caller doesn't want
  // best-effort prose; they want either an answer or a refusal).
  if (opts.auditMode && !meetsConfidenceFloor(confidence, auditFloor)) {
    return {
      answer: auditRefusedAnswer(question, confidence, auditFloor),
      source: "audit-refused",
      confidence,
      evidenceCommitHashes: [],
      unverifiedCitations: [],
      trustScore: 0,
      durationMs: Date.now() - t0,
    };
  }

  const top = results.slice(0, maxResults);
  const evidenceHashes = top.map((r) => r.commit.hash);

  if (!enricher) {
    const ans = extractiveAnswer(question, top, confidence);
    return {
      answer: ans,
      source: "extractive",
      confidence,
      evidenceCommitHashes: evidenceHashes,
      unverifiedCitations: [],
      trustScore: extractiveTrust(confidence),
      durationMs: Date.now() - t0,
    };
  }

  try {
    // v0.24 HTC: when caller passes pre-compressed abstracts, use them in
    // the prompt instead of raw bodies. Same answer quality, ~10× fewer
    // tokens. Falls back to raw if a hash is missing from the cache.
    const userPrompt = opts.htcAbstracts
      ? buildSynthesisPromptHtc(question, top, confidence, opts.htcAbstracts)
      : buildSynthesisPrompt(question, top, confidence);
    const out = await enricher.enrich({
      system: SYNTH_SYSTEM_PROMPT,
      user: userPrompt,
      temperature: 0.2,
      maxTokens: 250,
    });
    const cleaned = cleanLlmOutput(out.text);
    if (!cleaned) {
      // empty LLM output → extractive fallback
      const ans = extractiveAnswer(question, top, confidence);
      return {
        answer: ans,
        source: "extractive",
        confidence,
        evidenceCommitHashes: evidenceHashes,
        unverifiedCitations: [],
        trustScore: extractiveTrust(confidence),
        durationMs: Date.now() - t0,
      };
    }

    // Hallucination guard — verify all backtick-hashes in the answer
    // appear in the evidence set. If unverified citations are present, we
    // still return the LLM answer (caller can choose to surface or refuse)
    // but mark the offending hashes so audit-grade consumers can hard-fail.
    const unverified = findUnverifiedCitations(cleaned, evidenceHashes);

    // In audit mode, ANY unverified citation = refuse.
    if (opts.auditMode && unverified.length > 0) {
      return {
        answer: auditRefusedAnswer(question, confidence, auditFloor, unverified),
        source: "audit-refused",
        confidence,
        evidenceCommitHashes: evidenceHashes,
        unverifiedCitations: unverified,
        trustScore: 0,
        durationMs: Date.now() - t0,
      };
    }

    // Leviathan pass — Algorithm 1 style draft/target verification. We use it
    // to wrap fabricated-hash spans inline (`[unverified: ...]`) so the user
    // sees what was filtered. We only rewrite the answer when the simpler
    // hash-presence check (`findUnverifiedCitations`) already flagged a
    // problem; otherwise legitimate paraphrases get noisy markers.
    let finalAnswer = cleaned;
    if (unverified.length > 0) {
      const evidenceForLev = top.map((r) => ({
        hash: r.commit.hash,
        shortHash: r.commit.shortHash || r.commit.hash.slice(0, 7),
        subject: r.commit.subject,
      }));
      const lev = verifyAnswerLeviathan({ answer: cleaned, evidence: evidenceForLev });
      finalAnswer = lev.cleanedAnswer;
    }

    return {
      answer: finalAnswer,
      source: "llm",
      confidence,
      evidenceCommitHashes: evidenceHashes,
      unverifiedCitations: unverified,
      trustScore: llmTrust(confidence, unverified.length),
      durationMs: Date.now() - t0,
    };
  } catch {
    // LLM failed (timeout, model not pulled, network) — extractive fallback.
    const ans = extractiveAnswer(question, top, confidence);
    return {
      answer: ans,
      source: "extractive",
      confidence,
      evidenceCommitHashes: evidenceHashes,
      unverifiedCitations: [],
      trustScore: extractiveTrust(confidence),
      durationMs: Date.now() - t0,
    };
  }
}

/**
 * Extract every backtick-quoted token from the answer that LOOKS like a
 * commit hash (≥4 hex chars), then return the subset that is NOT present
 * (as prefix) in any evidence hash. These are candidate hallucinations.
 */
export function findUnverifiedCitations(
  answer: string,
  evidenceHashes: string[],
): string[] {
  const tokens = answer.matchAll(/`([0-9a-f]{4,40})`/gi);
  const evSet = evidenceHashes.map((h) => h.toLowerCase());
  const unverified: string[] = [];
  const seen = new Set<string>();
  for (const m of tokens) {
    const cited = m[1]!.toLowerCase();
    if (seen.has(cited)) continue;
    seen.add(cited);
    const matches = evSet.some((h) => h.startsWith(cited) || cited.startsWith(h));
    if (!matches) unverified.push(cited);
  }
  return unverified;
}

function meetsConfidenceFloor(
  confidence: ConfidenceLabel,
  floor: ConfidenceLabel,
): boolean {
  const order: Record<ConfidenceLabel, number> = {
    none: 0,
    low: 1,
    medium: 2,
    high: 3,
  };
  return (order[confidence] ?? 0) >= (order[floor] ?? 0);
}

function extractiveTrust(confidence: ConfidenceLabel): number {
  // Extractive = template-based, no LLM hallucination risk.
  switch (confidence) {
    case "high":
      return 0.7;
    case "medium":
      return 0.6;
    case "low":
      return 0.5;
    default:
      return 0;
  }
}

function llmTrust(confidence: ConfidenceLabel, unverifiedCount: number): number {
  let base: number;
  switch (confidence) {
    case "high":
      base = 0.95;
      break;
    case "medium":
      base = 0.8;
      break;
    case "low":
      base = 0.6;
      break;
    default:
      return 0;
  }
  // Each unverified citation cuts trust significantly.
  const penalty = Math.min(0.5, unverifiedCount * 0.2);
  return Number(Math.max(0, base - penalty).toFixed(2));
}

function auditRefusedAnswer(
  question: string,
  confidence: ConfidenceLabel,
  auditFloor: ConfidenceLabel,
  unverified?: string[],
): string {
  const lines: string[] = [];
  lines.push("Audit mode refused this answer.");
  if (unverified && unverified.length > 0) {
    lines.push(
      `The model cited ${unverified.length} hash${unverified.length === 1 ? "" : "es"} (${unverified.slice(0, 3).join(", ")}…) that don't appear in the retrieved evidence.`,
    );
  } else {
    lines.push(
      `Confidence is "${confidence}" (audit floor: "${auditFloor}"). Not enough grounded evidence to commit to a verdict.`,
    );
  }
  lines.push(`Re-phrase the query, narrow the scope, or run with --no-audit to see best-effort prose.`);
  return lines.join("\n");
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

/**
 * v0.24 HTC variant — uses pre-compressed Layer-1 abstracts (~30 tok each)
 * instead of raw commit bodies (~500 tok). Same prompt shape, ~10× smaller.
 * Falls back to subject only if a hash is missing from the abstract cache.
 */
function buildSynthesisPromptHtc(
  question: string,
  results: SearchResult[],
  confidence: ConfidenceLabel,
  abstracts: Map<string, string>,
): string {
  const lines: string[] = [];
  lines.push(`Question: ${question}`);
  lines.push("");
  lines.push(`Retrieval confidence: ${confidence}`);
  if (confidence === "low") {
    lines.push("(The evidence is thin — say so honestly if the answer cannot be supported.)");
  }
  lines.push("");
  lines.push("Top commits (pre-compressed abstracts):");
  results.forEach((r, i) => {
    const hash = r.commit.shortHash || r.commit.hash.slice(0, 7);
    const date = r.commit.authorDate.slice(0, 10);
    const abstract = abstracts.get(r.commit.hash) ?? r.commit.subject;
    lines.push(`${i + 1}. \`${hash}\` (${date}): ${abstract}`);
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
 * Template-based VERDICT answer — used when no LLM is configured or LLM fails.
 * Aggregates results into an actionable summary, not a list of evidence rows.
 *
 * Shape:
 *   Line 1 — verdict ("X did 73% of the work" / "Most relevant commit is `abc`")
 *   Line 2 — supporting context (date range or top file)
 *   (Caveat if confidence is low.)
 */
function extractiveAnswer(
  _question: string,
  results: SearchResult[],
  confidence: ConfidenceLabel,
): string {
  if (results.length === 0) return "No matching commits found.";

  const top = results[0]!;
  const topHash = top.commit.shortHash || top.commit.hash.slice(0, 7);

  // Aggregate author distribution.
  const authors = new Map<string, number>();
  for (const r of results) {
    const a = r.commit.authorName;
    authors.set(a, (authors.get(a) ?? 0) + 1);
  }
  const sortedAuthors = [...authors.entries()].sort((a, b) => b[1] - a[1]);
  const topAuthor = sortedAuthors[0]!;
  const topAuthorPct = Math.round((topAuthor[1] / results.length) * 100);

  // Date range.
  const dates = results.map((r) => r.commit.authorDate.slice(0, 10)).sort();
  const fromDate = dates[0]!;
  const toDate = dates[dates.length - 1]!;
  const dateRange = fromDate === toDate ? fromDate : `${fromDate} → ${toDate}`;

  // Verdict line — author-aggregated when one dominates, otherwise commit-first.
  let verdict: string;
  if (topAuthorPct >= 60 && results.length >= 3) {
    verdict = `${topAuthor[0]} authored ${topAuthor[1]} of ${results.length} relevant commits (${topAuthorPct}%) — likely the person to ask.`;
  } else if (results.length === 1) {
    verdict = `The single relevant commit is \`${topHash}\` — ${top.commit.subject}.`;
  } else {
    verdict = `${results.length} relevant commits across ${sortedAuthors.length} author(s); the strongest match is \`${topHash}\` (${top.commit.authorName}).`;
  }

  // Supporting line — date range + top commit subject (if not already in verdict).
  const support = `Range: ${dateRange}. Top: \`${topHash}\` — ${top.commit.subject}.`;

  // Caveat for thin evidence.
  const caveat =
    confidence === "low"
      ? " The evidence is thin — verify before trusting this answer."
      : "";

  return `${verdict}\n${support}${caveat}`;
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
