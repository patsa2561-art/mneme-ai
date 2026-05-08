/**
 * AI-Memory-Bench — the first reproducible benchmark for "AI memory layers".
 *
 * Question we answer with numbers, not vibes:
 *   "Does Mneme actually reduce hallucination, and by how much?"
 *
 * The benchmark runs N probes against an AI client. Each probe has a
 * verifiable expected behaviour (commit hash exists, author is correct,
 * file path resolves, etc.). We measure 3 hallucination categories:
 *
 *   • CITATION-HALLUCINATION  — AI cited a commit hash that doesn't exist
 *   • ATTRIBUTION-HALLUCINATION — AI named the wrong author
 *   • API-HALLUCINATION        — AI invoked a function/path that isn't real
 *
 * Score = 1 - (hallucinations / total_claims). Higher is better.
 * Also tracks: groundedness (claims with citations) and coverage
 * (probes the AI even attempted).
 *
 * Wisdom check (world-class?): YES.
 *   • Reproducible — every probe declares its verifier function.
 *   • AI-agnostic — works with any client that responds to text prompts.
 *   • Measurable — produces numerical scores with confidence intervals.
 *   • Open data — probe corpus is checked into git.
 *   • Wilson lower bound used for small samples (statistical rigour).
 */

import { spawnSync } from "node:child_process";

export type ProbeCategory = "citation" | "attribution" | "api" | "regret" | "decision";

export interface Probe {
  /** Unique id (file-system safe) */
  id: string;
  /** Category — drives which scorer fires */
  category: ProbeCategory;
  /** The question to ask the AI */
  question: string;
  /** Optional repo-specific context the AI gets */
  context?: string;
  /** Verifier — given the AI's answer, returns score 0..1 + breakdown */
  verify: (answer: string, repoRoot: string) => Promise<ProbeScore>;
  /** Tags (e.g., "v1.10", "regression") */
  tags?: string[];
}

export interface ProbeScore {
  /** 0..1 — fraction of claims that resolve to ground truth */
  score: number;
  /** Total claims the AI made */
  totalClaims: number;
  /** Claims that resolved to real artifacts */
  resolvedClaims: number;
  /** Claims that hallucinated */
  hallucinatedClaims: number;
  /** Per-claim breakdown (claim text → resolved boolean) */
  detail: Array<{ claim: string; resolved: boolean; reason?: string }>;
}

export interface BenchRunResult {
  probesTotal: number;
  probesAttempted: number;
  probesPassed: number; // score >= 0.9
  hallucinationRate: number; // 0..1
  perCategory: Record<ProbeCategory, { tried: number; mean: number }>;
  /** Wilson 95% lower bound on overall score (small-sample safe) */
  wilsonLowerBound: number;
  /** Per-probe scores for downstream analysis */
  detail: Array<{ probeId: string; category: ProbeCategory; score: ProbeScore }>;
}

/** Standard verifier: every commit-hash-shaped string in the AI answer
 *  is checked via `git rev-parse --verify`. */
export async function verifyCitationHashes(answer: string, repoRoot: string): Promise<ProbeScore> {
  const hashes = Array.from(new Set(answer.match(/\b[a-f0-9]{7,40}\b/gi) ?? []));
  const detail: ProbeScore["detail"] = [];
  let resolved = 0;
  for (const h of hashes) {
    const r = spawnSync("git", ["rev-parse", "--verify", h], { cwd: repoRoot, stdio: "pipe" });
    const ok = r.status === 0;
    if (ok) resolved += 1;
    detail.push({ claim: h, resolved: ok, reason: ok ? "exists" : "no such commit" });
  }
  const total = hashes.length;
  return {
    score: total === 0 ? 1 : resolved / total,
    totalClaims: total,
    resolvedClaims: resolved,
    hallucinatedClaims: total - resolved,
    detail,
  };
}

/** Standard verifier: every file path mentioned is checked for existence. */
export async function verifyApiPaths(answer: string, repoRoot: string): Promise<ProbeScore> {
  const fs = await import("node:fs");
  const path = await import("node:path");
  // Match plausible file paths: src/foo/bar.ts, packages/x/y.js, etc.
  const paths = Array.from(new Set(answer.match(/\b(?:src|packages|lib|app|tests?)\/[a-zA-Z0-9_\-./]+\.(?:ts|tsx|js|jsx|py|rs|go|java|rb|php)\b/g) ?? []));
  const detail: ProbeScore["detail"] = [];
  let resolved = 0;
  for (const p of paths) {
    const full = path.join(repoRoot, p);
    const ok = fs.existsSync(full);
    if (ok) resolved += 1;
    detail.push({ claim: p, resolved: ok, reason: ok ? "exists" : "path not found" });
  }
  const total = paths.length;
  return {
    score: total === 0 ? 1 : resolved / total,
    totalClaims: total,
    resolvedClaims: resolved,
    hallucinatedClaims: total - resolved,
    detail,
  };
}

/** Standard verifier: every "Author Name" claim is checked against
 *  git log --format='%an' for the cited commit hash.
 *  Matches patterns like "<hash>: by <Name>" or "<hash> by <Name>".
 */
export async function verifyAttribution(answer: string, repoRoot: string): Promise<ProbeScore> {
  // Two-step: extract hash → author candidate windows (lookahead simpler than one big regex)
  const re = /([a-f0-9]{7,40})[\s,:;—-]+by\s+([A-Z][A-Za-z]+(?:\s+[A-Z][A-Za-z]+){0,2})/g;
  const claims = Array.from(answer.matchAll(re));
  const detail: ProbeScore["detail"] = [];
  let resolved = 0;
  for (const m of claims) {
    const hash = m[1]!;
    const claimedAuthor = m[2]!.trim();
    const r = spawnSync("git", ["log", "-1", "--format=%an", hash], { cwd: repoRoot, stdio: "pipe" });
    const real = r.stdout.toString().trim();
    // Match if every claimed name token appears in the real author name.
    const match = real.length > 0 && claimedAuthor.toLowerCase().split(/\s+/).every((tok) => real.toLowerCase().includes(tok));
    if (match) resolved += 1;
    detail.push({
      claim: `${hash}: by ${claimedAuthor}`,
      resolved: match,
      reason: match ? "matches git log" : `actual author: ${real || "(unknown commit)"}`,
    });
  }
  const total = claims.length;
  return {
    score: total === 0 ? 1 : resolved / total,
    totalClaims: total,
    resolvedClaims: resolved,
    hallucinatedClaims: total - resolved,
    detail,
  };
}

/** Wilson 95% lower-bound confidence interval on a proportion.
 *  Same statistic Reddit + Hacker News use for small-sample voting. */
export function wilsonLowerBound(positive: number, total: number, z = 1.96): number {
  if (total === 0) return 0;
  const phat = positive / total;
  const denom = 1 + (z * z) / total;
  const numer = phat + (z * z) / (2 * total) - z * Math.sqrt((phat * (1 - phat) + (z * z) / (4 * total)) / total);
  return numer / denom;
}

/**
 * Run a list of probes against pre-collected answers (offline mode).
 * Each answer string corresponds to a probe by id.
 */
export async function runBench(
  probes: Probe[],
  answers: Record<string, string>,
  repoRoot: string,
): Promise<BenchRunResult> {
  const detail: BenchRunResult["detail"] = [];
  const perCategory: Record<string, { tried: number; sum: number }> = {};

  let totalPassed = 0;
  let totalAttempted = 0;
  let totalClaims = 0;
  let totalResolved = 0;

  for (const probe of probes) {
    const answer = answers[probe.id];
    if (answer === undefined) continue;
    totalAttempted += 1;
    const score = await probe.verify(answer, repoRoot);
    detail.push({ probeId: probe.id, category: probe.category, score });
    if (score.score >= 0.9) totalPassed += 1;
    totalClaims += score.totalClaims;
    totalResolved += score.resolvedClaims;
    perCategory[probe.category] = perCategory[probe.category] ?? { tried: 0, sum: 0 };
    perCategory[probe.category]!.tried += 1;
    perCategory[probe.category]!.sum += score.score;
  }

  const perCategoryOut: BenchRunResult["perCategory"] = {} as BenchRunResult["perCategory"];
  for (const [cat, agg] of Object.entries(perCategory)) {
    perCategoryOut[cat as ProbeCategory] = {
      tried: agg.tried,
      mean: agg.tried === 0 ? 0 : agg.sum / agg.tried,
    };
  }

  const hallucinationRate = totalClaims === 0 ? 0 : 1 - totalResolved / totalClaims;
  return {
    probesTotal: probes.length,
    probesAttempted: totalAttempted,
    probesPassed: totalPassed,
    hallucinationRate,
    perCategory: perCategoryOut,
    wilsonLowerBound: wilsonLowerBound(totalResolved, totalClaims),
    detail,
  };
}

/** Render a markdown leaderboard from a run result. */
export function renderLeaderboard(result: BenchRunResult, configurationLabel: string): string {
  const lines: string[] = [];
  lines.push(`# AI-Memory-Bench — ${configurationLabel}`);
  lines.push("");
  lines.push(`- **Probes attempted:** ${result.probesAttempted} / ${result.probesTotal}`);
  lines.push(`- **Probes passed (score ≥ 0.9):** ${result.probesPassed}`);
  lines.push(`- **Hallucination rate:** ${(result.hallucinationRate * 100).toFixed(2)}%`);
  lines.push(`- **Groundedness (Wilson 95% lower bound):** ${(result.wilsonLowerBound * 100).toFixed(2)}%`);
  lines.push("");
  lines.push("| Category | Tried | Mean Score |");
  lines.push("|---|---:|---:|");
  for (const [cat, stat] of Object.entries(result.perCategory)) {
    lines.push(`| ${cat} | ${stat.tried} | ${(stat.mean * 100).toFixed(1)}% |`);
  }
  return lines.join("\n");
}
