/**
 * Smart suggestions — given a question and its results, propose 3 follow-up
 * commands the user might want to run next.
 *
 * Pure function. Heuristic, not LLM. Deterministic so tests can verify it.
 *
 * Design principle: every suggestion must lead to an actionable command
 * the user can copy-paste. Vague hints ("explore more", "look around") are
 * useless; concrete commands compound.
 */

import type { SearchResult } from "../types.js";

export interface Suggestion {
  /** The CLI command, ready to copy-paste. */
  command: string;
  /** One-line "why this is interesting". */
  reason: string;
}

/**
 * Build follow-up suggestions for an `ask` query.
 * Returns 0..3 suggestions, ordered by likely usefulness.
 */
export function suggestFollowUps(question: string, results: SearchResult[]): Suggestion[] {
  const out: Suggestion[] = [];

  if (results.length === 0) return out;

  const top = results[0]!;
  const topAuthor = top.commit.authorName;
  const topFile = (top.commit.files ?? [])[0];

  // 1. If the top commit has files, suggest `mneme why <file>:<line>` for the
  //    most-changed file. Anchor question into a specific location.
  if (topFile) {
    out.push({
      command: `mneme why ${topFile}`,
      reason: `Walk the blame + history of the file most changed in the top commit`,
    });
  }

  // 2. Story command — narrate the topic across acts.
  const topicWord = extractTopicWord(question);
  if (topicWord) {
    out.push({
      command: `mneme story ${topicWord}`,
      reason: `See how "${topicWord}" evolved across acts (initial / refactor / incidents)`,
    });
  }

  // 3. Who-knows — surface the human expert.
  if (topicWord && topAuthor) {
    out.push({
      command: `mneme who-knows ${topicWord}`,
      reason: `Find people most likely to know about "${topicWord}" (top hit so far: ${topAuthor})`,
    });
  } else if (topAuthor) {
    out.push({
      command: `mneme who-knows ${topAuthor.split(/\s+/)[0]?.toLowerCase()}`,
      reason: `See where ${topAuthor} has been most active recently`,
    });
  }

  // 4. Blast radius if the top commit looks recent.
  if (results.length >= 2 && top.commit.shortHash) {
    out.push({
      command: `mneme blast ${top.commit.shortHash}`,
      reason: `Predict incidents likely to follow shipping the top commit (base-rate verdict)`,
    });
  }

  return out.slice(0, 3);
}

/**
 * Extract a "topic word" from a question — the most concrete noun, suitable
 * for plugging into `story <topic>` or `who-knows <topic>`. Falsy when nothing
 * concrete is present.
 */
export function extractTopicWord(question: string): string | undefined {
  // 1. Look for camelCase / PascalCase identifiers (case-sensitive on the original).
  const camel = question.match(/[a-z]+[A-Z][a-zA-Z]+/);
  if (camel) return camel[0];

  // 2. Look for path-like tokens (lowercased — paths are usually lowercase anyway).
  const q = question.toLowerCase();
  const path = q.match(/[a-z]+\/[a-z]+/);
  if (path) return path[0];

  // 3. Strip stop-words and punctuation and pick the longest remaining token.
  const STOP = new Set([
    "the", "a", "an", "is", "are", "was", "were", "do", "does", "did",
    "why", "when", "what", "who", "how", "where", "this", "that",
    "to", "from", "on", "in", "of", "for", "with", "and", "or", "but",
    "code", "file", "method", "module", "any",
    "use", "uses", "used", "using",
  ]);
  const words = q
    .replace(/[?.,!;:'"()[\]{}]/g, " ")
    .split(/\s+/)
    .filter((w) => w.length >= 4 && !STOP.has(w));
  if (words.length === 0) return undefined;
  // Prefer longest distinct-looking word.
  words.sort((a, b) => b.length - a.length);
  return words[0];
}
