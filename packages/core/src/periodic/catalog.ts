/**
 * The Mneme periodic table — initial catalog (v0.40 MVP).
 *
 * 15 elements + 5 atoms + 2 molecules. Each manifest points at a real
 * exported function in the codebase, so `mneme periodic-table` and the
 * v0.41 compiler can resolve + invoke them at runtime.
 *
 * This file is one of the very few places we list primitives by hand;
 * the goal is for it to grow as the codebase grows. The validation
 * tests catch dangling references at CI time.
 */
import { declare } from "./registry.js";

/* ─────────────────────────  ELEMENTS  ──────────────────────────────── */

declare({
  id: "git.log",
  kind: "element",
  summary: "Read raw git log + diff stream from the working repo.",
  description:
    "Single-spawn `git log -p` reader. Returns commits with diff bodies " +
    "in chronological-newest-first order. Sub-linear in commit count " +
    "because git keeps its packfile cursor open across the walk.",
  inputs: { cwd: "string", maxCommits: "number?", since: "string?", pathPrefix: "string?" },
  output: "CommitWithDiff[]",
  cost: { io: "subprocess", cpu: "low", msP50: 50 },
  deterministic: true,
  sideEffect: "git",
  tags: ["git", "history", "scan"],
  modulePath: "../git/batch-log.js",
  exportName: "loadCommitsWithDiffs",
});

declare({
  id: "git.blame",
  kind: "element",
  summary: "Per-line blame for a file or line range.",
  description: "Wraps `git blame --porcelain` and parses author/timestamp/hash for each line.",
  inputs: { cwd: "string", file: "string", startLine: "number?", endLine: "number?" },
  output: "BlameLine[]",
  cost: { io: "subprocess", cpu: "low", msP50: 30 },
  deterministic: true,
  sideEffect: "git",
  tags: ["git", "history"],
  modulePath: "../git/blame.js",
  exportName: "blame",
});

declare({
  id: "git.grep",
  kind: "element",
  summary: "Multi-pattern fixed-string grep over the working tree.",
  description:
    "Wraps `git grep -F -f <patternfile>`. One subprocess regardless of " +
    "pattern count; uses git's internal Aho-Corasick automaton.",
  inputs: { cwd: "string", patterns: "string[]" },
  output: "GrepHit[]",
  cost: { io: "subprocess", cpu: "low", msP50: 40 },
  deterministic: true,
  sideEffect: "git",
  tags: ["git", "search"],
  // Note: head-verify currently inlines this; we'll extract it as a
  // first-class element in v0.41 once the compiler needs it.
});

declare({
  id: "embed.text",
  kind: "element",
  summary: "Convert text to a unit-norm Float32Array embedding.",
  description:
    "Auto-resolves the embedder ladder: OpenAI key → Ollama → bundled " +
    "WASM (MiniLM-L6-v2) → hash fallback. Returns the highest-quality " +
    "available without ever blocking the user.",
  inputs: { texts: "string[]", provider: "auto|ollama|openai|bundled|hash?" },
  output: "Float32Array[]",
  cost: { io: "cpu", cpu: "medium", msP50: 80 },
  deterministic: false,
  sideEffect: "network",
  tags: ["embed", "ml"],
  modulePath: "@mneme-ai/embeddings",
  exportName: "resolveEmbedder",
});

declare({
  id: "vector.cosine",
  kind: "element",
  summary: "Cosine similarity between two Float32Arrays (4-way unrolled).",
  description: "Generic cosine — recomputes both norms. For pre-normalised vectors use vector.dot-normalised (3× faster).",
  inputs: { a: "Float32Array", b: "Float32Array" },
  output: "number",
  cost: { io: "none", cpu: "trivial", msP50: 0.05 },
  deterministic: true,
  sideEffect: "none",
  tags: ["vector", "math"],
  modulePath: "../util/index.js",
  exportName: "cosineSim",
});

declare({
  id: "vector.dot-normalised",
  kind: "element",
  summary: "Dot product of two unit-norm vectors (skips 2 sqrts vs cosine).",
  description: "Use after normaliseInPlace() on stored vectors. 4-way unrolled; V8 autovectorises on AVX2/NEON.",
  inputs: { a: "Float32Array", b: "Float32Array" },
  output: "number",
  cost: { io: "none", cpu: "trivial", msP50: 0.02 },
  deterministic: true,
  sideEffect: "none",
  tags: ["vector", "math"],
  modulePath: "../util/index.js",
  exportName: "dotProductNormalized",
});

declare({
  id: "vector.normalise",
  kind: "element",
  summary: "L2-normalise a Float32Array in place.",
  description: "Mutates the input to unit-norm. Returns the same array for chaining.",
  inputs: { v: "Float32Array" },
  output: "Float32Array",
  cost: { io: "none", cpu: "trivial", msP50: 0.05 },
  deterministic: true,
  sideEffect: "none",
  tags: ["vector", "math"],
  modulePath: "../util/index.js",
  exportName: "normaliseInPlace",
});

declare({
  id: "pattern.regex",
  kind: "element",
  summary: "Match a regex pattern against a text body.",
  description: "Single regex.exec, returns first match (or null). Used inside higher-order rule scanners.",
  inputs: { text: "string", pattern: "RegExp" },
  output: "RegExpMatch?",
  cost: { io: "none", cpu: "trivial", msP50: 0.1 },
  deterministic: true,
  sideEffect: "none",
  tags: ["pattern", "scan"],
});

declare({
  id: "ast.evidence",
  kind: "element",
  summary: "Score the lexical context of a regex match (0..1).",
  description: "Classifies the surrounding source as logger-arg / db-sink / shell-sink / comment / string-literal / test-file / etc. The Bayesian filter's evidence half.",
  inputs: { source: "string", matchStart: "number", filePath: "string" },
  output: "EvidenceResult",
  cost: { io: "none", cpu: "low", msP50: 0.5 },
  deterministic: true,
  sideEffect: "none",
  tags: ["ast", "security", "scan"],
  modulePath: "../forensics/ast-evidence.js",
  exportName: "scoreEvidence",
});

declare({
  id: "stack.profile",
  kind: "element",
  summary: "Detect tech stack from package.json (workspaces-aware).",
  description: "Reads top-level + nested package.json files, returns a stack vector of boolean signals (hasSql, hasNestJS, hasJwt, etc.). The Bayesian filter's prior half.",
  inputs: { rootPath: "string" },
  output: "StackProfile",
  cost: { io: "fs", cpu: "low", msP50: 20 },
  deterministic: true,
  sideEffect: "filesystem",
  tags: ["stack", "security", "config"],
  modulePath: "../forensics/stack-priors.js",
  exportName: "detectStackProfile",
});

declare({
  id: "score.bayesian",
  kind: "element",
  summary: "Combine stack-prior × AST-evidence into a posterior.",
  description: "posterior = priorByStack(rule, profile) × evidenceScore(ast-context). The Bayesian reaction at the heart of the v0.37 vuln scanner.",
  inputs: { rule: "RuleId", stack: "StackProfile", evidenceScore: "number" },
  output: "number",
  cost: { io: "none", cpu: "trivial", msP50: 0.05 },
  deterministic: true,
  sideEffect: "none",
  tags: ["bayesian", "security", "scan"],
});

declare({
  id: "redact.secrets",
  kind: "element",
  summary: "Replace likely secrets in text with `[redacted]` markers.",
  description: "Pattern-based scrubber for AWS keys, GitHub tokens, JWTs, API-key envvar literals, etc. Used before any text is sent to a remote LLM.",
  inputs: { text: "string" },
  output: "string",
  cost: { io: "none", cpu: "low", msP50: 0.5 },
  deterministic: true,
  sideEffect: "none",
  tags: ["privacy", "security"],
  modulePath: "../util/redact.js",
});

declare({
  id: "concurrency.pmap",
  kind: "element",
  summary: "Bounded-concurrency parallel map (input order preserved).",
  description: "pMap(items, n, fn) — runs at most n fns concurrently, returns results in input order. The HPC-pass primitive used everywhere.",
  inputs: { items: "T[]", concurrency: "number", fn: "(item) => Promise<U>" },
  output: "U[]",
  cost: { io: "none", cpu: "trivial", msP50: 0.02 },
  deterministic: true,
  sideEffect: "none",
  tags: ["concurrency", "hpc"],
  modulePath: "../util/concurrency.js",
  exportName: "pMap",
});

declare({
  id: "karma.scan",
  kind: "element",
  summary: "Walk git history extracting TODO/FIXME/XXX/HACK debit/credit events.",
  description: "Uses one git log -p call. Each line addition with a marker = debit; each removal = credit. The flow data behind `mneme karma`.",
  inputs: { cwd: "string", maxCommits: "number?", since: "string?", pathPrefix: "string?" },
  output: "KarmaEvent[]",
  cost: { io: "subprocess", cpu: "low", msP50: 80 },
  deterministic: true,
  sideEffect: "git",
  tags: ["karma", "git", "scan"],
  modulePath: "../karma/scan.js",
  exportName: "scanKarma",
});

declare({
  id: "twin.profile",
  kind: "element",
  summary: "Compute an author's stylometric voice fingerprint.",
  description: "Subject-length distribution, conv-commit prefixes, top opening words, em-dash habit, lowercase preference, body-bullet usage. The DNA of how this author writes.",
  inputs: { cwd: "string", email: "string", maxCommits: "number?" },
  output: "AuthorVoice?",
  cost: { io: "subprocess", cpu: "low", msP50: 60 },
  deterministic: true,
  sideEffect: "git",
  tags: ["twin", "people", "stylometry"],
  modulePath: "../twin/profile.js",
  exportName: "profileAuthor",
});

/* ─────────────────────────────  ATOMS  ─────────────────────────────── */

declare({
  id: "git.log.recent",
  kind: "atom",
  summary: "git.log bound to the most-recent 90 days, no merges.",
  description: "Common case — used by atrophy, karma, regret-rate, and most temporal scanners.",
  inputs: { cwd: "string" },
  output: "CommitWithDiff[]",
  cost: { io: "subprocess", cpu: "low", msP50: 50 },
  deterministic: true,
  sideEffect: "git",
  tags: ["git", "history", "atom"],
  element: "git.log",
  bind: { since: "90 days ago", noMerges: true },
});

declare({
  id: "git.log.author",
  kind: "atom",
  summary: "git.log bound to a single author email.",
  description: "Used by passport, dna, cognitive-twin, and counterfactual.",
  inputs: { cwd: "string", email: "string", maxCommits: "number?" },
  output: "CommitWithDiff[]",
  cost: { io: "subprocess", cpu: "low", msP50: 50 },
  deterministic: true,
  sideEffect: "git",
  tags: ["git", "people", "atom"],
  element: "git.log",
  bind: { noMerges: true },
});

declare({
  id: "embed.batch",
  kind: "atom",
  summary: "Batched parallel embedding via concurrency.pmap.",
  description: "Splits a text array into 16-way parallel embedder calls. Sub-linear vs serial when the embedder is bundled WASM (which doesn't share state across calls).",
  inputs: { texts: "string[]", concurrency: "number?" },
  output: "Float32Array[]",
  cost: { io: "cpu", cpu: "medium", msP50: 120 },
  deterministic: false,
  sideEffect: "network",
  tags: ["embed", "atom", "hpc"],
  element: "embed.text",
  bind: { concurrency: 16 },
});

declare({
  id: "score.bayesian.tech-aware",
  kind: "atom",
  summary: "Bayesian score with stack profile + evidence in one call.",
  description: "Couples stack.profile + ast.evidence + score.bayesian — the public-facing call shape used by all rule evaluators.",
  inputs: { rule: "RuleId", source: "string", matchStart: "number", filePath: "string", stack: "StackProfile" },
  output: "{posterior: number, prior: number, evidence: EvidenceResult}",
  cost: { io: "none", cpu: "low", msP50: 1 },
  deterministic: true,
  sideEffect: "none",
  tags: ["bayesian", "security", "atom"],
  element: "score.bayesian",
  bind: {},
});

declare({
  id: "vector.search",
  kind: "atom",
  summary: "Top-k similarity search over a corpus of embeddings.",
  description: "Couples vector.dot-normalised + a sort + slice. Assumes the corpus has been pre-normalised — caller responsibility.",
  inputs: { query: "Float32Array", corpus: "Float32Array[]", k: "number" },
  output: "Array<{index: number, score: number}>",
  cost: { io: "none", cpu: "low", msP50: 5 },
  deterministic: true,
  sideEffect: "none",
  tags: ["vector", "search", "atom"],
  element: "vector.dot-normalised",
  bind: {},
});

/* ──────────────────────────  MOLECULES  ────────────────────────────── */

declare({
  id: "molecule.karma",
  kind: "molecule",
  summary: "Per-author TODO debt ledger with age-compounding.",
  description: "The molecule behind `mneme karma`. Composes karma.scan + a flow-aggregation reaction.",
  inputs: { cwd: "string", maxCommits: "number?", since: "string?" },
  output: "KarmaReport",
  cost: { io: "subprocess", cpu: "low", msP50: 100 },
  deterministic: true,
  sideEffect: "git",
  tags: ["karma", "originals", "molecule"],
  composes: ["karma.scan"],
  reactions: ["flow-aggregation", "log-age-weight"],
  modulePath: "../karma/index.js",
  exportName: "buildReport",
});

declare({
  id: "molecule.repo-mri",
  kind: "molecule",
  summary: "20-axis health diagnostic with z-scores against typical OSS.",
  description: "The molecule behind `mneme repo-mri`. Composes git.log, concurrency.pmap (file LOC reads), karma.scan, and a Z-score reaction.",
  inputs: { cwd: "string", maxCommits: "number?" },
  output: "ComputedAxes",
  cost: { io: "subprocess", cpu: "medium", msP50: 1000 },
  deterministic: true,
  sideEffect: "git",
  tags: ["repo-mri", "originals", "molecule"],
  composes: ["git.log", "concurrency.pmap", "karma.scan"],
  reactions: ["z-score-population"],
  modulePath: "../mri/index.js",
  exportName: "computeMri",
});
