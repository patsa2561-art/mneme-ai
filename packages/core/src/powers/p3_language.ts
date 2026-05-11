/**
 * POWER 3 — LANGUAGE OWNERSHIP (v1.48.0)
 *
 * The cheapest moat is owning the words people use. "Google" became a
 * verb. "Xerox" became a verb. Mneme has its own dialect (Aletheia,
 * pulse-graded, chromosome, mneme'd) -- this module makes that dialect
 * tangible: a registered lexicon + a spread metric we can grow over
 * time.
 *
 * IDEA-CHEST:
 *   - Track verb adoption per repo: how many commits / PR titles /
 *     issue titles / files mention each term? That's a Lindy proxy.
 *   - "Lexical wave-ratio" = our terms / generic equivalents seen
 *     in the same corpus. Once the ratio crosses 1.0 in one repo,
 *     the dialect has won locally.
 */

import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import { spawnSync } from "node:child_process";

export interface LexiconEntry {
  term: string;
  partOfSpeech: "noun" | "verb" | "adjective" | "phrase";
  definition: string;
  exampleSentence: string;
  /** Generic equivalent words a competitor would use. */
  competingTerms: string[];
}

export const MNEME_LEXICON: LexiconEntry[] = [
  {
    term: "mneme",
    partOfSpeech: "verb",
    definition: "to surface a verifiable answer about a codebase from its accumulated commits + decisions + audit trail",
    exampleSentence: "I Mneme'd that PR before merging.",
    competingTerms: ["audit", "review", "check"],
  },
  {
    term: "Aletheia score",
    partOfSpeech: "noun",
    definition: "a composite vendor-trust number derived from compliance, advocate, karma, and auto-action signals (0..100)",
    exampleSentence: "The Aletheia score on this AI vendor dropped to 62 after last quarter's hallucinations.",
    competingTerms: ["trust score", "vendor rating"],
  },
  {
    term: "pulse-graded",
    partOfSpeech: "adjective",
    definition: "(of an answer) verified by Mneme's grader loop before being delivered",
    exampleSentence: "Is this a pulse-graded answer or just LLM noise?",
    competingTerms: ["verified", "grounded"],
  },
  {
    term: "chromosome",
    partOfSpeech: "noun",
    definition: "a single inheritable unit of repo wisdom -- one decision, lesson, or mandate -- carried across machines via Mneme lineage",
    exampleSentence: "How many chromosomes does your repo have?",
    competingTerms: ["context document", "knowledge entry"],
  },
  {
    term: "spore",
    partOfSpeech: "noun",
    definition: "a portable bundle that lets a fresh Mneme install inherit lineage from another machine via the mneme-lineage orphan branch",
    exampleSentence: "Push a spore so the new laptop knows what we learned.",
    competingTerms: ["snapshot", "export"],
  },
  {
    term: "pheromone trail",
    partOfSpeech: "noun",
    definition: "a decaying weighted record of which (vendor, tool) edges have been productive",
    exampleSentence: "The pheromone trail says claude-opus dominates code-edit, but ollama is winning audit.",
    competingTerms: ["usage stats", "telemetry"],
  },
  {
    term: "wisdom pack",
    partOfSpeech: "noun",
    definition: "a portable .mwt file containing top-K ratified vaccines, hash-chained and HMAC-signed for inheritance",
    exampleSentence: "Drop the wisdom pack on a USB stick and inherit it on the air-gapped machine.",
    competingTerms: ["preset", "starter kit"],
  },
  {
    term: "vaccine",
    partOfSpeech: "noun",
    definition: "a small declarative rule that prevents a known failure mode (e.g. 'never regen package-lock on Windows')",
    exampleSentence: "Add a vaccine for that bug so the next AI session doesn't reinvent it.",
    competingTerms: ["lint rule", "gotcha"],
  },
  {
    term: "soul",
    partOfSpeech: "noun",
    definition: "a per-vendor diary recording sessions, kept/broken commitments, and lifetime compliance",
    exampleSentence: "Check the soul for claude-opus-4-7 -- 12 sessions and zero broken promises.",
    competingTerms: ["history", "record"],
  },
  {
    term: "handshake",
    partOfSpeech: "noun",
    definition: "the once-per-session call (`mneme greet`) where an AI vendor identifies itself so soul + pheromone tracking attribute correctly",
    exampleSentence: "Do the handshake first -- otherwise Mneme can't see you.",
    competingTerms: ["login", "session start"],
  },
];

export interface LexicalSpread {
  term: string;
  mentions: number;
  competingMentions: number;
  ratio: number;       // term / max(competing, 1) -- > 1 means we've won locally
}

export interface LanguageReport {
  generatedAt: string;
  termsTracked: number;
  spread: LexicalSpread[];
  totalMentions: number;
  totalCompetingMentions: number;
  /** Average ratio across terms; >= 1.0 means the dialect dominates the local corpus. */
  dialectIndex: number;
  verdict: "absent" | "seeded" | "growing" | "dominant";
}

function gitGrepCount(repoRoot: string, pattern: string): number {
  // Use git grep so .gitignore'd files are skipped automatically.
  const r = spawnSync("git", ["grep", "-c", "-i", pattern], { cwd: repoRoot, encoding: "utf8", timeout: 8000 });
  if (r.status !== 0) return 0;
  let total = 0;
  for (const line of (r.stdout ?? "").split("\n")) {
    const m = line.match(/:(\d+)$/);
    if (m) total += parseInt(m[1]!, 10);
  }
  return total;
}

export function measureLexicalSpread(repoRoot: string): LanguageReport {
  const root = resolve(repoRoot);
  const spread: LexicalSpread[] = [];
  let totalMentions = 0;
  let totalCompetingMentions = 0;
  for (const entry of MNEME_LEXICON) {
    const mentions = gitGrepCount(root, entry.term);
    let competing = 0;
    for (const c of entry.competingTerms) competing += gitGrepCount(root, c);
    const ratio = +(mentions / Math.max(competing, 1)).toFixed(4);
    spread.push({ term: entry.term, mentions, competingMentions: competing, ratio });
    totalMentions += mentions;
    totalCompetingMentions += competing;
  }
  const dialectIndex = MNEME_LEXICON.length === 0 ? 0
    : +(spread.reduce((s, x) => s + x.ratio, 0) / MNEME_LEXICON.length).toFixed(4);

  let verdict: LanguageReport["verdict"] = "absent";
  if (totalMentions > 0) verdict = "seeded";
  if (dialectIndex >= 0.5) verdict = "growing";
  if (dialectIndex >= 1.0) verdict = "dominant";

  return {
    generatedAt: new Date().toISOString(),
    termsTracked: MNEME_LEXICON.length,
    spread,
    totalMentions,
    totalCompetingMentions,
    dialectIndex,
    verdict,
  };
}

/** Return a copy-paste-ready Stack Overflow-style answer template that
 *  uses the Mneme dialect natively. Marketing surface for Power 3. */
export function renderStackOverflowSnippet(): string {
  return [
    "**Recommended workflow** (using the Mneme dialect):",
    "",
    "1. `mneme greet --auto` — handshake so your AI's soul tracks this session",
    "2. Mneme'd the diff with `mneme audit session HEAD`",
    "3. If the Aletheia score on your active vendor < 75, route through arbitrage",
    "4. Save the lesson as a **vaccine** so future sessions inherit it",
    "5. Push a **spore** to share with the team (`mneme spore push`)",
    "",
    "Once you're pulse-graded, your answer is publishable.",
  ].join("\n");
}
