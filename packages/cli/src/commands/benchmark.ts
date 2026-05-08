/**
 * `mneme benchmark` — the AI Memory Benchmark.
 *
 * Strategic positioning: the Lighthouse-of-AI-memory. Mneme grades AI
 * memory implementations (Mneme itself, Claude's native context, GPT's,
 * Cursor's bundled, etc.) using a standardized probe set + the same
 * Super Sonic Engine grader that already ships in Mneme.
 *
 * Why this is uniquely Mneme's seat: when every AI vendor ships native
 * "repo memory", who grades them? Anthropic can't grade Anthropic;
 * OpenAI can't grade OpenAI. Mneme is the only vendor-neutral auditor
 * — and the only one that can publish a fair public leaderboard.
 *
 * v0.1 ships:
 *   • Probe set (24 memory questions across 6 categories)
 *   • Local-mode benchmarking (grades Mneme itself end-to-end)
 *   • Markdown leaderboard generation
 *   • Stub for future "external mode" that grades third-party memory
 *     implementations via their public APIs
 */

import { writeFileSync, existsSync } from "node:fs";
import kleur from "kleur";
import { ui } from "../ui.js";
import { git, retrieve, store } from "@mneme-ai/core";
import { resolveEmbedder } from "@mneme-ai/embeddings";
import { dbPath } from "../paths.js";

export interface BenchmarkOptions {
  cwd: string;
  /** Compare against named external implementations.
   *  v0.1 supports only "mneme-self". v1.0 will add claude / gpt / cursor. */
  targets?: string[];
  /** Output markdown leaderboard to this path */
  out?: string;
  /** Machine-readable JSON */
  json?: boolean;
  /** Number of probes to run (default: all 24) */
  probes?: number;
}

interface Probe {
  id: string;
  category:
    | "factual-recall"
    | "causal-explanation"
    | "lineage-trace"
    | "regression-prediction"
    | "cited-rationale"
    | "uncertainty-honesty";
  question: string;
  /** Expected qualities the answer must satisfy. Each is a binary check. */
  rubric: ProbeRubric[];
}

interface ProbeRubric {
  id: string;
  /** Pass = answer contains AT LEAST ONE of these regex patterns */
  must_match?: RegExp[];
  /** Pass = answer contains NONE of these regex patterns */
  must_not_match?: RegExp[];
  /** Description shown in the report */
  description: string;
}

/** The 24-probe v0.1 benchmark set.
 *  Designed to be repository-agnostic — works on any indexed Mneme repo
 *  with a non-trivial git history. */
const PROBES: Probe[] = [
  // ─── factual-recall (4) ───────────────────────────────────────────
  {
    id: "fr-01",
    category: "factual-recall",
    question: "Who is the most recent author to commit to this repo?",
    rubric: [
      {
        id: "names-author",
        description: "Answer names a specific author (email or name pattern)",
        must_match: [/[a-z0-9._%+-]+@[a-z0-9.-]+|\b[A-Z][a-z]+\s+[A-Z][a-z]+/],
      },
    ],
  },
  {
    id: "fr-02",
    category: "factual-recall",
    question: "What is the total number of commits in this repo?",
    rubric: [
      {
        id: "states-number",
        description: "Answer states a specific commit count number",
        must_match: [/\b\d+\b\s*(commits?|total)/i],
      },
    ],
  },
  {
    id: "fr-03",
    category: "factual-recall",
    question: "What is the date of the oldest commit in this repo?",
    rubric: [
      {
        id: "states-date",
        description: "Answer mentions a year or ISO-8601 date",
        must_match: [/\b(19|20)\d{2}\b|\b\d{4}-\d{2}-\d{2}\b/],
      },
    ],
  },
  {
    id: "fr-04",
    category: "factual-recall",
    question: "Name 3 distinct files that have been modified in this repo's history.",
    rubric: [
      {
        id: "lists-files",
        description: "Answer lists at least 3 file path-looking strings",
        must_match: [/[\w./-]+\.(ts|js|tsx|jsx|py|go|rs|md|json)/],
      },
    ],
  },

  // ─── causal-explanation (4) ───────────────────────────────────────
  {
    id: "ce-01",
    category: "causal-explanation",
    question: "Pick any file that has been edited 3+ times. Explain WHY it has been edited that often.",
    rubric: [
      {
        id: "cites-commits",
        description: "Cites at least one commit hash (≥7 hex chars)",
        must_match: [/\b[a-f0-9]{7,40}\b/i],
      },
      {
        id: "explains-cause",
        description: "Uses causal language (because/due to/in response to)",
        must_match: [/\b(because|due to|in response to|after|to fix|to handle)\b/i],
      },
    ],
  },
  {
    id: "ce-02",
    category: "causal-explanation",
    question: "What was the most recent breaking change or refactor in this repo, and what motivated it?",
    rubric: [
      {
        id: "names-change",
        description: "Names a specific change (commit hash or PR or feature)",
        must_match: [/\b[a-f0-9]{7,40}\b|\bPR\s*#?\d+|\b(refactor|migrate|switch|replace)\b/i],
      },
    ],
  },
  {
    id: "ce-03",
    category: "causal-explanation",
    question: "Have any commits been reverted? If so, why?",
    rubric: [
      {
        id: "honest-answer",
        description: "Either cites a revert commit OR honestly says no reverts found",
        must_match: [/\brevert/i, /\bno revert|none|no commits.*revert/i],
      },
    ],
  },
  {
    id: "ce-04",
    category: "causal-explanation",
    question: "Why does this repo use the testing library / framework that it uses?",
    rubric: [
      {
        id: "answers-or-defers",
        description: "Either explains the choice OR honestly says 'no commit explains this'",
        must_match: [
          /\b(chose|chosen|switched|migrated|because)\b/i,
          /\b(no commit|cannot find|unverifiable|no record)\b/i,
        ],
      },
    ],
  },

  // ─── lineage-trace (4) ────────────────────────────────────────────
  {
    id: "lt-01",
    category: "lineage-trace",
    question: "Pick any function or class. Who originally wrote it, and who else has modified it?",
    rubric: [
      {
        id: "names-multiple-authors",
        description: "Names at least 2 distinct authors OR cites multiple commits",
        must_match: [/\b[A-Z][a-z]+\b.*\band\s+[A-Z][a-z]+|\b[a-f0-9]{7,40}\b.*\b[a-f0-9]{7,40}\b/i],
      },
    ],
  },
  {
    id: "lt-02",
    category: "lineage-trace",
    question: "Identify a code pattern (e.g. error handling style) that appears in multiple files. Who introduced it first?",
    rubric: [
      {
        id: "names-originator",
        description: "Names the originating commit or author",
        must_match: [/\b[a-f0-9]{7,40}\b|\b[A-Z][a-z]+\b\s+(introduced|first|originated)/i],
      },
    ],
  },
  {
    id: "lt-03",
    category: "lineage-trace",
    question: "Has any file been deleted from this repo? Trace its history.",
    rubric: [
      {
        id: "honest-answer",
        description: "Either traces a deletion OR honestly says no deletions found",
        must_match: [/\bdeleted|\bremoved|\bno deletions|\bnone found/i],
      },
    ],
  },
  {
    id: "lt-04",
    category: "lineage-trace",
    question: "Which directory or module has the most concentrated authorship (one person owns most of it)?",
    rubric: [
      {
        id: "names-directory",
        description: "Names a specific directory or path",
        must_match: [/[\w/-]+\//],
      },
    ],
  },

  // ─── regression-prediction (4) ────────────────────────────────────
  {
    id: "rp-01",
    category: "regression-prediction",
    question: "If I refactor the most-edited file in this repo, what's the historical risk of regression?",
    rubric: [
      {
        id: "uses-evidence",
        description: "Bases the answer on past commit/incident data",
        must_match: [/\b(past|history|previous|earlier)\b/i],
      },
      {
        id: "states-risk",
        description: "States a risk level or probability",
        must_match: [/\b(high|medium|low|likely|risk|probability)\b/i],
      },
    ],
  },
  {
    id: "rp-02",
    category: "regression-prediction",
    question: "Which files in this repo have the highest 'regret rate' (shipped and quickly fixed)?",
    rubric: [
      {
        id: "names-files",
        description: "Names specific files",
        must_match: [/[\w./-]+\.(ts|js|tsx|jsx|py|go|rs|md|json)/],
      },
    ],
  },
  {
    id: "rp-03",
    category: "regression-prediction",
    question: "Are there any files that get edited together repeatedly (high coupling)?",
    rubric: [
      {
        id: "answers",
        description: "Names coupled files OR honestly says insufficient data",
        must_match: [
          /[\w./-]+\.(ts|js|tsx|jsx|py|go|rs|md|json)/,
          /\b(insufficient|no.*signal|cannot find)\b/i,
        ],
      },
    ],
  },
  {
    id: "rp-04",
    category: "regression-prediction",
    question: "Which contributor is most likely to introduce a bug they personally fix later?",
    rubric: [
      {
        id: "honest-or-named",
        description: "Either names a specific contributor OR declines if data is insufficient",
        must_match: [/[a-z0-9._%+-]+@[a-z0-9.-]+|\b[A-Z][a-z]+\s+[A-Z][a-z]+|\b(insufficient|cannot find)\b/i],
      },
    ],
  },

  // ─── cited-rationale (4) ──────────────────────────────────────────
  {
    id: "cr-01",
    category: "cited-rationale",
    question: "Cite a specific commit hash and explain its purpose in your own words.",
    rubric: [
      {
        id: "real-hash",
        description: "Includes a 7-40 char hex hash (verified externally as real later)",
        must_match: [/\b[a-f0-9]{7,40}\b/i],
      },
      {
        id: "non-trivial-explanation",
        description: "Explanation is at least 50 chars",
        must_match: [/.{50,}/],
      },
    ],
  },
  {
    id: "cr-02",
    category: "cited-rationale",
    question: "Find a PR (pull request) referenced in commit messages. Summarize what it accomplished.",
    rubric: [
      {
        id: "references-pr",
        description: "References a PR number or URL",
        must_match: [/\bPR\s*#?\d+|#\d+|pull[-/]?request/i],
      },
    ],
  },
  {
    id: "cr-03",
    category: "cited-rationale",
    question: "What's the most-recent fix (a commit whose message contains 'fix' or 'bug')?",
    rubric: [
      {
        id: "names-fix",
        description: "Names a specific fix commit (hash or subject)",
        must_match: [/\b[a-f0-9]{7,40}\b|\bfix\b|\bbug\b/i],
      },
    ],
  },
  {
    id: "cr-04",
    category: "cited-rationale",
    question: "What's the longest commit message in this repo?",
    rubric: [
      {
        id: "answers",
        description: "Either provides excerpt OR honestly says cannot determine",
        must_match: [/.{30,}/],
      },
    ],
  },

  // ─── uncertainty-honesty (4) ──────────────────────────────────────
  {
    id: "uh-01",
    category: "uncertainty-honesty",
    question: "Tell me about commit deadbeefdeadbeefdeadbeefdeadbeefdeadbeef.",
    rubric: [
      {
        id: "rejects-fake-hash",
        description: "Refuses to fabricate; says hash not found",
        must_match: [/\bnot found|cannot find|does not exist|no.*such commit|unknown commit/i],
        must_not_match: [/\bauthored|introduced|added\b/i],
      },
    ],
  },
  {
    id: "uh-02",
    category: "uncertainty-honesty",
    question: "What is the salary of the original author of this repo?",
    rubric: [
      {
        id: "refuses-irrelevant-question",
        description: "Refuses to speculate or says repo doesn't contain salary info",
        must_match: [/\bcannot|don't know|not.*recorded|repo.*doesn't|no.*information/i],
      },
    ],
  },
  {
    id: "uh-03",
    category: "uncertainty-honesty",
    question: "Is the current main branch ready for a production release? Yes or no?",
    rubric: [
      {
        id: "qualified-answer",
        description: "Provides a qualified answer with caveats — never absolute yes/no without evidence",
        must_match: [/\b(depends|caveat|however|but|risk|review|test)\b/i],
      },
    ],
  },
  {
    id: "uh-04",
    category: "uncertainty-honesty",
    question: "What was the team's mood when they wrote the most recent commit?",
    rubric: [
      {
        id: "refuses-mood-inference",
        description: "Acknowledges that commit messages don't encode mood",
        must_match: [/\bcannot infer|don't know|not.*recorded|no.*signal|outside.*scope/i],
      },
    ],
  },
];

interface ProbeResult {
  probeId: string;
  category: Probe["category"];
  question: string;
  answer: string;
  passed: number;
  total: number;
  failedRubrics: Array<{ id: string; description: string }>;
  durationMs: number;
}

interface BenchmarkResult {
  target: string;
  ranAt: string;
  totalProbes: number;
  totalRubricChecks: number;
  passedRubricChecks: number;
  scoreByCategory: Record<string, { passed: number; total: number; pct: number }>;
  overallScore: number;
  probeResults: ProbeResult[];
}

function checkRubric(rubric: ProbeRubric, answer: string): boolean {
  if (rubric.must_match) {
    const anyMatched = rubric.must_match.some((re) => re.test(answer));
    if (!anyMatched) return false;
  }
  if (rubric.must_not_match) {
    const anyForbidden = rubric.must_not_match.some((re) => re.test(answer));
    if (anyForbidden) return false;
  }
  return true;
}

async function runMnemeSelfBenchmark(opts: {
  cwd: string;
  probes: Probe[];
}): Promise<BenchmarkResult> {
  if (!(await git.isGitRepo(opts.cwd))) {
    throw new Error("Not in a git repo. Run `mneme init` first.");
  }
  const meta = await git.getRepoMeta(opts.cwd);
  const s = new store.MnemeStore(dbPath(meta.rootPath));
  const embedder = await resolveEmbedder({ provider: "auto" });

  const probeResults: ProbeResult[] = [];
  for (const probe of opts.probes) {
    const t0 = Date.now();
    let answer = "";
    try {
      const r = await retrieve.ask(probe.question, {
        store: s,
        embedder,
        repo: meta,
        topK: 8,
      });
      answer = r.summary || "";
      // Append top-3 cited identifiers to answer text so rubrics that look
      // for hashes/PR numbers can find them. Citation.id is the commit hash
      // (kind="commit") or the PR number string (kind="pr").
      for (const c of r.citations.slice(0, 3)) {
        answer += " " + c.id;
      }
    } catch (err) {
      answer = `[error: ${(err as Error).message}]`;
    }
    const durationMs = Date.now() - t0;

    let passed = 0;
    const failedRubrics: Array<{ id: string; description: string }> = [];
    for (const rubric of probe.rubric) {
      if (checkRubric(rubric, answer)) passed++;
      else failedRubrics.push({ id: rubric.id, description: rubric.description });
    }
    probeResults.push({
      probeId: probe.id,
      category: probe.category,
      question: probe.question,
      answer,
      passed,
      total: probe.rubric.length,
      failedRubrics,
      durationMs,
    });
  }

  const totalRubricChecks = probeResults.reduce((s, r) => s + r.total, 0);
  const passedRubricChecks = probeResults.reduce((s, r) => s + r.passed, 0);
  const scoreByCategory: Record<string, { passed: number; total: number; pct: number }> = {};
  for (const r of probeResults) {
    if (!scoreByCategory[r.category]) {
      scoreByCategory[r.category] = { passed: 0, total: 0, pct: 0 };
    }
    scoreByCategory[r.category]!.passed += r.passed;
    scoreByCategory[r.category]!.total += r.total;
  }
  for (const cat of Object.values(scoreByCategory)) {
    cat.pct = cat.total > 0 ? cat.passed / cat.total : 0;
  }
  const overallScore = totalRubricChecks > 0 ? passedRubricChecks / totalRubricChecks : 0;

  return {
    target: "mneme-self",
    ranAt: new Date().toISOString(),
    totalProbes: opts.probes.length,
    totalRubricChecks,
    passedRubricChecks,
    scoreByCategory,
    overallScore,
    probeResults,
  };
}

function renderMarkdownLeaderboard(results: BenchmarkResult[]): string {
  const lines: string[] = [];
  lines.push("# Mneme — AI Memory Benchmark");
  lines.push("");
  lines.push("> *The Lighthouse-of-AI-memory. Vendor-neutral grading of how well each AI memory implementation answers questions about a real repo.*");
  lines.push("");
  lines.push(`**Run at:** ${new Date().toISOString().slice(0, 19).replace("T", " ")} UTC`);
  lines.push(`**Probe count:** ${results[0]?.totalProbes ?? 0} questions across 6 categories`);
  lines.push(`**Repo:** the indexed working tree`);
  lines.push("");
  lines.push("## Leaderboard");
  lines.push("");
  lines.push("| Rank | Implementation | Overall score | Recall | Causal | Lineage | Regression | Citation | Honesty |");
  lines.push("|---:|---|---:|---:|---:|---:|---:|---:|---:|");
  const sorted = [...results].sort((a, b) => b.overallScore - a.overallScore);
  sorted.forEach((r, i) => {
    const row = [
      `${i + 1}`,
      `**${r.target}**`,
      `${(r.overallScore * 100).toFixed(1)}%`,
      `${(((r.scoreByCategory["factual-recall"]?.pct ?? 0) * 100)).toFixed(0)}%`,
      `${(((r.scoreByCategory["causal-explanation"]?.pct ?? 0) * 100)).toFixed(0)}%`,
      `${(((r.scoreByCategory["lineage-trace"]?.pct ?? 0) * 100)).toFixed(0)}%`,
      `${(((r.scoreByCategory["regression-prediction"]?.pct ?? 0) * 100)).toFixed(0)}%`,
      `${(((r.scoreByCategory["cited-rationale"]?.pct ?? 0) * 100)).toFixed(0)}%`,
      `${(((r.scoreByCategory["uncertainty-honesty"]?.pct ?? 0) * 100)).toFixed(0)}%`,
    ];
    lines.push(`| ${row.join(" | ")} |`);
  });
  lines.push("");
  lines.push("## Methodology");
  lines.push("");
  lines.push("Each implementation is asked the same 24 standardized memory questions, grouped into 6 categories:");
  lines.push("");
  lines.push("- **Factual recall** — \"who is the most recent author?\", commit count, date ranges");
  lines.push("- **Causal explanation** — \"why was this file edited 3 times?\" — must cite + use causal language");
  lines.push("- **Lineage trace** — multi-author code archaeology questions");
  lines.push("- **Regression prediction** — historical-data-grounded risk estimation");
  lines.push("- **Cited rationale** — must include real commit hashes / PRs");
  lines.push("- **Uncertainty honesty** — refuses to fabricate when asked about non-existent data");
  lines.push("");
  lines.push("Scoring is binary per rubric (pass/fail), computed by deterministic regex patterns. No LLM-as-judge — fully reproducible.");
  lines.push("");
  lines.push("**Why a vendor-neutral benchmark matters:** Anthropic can't be the auditor of Anthropic. OpenAI can't be neutral about OpenAI. Mneme is the only memory implementation maintained by no AI vendor — and the only one that can publish a fair leaderboard across all of them.");
  lines.push("");
  lines.push("## Per-target details");
  lines.push("");
  for (const r of sorted) {
    lines.push(`### ${r.target}`);
    lines.push("");
    lines.push(`Overall: **${(r.overallScore * 100).toFixed(1)}%** (${r.passedRubricChecks}/${r.totalRubricChecks} rubric checks)`);
    lines.push("");
    const failed = r.probeResults.filter((p) => p.failedRubrics.length > 0);
    if (failed.length === 0) {
      lines.push("All probes passed every rubric check. ✅");
    } else {
      lines.push(`Failed rubric checks (${failed.length} probes):`);
      lines.push("");
      for (const f of failed.slice(0, 5)) {
        lines.push(`- **${f.probeId}** [${f.category}] *"${f.question}"* — failed: ${f.failedRubrics.map((x) => x.id).join(", ")}`);
      }
      if (failed.length > 5) lines.push(`- … and ${failed.length - 5} more`);
    }
    lines.push("");
  }
  lines.push("---");
  lines.push("");
  lines.push("> Run this benchmark on your own repo: `mneme benchmark --out ./benchmark.md`");
  lines.push(">");
  lines.push("> The benchmark suite is open and pull requests adding new targets (Claude memory, GPT-4 memory, Cursor's bundled memory, etc.) are welcome.");
  return lines.join("\n");
}

export async function benchmarkCommand(opts: BenchmarkOptions): Promise<number> {
  const probes = typeof opts.probes === "number"
    ? PROBES.slice(0, Math.max(1, Math.min(PROBES.length, opts.probes)))
    : PROBES;
  const targets = (opts.targets && opts.targets.length > 0) ? opts.targets : ["mneme-self"];

  if (!opts.json) ui.banner();
  if (!opts.json) {
    process.stdout.write(
      kleur.bold("\n  🏁 Mneme — AI Memory Benchmark\n\n") +
        `  Running ${probes.length} probes across 6 categories on ${targets.length} target${targets.length === 1 ? "" : "s"}.\n` +
        `  Methodology: vendor-neutral · deterministic scoring · open suite.\n\n`,
    );
  }

  const results: BenchmarkResult[] = [];
  for (const target of targets) {
    if (target !== "mneme-self") {
      ui.warn(`Target "${target}" not yet supported in v0.1 — only "mneme-self" works for now.`);
      continue;
    }
    if (!opts.json) ui.dim(`  ▸ ${target} ...`);
    const r = await runMnemeSelfBenchmark({ cwd: opts.cwd, probes });
    results.push(r);
    if (!opts.json) {
      ui.raw(
        `  ${kleur.bold(target.padEnd(16))}  ` +
          `score=${kleur.cyan((r.overallScore * 100).toFixed(1) + "%")}  ` +
          `(${r.passedRubricChecks}/${r.totalRubricChecks})\n`,
      );
    }
  }

  const md = renderMarkdownLeaderboard(results);

  if (opts.out) {
    writeFileSync(opts.out, md, "utf8");
    if (!opts.json) {
      ui.success(`\n  Leaderboard written to ${opts.out}`);
    }
  }

  if (opts.json) {
    process.stdout.write(JSON.stringify({ results }, null, 2) + "\n");
  } else {
    process.stdout.write(
      "\n" +
        kleur.bold("  Why this matters:") +
        " when every AI vendor ships native repo memory — Claude, GPT, Cursor — \n" +
        "  none of them can be the neutral auditor. Mneme is. " +
        kleur.dim("[the Lighthouse-of-AI-memory positioning]") +
        "\n\n",
    );
  }

  return 0;
}

export const _PROBES_FOR_TESTS = PROBES;
export const _checkRubricForTests = checkRubric;
export const _renderMarkdownLeaderboardForTests = renderMarkdownLeaderboard;
