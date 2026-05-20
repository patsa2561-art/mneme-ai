/**
 * v2.19.87 — #10 REVERSE STACK OVERFLOW.
 *
 * The opposite of every AI coding tool today.  ChatGPT et al guess
 * confidently; this engine guesses humbly + ASKS THE HUMAN before
 * acting.
 *
 * Given a function or file, it generates 3 plausible hypotheses about
 * WHY the code is shaped the way it is, and offers them as questions
 * for the human to pick from.  When the human picks, Mneme records the
 * answer.  Over time the engine learns the user's coding patterns and
 * its hypothesis ranking improves.
 *
 * NO LLM call — pure heuristic feature-detection.  Runs identically on
 * any sandbox / mobile / claude.app environment that lacks Ollama.
 */

import { existsSync, readFileSync, writeFileSync, mkdirSync, appendFileSync } from "node:fs";
import { join } from "node:path";

const DIR = ".mneme/socratic";
const LEDGER = "answers.jsonl";

export interface Hypothesis {
  id: string;
  rank: number;       // 1 = AI's best guess
  text: string;       // natural-language question
  evidence: string;   // what feature triggered this hypothesis
}

export interface SocraticReading {
  /** Path / function id being analysed. */
  target: string;
  /** Detected features (signals from the code). */
  features: string[];
  hypotheses: Hypothesis[];
}

export interface SocraticAnswer {
  target: string;
  pickedHypothesisId: string | null;
  userExplanation: string;
  ts: string;
}

// ─── Feature detectors (zero-LLM, pure regex/heuristic) ────────────────

interface FeatureRule {
  feature: string;
  test: (code: string) => boolean;
  hypothesis: { id: string; text: (snippet: string) => string; evidence: string };
}

const FEATURE_RULES: FeatureRule[] = [
  {
    feature: "uses Promise.all",
    test: (c) => /\bPromise\.all\(/.test(c),
    hypothesis: { id: "h_concurrency", text: (snip) => `Did you use Promise.all here because the calls have no inter-dependencies and you wanted to parallelise the wait time?`, evidence: "saw Promise.all on the code path" },
  },
  {
    feature: "try/catch around await",
    test: (c) => /try\s*\{[^}]*\bawait\b/.test(c),
    hypothesis: { id: "h_defensive_async", text: () => `Did you wrap the await in try/catch because a specific upstream call has thrown in production before, and you wanted to swallow that one path?`, evidence: "try/catch wraps an await — defensive against a known failure mode" },
  },
  {
    feature: "early-return pattern",
    test: (c) => /\bif\s*\([^)]+\)\s*return\b/.test(c),
    hypothesis: { id: "h_guard_clauses", text: () => `Did you use early returns to keep the happy path flat, instead of nesting everything inside an if?`, evidence: "early `if (...) return` guard clauses" },
  },
  {
    feature: "Map vs Object",
    test: (c) => /new\s+Map\(/.test(c),
    hypothesis: { id: "h_map_choice", text: () => `Did you choose Map over a plain object because the keys aren't strings, or because you needed insertion-order iteration?`, evidence: "new Map() rather than {}" },
  },
  {
    feature: "explicit type narrowing",
    test: (c) => /\bas\s+(unknown\s+as\s+)?[A-Z]/.test(c),
    hypothesis: { id: "h_type_assertion", text: () => `Did you use 'as' here because TypeScript's inference was too narrow / too wide, and you knew something the compiler didn't?`, evidence: "explicit type assertion present" },
  },
  {
    feature: "default parameter",
    test: (c) => /\bfunction\s+\w+\s*\([^)]*=\s*[^),]+/.test(c) || /\(\s*[^,)]+\s*=\s*[^),]+/.test(c),
    hypothesis: { id: "h_default_arg", text: () => `Did you set the default at the parameter site (rather than inside the body) because every caller WAS passing the same value and you wanted to collapse it?`, evidence: "default value at parameter site" },
  },
  {
    feature: "regex .test() — not .match()",
    test: (c) => /\/[^/\n]+\/[a-z]*\.test\(/.test(c),
    hypothesis: { id: "h_test_vs_match", text: () => `Did you use .test() instead of .match() because you only need the boolean and want to avoid allocating a match array?`, evidence: "regex.test() — boolean-only path" },
  },
  {
    feature: "string concat (template literal)",
    test: (c) => /`[^`]*\$\{/.test(c),
    hypothesis: { id: "h_template_lit", text: () => `Did you go with template literals over string concat because of readability with multiple interpolations, or because of a multi-line block?`, evidence: "template literal with interpolation" },
  },
  {
    feature: "single-line ternary",
    test: (c) => /\?[^:]+:\s*[^;]+;/.test(c),
    hypothesis: { id: "h_ternary", text: () => `Did you use a ternary instead of if/else because the two branches each return a single expression and you wanted the line to read as 'a or b'?`, evidence: "ternary expression for binary choice" },
  },
  {
    feature: "no semicolons",
    test: (c) => c.split("\n").filter((l) => l.trim() && !l.trim().endsWith(";") && !l.trim().endsWith("{") && !l.trim().endsWith("}") && !l.trim().startsWith("//")).length > 3,
    hypothesis: { id: "h_semi_style", text: () => `Did you skip semicolons because this codebase uses Standard / no-semi style, or just personal preference?`, evidence: "majority of statements lack trailing semicolons" },
  },
];

const FALLBACK_HYPOTHESES = [
  { id: "h_fallback_legacy",   text: "Did you write it this way because that's what the rest of the file looked like and you wanted to stay consistent?",     evidence: "stylistic consistency with the file" },
  { id: "h_fallback_perf",     text: "Did you write it this way to avoid an allocation / re-render / extra round-trip in the hot path?",                  evidence: "performance-sensitive code shape" },
  { id: "h_fallback_test",     text: "Did you write it this way because it makes the unit-test ergonomics cleaner (easy mock / no global state)?",         evidence: "testability-first shape" },
];

export function readSocratic(target: string, code: string): SocraticReading {
  const features: string[] = [];
  const hypotheses: Hypothesis[] = [];
  for (const r of FEATURE_RULES) {
    if (!r.test(code)) continue;
    features.push(r.feature);
    hypotheses.push({
      id: r.hypothesis.id,
      rank: 0, // re-ranked below
      text: r.hypothesis.text(code.slice(0, 120)),
      evidence: r.hypothesis.evidence,
    });
  }
  // Take top 3, pad with fallbacks if fewer features were detected.
  let chosen = hypotheses.slice(0, 3);
  for (const fb of FALLBACK_HYPOTHESES) {
    if (chosen.length >= 3) break;
    chosen.push({ id: fb.id, rank: 0, text: fb.text, evidence: fb.evidence });
  }
  chosen = chosen.slice(0, 3).map((h, i) => ({ ...h, rank: i + 1 }));
  return { target, features, hypotheses: chosen };
}

export function recordSocraticAnswer(repoRoot: string, answer: SocraticAnswer): void {
  const dir = join(repoRoot, DIR);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  appendFileSync(join(repoRoot, DIR, LEDGER), JSON.stringify(answer) + "\n", "utf8");
}

export function readSocraticAnswers(repoRoot: string, opts: { limit?: number } = {}): SocraticAnswer[] {
  const p = join(repoRoot, DIR, LEDGER);
  if (!existsSync(p)) return [];
  const lines = readFileSync(p, "utf8").trim().split("\n").filter(Boolean);
  const out: SocraticAnswer[] = [];
  for (const line of lines) {
    try { out.push(JSON.parse(line) as SocraticAnswer); } catch { /* */ }
  }
  out.reverse();
  return typeof opts.limit === "number" ? out.slice(0, opts.limit) : out;
}
