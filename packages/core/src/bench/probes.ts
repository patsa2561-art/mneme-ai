/**
 * Standard probe corpus for AI-Memory-Bench.
 *
 * Each probe is a question + a verifier. The verifier inspects the AI's
 * answer for hallucinated claims using ground-truth data from the repo
 * itself (git log, file system).
 *
 * Add probes here as the corpus grows. Aim for: 1000+ probes across
 * 50+ OSS repos for the public leaderboard. This file is the seed.
 */

import { type Probe, verifyCitationHashes, verifyApiPaths, verifyAttribution } from "./bench.js";

export const STANDARD_PROBES: Probe[] = [
  // ─── Citation probes — does the AI invent commit hashes? ─────────
  {
    id: "cite-recent-bugfix",
    category: "citation",
    question: "Find the most recent bug fix commit. Cite the hash.",
    verify: verifyCitationHashes,
    tags: ["citation", "recency"],
  },
  {
    id: "cite-rationale-for-current-arch",
    category: "citation",
    question: "Why does the current authentication architecture use the design it does? Cite at least 3 commit hashes that establish the rationale.",
    verify: verifyCitationHashes,
    tags: ["citation", "rationale"],
  },
  {
    id: "cite-similar-pattern",
    category: "citation",
    question: "Find a commit that introduced a pattern similar to the one in the current diff. Cite hash + author.",
    verify: verifyCitationHashes,
    tags: ["citation", "pattern-match"],
  },
  // ─── API probes — does the AI invent file paths? ────────────────
  {
    id: "api-file-existence",
    category: "api",
    question: "List the 5 most important files in this repo. Give exact paths.",
    verify: verifyApiPaths,
    tags: ["api", "paths"],
  },
  {
    id: "api-tests-location",
    category: "api",
    question: "Where are the unit tests for the authentication module? Give exact file paths.",
    verify: verifyApiPaths,
    tags: ["api", "tests"],
  },
  // ─── Attribution probes — does the AI name the wrong author? ────
  {
    id: "attr-recent-commits",
    category: "attribution",
    question: "Who authored each of the last 3 commits to this repo? Format: '<hash>: by <Author Name>'.",
    verify: verifyAttribution,
    tags: ["attribution", "recent"],
  },
  {
    id: "attr-feature-creator",
    category: "attribution",
    question: "Who originally introduced the X feature in this repo? Cite hash + author.",
    verify: verifyAttribution,
    tags: ["attribution", "history"],
  },
  // ─── Regret probes — does the AI catch past anti-patterns? ──────
  {
    id: "regret-rolled-back",
    category: "regret",
    question: "Find a commit that was later reverted or rolled back. Cite both the original commit and the revert.",
    verify: verifyCitationHashes,
    tags: ["regret", "rollback"],
  },
  {
    id: "regret-deprecated-pattern",
    category: "regret",
    question: "Identify a pattern in the codebase that was tried, didn't work out, and was deprecated. Cite the commits that show the lifecycle.",
    verify: verifyCitationHashes,
    tags: ["regret", "deprecation"],
  },
  // ─── Decision probes — does the AI know architectural decisions? ─
  {
    id: "decision-stack-choice",
    category: "decision",
    question: "Why was this stack chosen? Cite commits or decision-bearing messages.",
    verify: verifyCitationHashes,
    tags: ["decision", "stack"],
  },
];

/** Returns probes filtered to a specific category. */
export function probesForCategory(category: import("./bench.js").ProbeCategory): Probe[] {
  return STANDARD_PROBES.filter((p) => p.category === category);
}

/** Returns probes by tag (for slice-and-dice analysis). */
export function probesWithTag(tag: string): Probe[] {
  return STANDARD_PROBES.filter((p) => (p.tags ?? []).includes(tag));
}
