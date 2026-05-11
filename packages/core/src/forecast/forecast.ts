/**
 * v1.59.0 -- TIER 3: THE ORACLE (regression forecaster).
 *
 * Bayesian forecaster. Given a candidate commit subject + recent history,
 * returns P(regression within 14 days). Pure git-log + token-overlap + Bayes.
 *
 *   posterior = (likelihood * prior) /
 *               (likelihood * prior + (1 - likelihood) * (1 - prior))
 *
 * Distinct from the existing acgv-grounded squadron Oracle (Markov tool
 * predictor); this one forecasts code-level regression risk.
 */

import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, appendFileSync } from "node:fs";
import { join } from "node:path";

const REVERT_PATTERNS = [
  /\brevert\b/i, /\bhotfix\b/i, /\brollback\b/i, /\bundo\b/i,
  /\bregression\b/i, /\bbroken\b/i,
];

export interface ForecastResult {
  claim: string;
  probability: number;
  band: "very-low" | "low" | "moderate" | "elevated" | "high";
  prior: number;
  likelihood: number;
  sampleSize: number;
  matchedReverts: number;
  medianRevertDays: number | null;
  examples: Array<{ sha: string; subject: string; revertedIn?: number }>;
  reasoning: string;
}

interface Commit { sha: string; date: number; subject: string }

function tokenize(text: string): string[] {
  return Array.from(new Set(
    (text.toLowerCase().match(/[a-z][a-z0-9_-]+/g) ?? []).filter((w) => w.length >= 4),
  ));
}

function readRecentCommits(repoRoot: string, max: number): Commit[] {
  try {
    const r = spawnSync("git", ["-C", repoRoot, "log", `--max-count=${max}`, "--pretty=format:%H@@@%cI@@@%s"], {
      encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], timeout: 5000,
    });
    if (r.status !== 0 || !r.stdout) return [];
    const out: Commit[] = [];
    for (const line of r.stdout.split("\n")) {
      const parts = line.split("@@@");
      if (parts.length < 3) continue;
      const d = Date.parse(parts[1]!);
      if (!Number.isFinite(d)) continue;
      out.push({ sha: parts[0]!.slice(0, 12), date: d, subject: parts.slice(2).join("@@@") });
    }
    return out;
  } catch { return []; }
}

const isRevertLike = (s: string) => REVERT_PATTERNS.some((re) => re.test(s));

function revertedWithin(c: Commit, all: Commit[], windowDays: number): number | null {
  const cutoff = c.date + windowDays * 86400 * 1000;
  const cTokens = tokenize(c.subject);
  if (cTokens.length === 0) return null;
  for (const other of all) {
    if (other.date <= c.date) continue;
    if (other.date > cutoff) continue;
    if (!isRevertLike(other.subject)) continue;
    const ls = other.subject.toLowerCase();
    if (!cTokens.some((t) => ls.includes(t))) continue;
    return Math.max(1, Math.round((other.date - c.date) / (86400 * 1000)));
  }
  return null;
}

function median(xs: number[]): number {
  if (xs.length === 0) return 0;
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 === 0 ? (s[m - 1]! + s[m]!) / 2 : s[m]!;
}

function band(p: number): ForecastResult["band"] {
  if (p < 0.05) return "very-low";
  if (p < 0.15) return "low";
  if (p < 0.35) return "moderate";
  if (p < 0.6) return "elevated";
  return "high";
}

export function forecast(
  repoRoot: string,
  claim: string,
  opts?: { historyDepth?: number; window?: number },
): ForecastResult {
  const historyDepth = opts?.historyDepth ?? 500;
  const window = opts?.window ?? 14;
  const commits = readRecentCommits(repoRoot, historyDepth);
  if (commits.length === 0) {
    return {
      claim, probability: 0, band: "very-low",
      prior: 0, likelihood: 0, sampleSize: 0, matchedReverts: 0,
      medianRevertDays: null, examples: [],
      reasoning: "No git history available -- forecast not possible.",
    };
  }

  const totalReverts = commits.filter((c) => isRevertLike(c.subject)).length;
  const prior = totalReverts / commits.length;

  const claimTokens = tokenize(claim);
  const cohort = commits.filter((c) => {
    if (isRevertLike(c.subject)) return false;
    const s = c.subject.toLowerCase();
    return claimTokens.some((t) => s.includes(t));
  });
  const cohortReverts: Array<{ sha: string; subject: string; delta: number }> = [];
  for (const c of cohort) {
    const d = revertedWithin(c, commits, window);
    if (d !== null) cohortReverts.push({ sha: c.sha, subject: c.subject, delta: d });
  }
  const sampleSize = cohort.length;
  const matchedReverts = cohortReverts.length;
  const likelihood = sampleSize === 0 ? prior : matchedReverts / sampleSize;
  const medianRevertDays = cohortReverts.length > 0
    ? median(cohortReverts.map((x) => x.delta))
    : null;

  let posterior = prior;
  if (sampleSize > 0) {
    const num = likelihood * prior;
    const den = num + (1 - likelihood) * (1 - prior);
    posterior = den > 0 ? num / den : prior;
  }

  const examples = cohort.slice(0, 3).map((c) => {
    const rev = cohortReverts.find((r) => r.sha === c.sha);
    return rev
      ? { sha: c.sha.slice(0, 7), subject: c.subject, revertedIn: rev.delta }
      : { sha: c.sha.slice(0, 7), subject: c.subject };
  });

  const reasoning = sampleSize === 0
    ? `No prior commits matched the claim tokens. Falling back to base-rate prior ${(prior * 100).toFixed(1)}%.`
    : `${matchedReverts} of ${sampleSize} similar past commits reverted within ${window} days (likelihood ${(likelihood * 100).toFixed(1)}% vs prior ${(prior * 100).toFixed(1)}%).`;

  try {
    const dir = join(repoRoot, ".mneme", "forecast");
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
    appendFileSync(join(dir, "forecasts.jsonl"), JSON.stringify({
      ts: new Date().toISOString(), claim,
      probability: posterior, prior, likelihood, sampleSize, matchedReverts,
    }) + "\n", "utf8");
  } catch { /* */ }

  return {
    claim, probability: posterior, band: band(posterior),
    prior, likelihood, sampleSize, matchedReverts, medianRevertDays,
    examples, reasoning,
  };
}
