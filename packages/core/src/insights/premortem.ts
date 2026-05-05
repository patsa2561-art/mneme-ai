/**
 * `mneme premortem <intent>` — predict what will go wrong with a proposed
 * change *before* you write it, by mining your repo's history of similar
 * past attempts and what happened to them.
 *
 * Premortem inverts the postmortem: instead of "what went wrong?", we ask
 * "what is likely to go wrong, given what's gone wrong before in this repo
 * when we tried something like this?"
 *
 * What makes this novel:
 *   - Most "AI coding" tools give generic advice ("watch out for race
 *     conditions"). Premortem gives advice grounded in YOUR repo's actual
 *     failure history.
 *   - Estimates a regret probability based on hit rate of similar past
 *     intents that ended in revert/hotfix/incident.
 *   - Surfaces 3 concrete risks with citations to the past commits that
 *     caused them — actionable, not abstract.
 *
 * Pure data extraction — no LLM. The CLI renders.
 */
import type { Commit } from "../types.js";

export type RiskKind = "revert" | "hotfix" | "incident" | "rewrite";

export interface PastAttempt {
  /** The commit that introduced the past attempt. */
  attempt: Commit;
  /** The follow-up that signals regret (if any). */
  regret?: Commit;
  /** What went wrong, classified by signal in the regret commit. */
  riskKind: RiskKind | "none";
  /** Days from attempt to regret (or 0 if no regret). */
  daysToRegret: number;
  /** Similarity score of this past attempt to the current intent (0..1). */
  similarity: number;
}

export interface Risk {
  /** Short label e.g. "cache invalidation regression". */
  label: string;
  /** Specific commits that exhibited this risk. */
  evidence: Commit[];
  /** How often this risk fired, normalized 0..1 (capped at 1). */
  weight: number;
}

export interface PremortemResult {
  intent: string;
  /** Past attempts in this repo that look like the proposed intent. */
  pastAttempts: PastAttempt[];
  /**
   * Probability that this kind of change will be regretted, computed as
   * regret_count / total_similar_attempts. Range 0..1.
   */
  regretProbability: number;
  /** Top concrete risks distilled from past attempts. */
  topRisks: Risk[];
  /** Verdict label — "low / medium / high / very_high". */
  verdict: "low" | "medium" | "high" | "very_high";
  /** Short verdict prose. */
  summary: string;
}

const REVERT_RE = /\b(revert|reverts|reverted|rollback)\b/i;
const HOTFIX_RE = /\b(hotfix|emergency|urgent|critical|p[01])\b/i;
const INCIDENT_RE = /\b(incident|outage|down|broken|crash|regression)\b/i;
const REWRITE_RE = /\b(rewrite|rewritten|redo|redid|second(?:\s|-)attempt)\b/i;

const STOPWORDS = new Set([
  "the","a","an","of","to","in","on","for","and","or","with","add","added","fix",
  "remove","update","change","make","made","new","old","this","that","is","are","be",
  "was","were","my","our","your","i","we","you","it","its","into","from","by","at",
]);

/**
 * Score similarity between an intent string and a commit, by token overlap
 * + a small bonus for files-mentioned matching commit-touched files.
 */
export function scoreSimilarity(intent: string, c: Commit): number {
  const intentTokens = tokenize(intent);
  if (intentTokens.size === 0) return 0;
  const commitText = `${c.subject}\n${c.body || ""}`;
  const commitTokens = tokenize(commitText);

  let overlap = 0;
  for (const t of intentTokens) if (commitTokens.has(t)) overlap += 1;
  const base = overlap / intentTokens.size;

  // Path-level boost: if intent names a file/path, check commit touches it.
  const pathHint = extractPathHint(intent);
  let pathBoost = 0;
  if (pathHint && c.files?.some((f) => f.includes(pathHint))) {
    pathBoost = 0.2;
  }

  return Math.min(1, base + pathBoost);
}

function tokenize(s: string): Set<string> {
  const out = new Set<string>();
  for (const t of s
    .toLowerCase()
    .replace(/[^a-z0-9_/.-]+/g, " ")
    .split(/\s+/)) {
    if (!t) continue;
    if (t.length < 3) continue;
    if (STOPWORDS.has(t)) continue;
    out.add(t);
  }
  return out;
}

function extractPathHint(intent: string): string | null {
  // crude: any token that looks like a path or file
  const m = intent.match(/[A-Za-z0-9_./-]+\.(?:ts|tsx|js|jsx|py|go|rs|java|md)/);
  return m ? m[0] : null;
}

/**
 * Build a premortem from an intent string and the commit history. Caller
 * passes the full commit history (newest first or oldest first — we sort).
 */
export function buildPremortem(
  intent: string,
  commits: Commit[],
  opts: {
    similarityFloor?: number; // 0..1 minimum similarity to count an attempt
    windowDays?: number; // window for follow-up regret detection
    maxAttempts?: number; // cap on past attempts considered
  } = {},
): PremortemResult {
  const similarityFloor = opts.similarityFloor ?? 0.25;
  const windowDays = opts.windowDays ?? 14;
  const maxAttempts = opts.maxAttempts ?? 25;

  const sorted = [...commits].sort((a, b) =>
    a.authorDate.localeCompare(b.authorDate),
  );

  // Find similar past attempts. Exclude commits that are themselves regret
  // signals (revert / hotfix / incident) — those aren't attempts, they're
  // the consequence of one.
  const scored: { commit: Commit; similarity: number }[] = [];
  for (const c of sorted) {
    const subject = c.subject || "";
    if (REVERT_RE.test(subject) || HOTFIX_RE.test(subject) || INCIDENT_RE.test(subject)) {
      continue;
    }
    const s = scoreSimilarity(intent, c);
    if (s >= similarityFloor) scored.push({ commit: c, similarity: s });
  }
  scored.sort((a, b) => b.similarity - a.similarity);
  const candidates = scored.slice(0, maxAttempts);

  // For each candidate, walk forward window to find regret signal
  const pastAttempts: PastAttempt[] = [];
  const windowMs = windowDays * 86_400_000;
  for (const { commit: attempt, similarity } of candidates) {
    const tStart = new Date(attempt.authorDate).getTime();
    let regret: Commit | undefined;
    let kind: RiskKind | "none" = "none";
    let daysToRegret = 0;

    for (const c of sorted) {
      if (c.hash === attempt.hash) continue;
      const tC = new Date(c.authorDate).getTime();
      if (tC <= tStart) continue;
      if (tC - tStart > windowMs) break;
      // Must share at least one file with the attempt
      if (!shareFiles(attempt, c)) continue;
      const text = `${c.subject}\n${c.body || ""}`;
      if (REVERT_RE.test(text)) {
        regret = c;
        kind = "revert";
        daysToRegret = Number(((tC - tStart) / 86_400_000).toFixed(1));
        break;
      }
      if (HOTFIX_RE.test(text)) {
        regret = c;
        kind = "hotfix";
        daysToRegret = Number(((tC - tStart) / 86_400_000).toFixed(1));
        break;
      }
      if (INCIDENT_RE.test(text)) {
        regret = c;
        kind = "incident";
        daysToRegret = Number(((tC - tStart) / 86_400_000).toFixed(1));
        break;
      }
      if (REWRITE_RE.test(text) && shareFiles(attempt, c)) {
        regret = c;
        kind = "rewrite";
        daysToRegret = Number(((tC - tStart) / 86_400_000).toFixed(1));
        break;
      }
    }

    pastAttempts.push({ attempt, regret, riskKind: kind, daysToRegret, similarity });
  }

  // Compute regret probability
  const regretCount = pastAttempts.filter((p) => p.riskKind !== "none").length;
  const regretProbability =
    pastAttempts.length === 0 ? 0 : regretCount / pastAttempts.length;

  // Distill top risks: cluster regrets by riskKind, label them.
  const byKind = new Map<RiskKind, PastAttempt[]>();
  for (const p of pastAttempts) {
    if (p.riskKind === "none") continue;
    const arr = byKind.get(p.riskKind) ?? [];
    arr.push(p);
    byKind.set(p.riskKind, arr);
  }

  const topRisks: Risk[] = [];
  for (const [kind, arr] of byKind) {
    topRisks.push({
      label: riskLabel(kind, arr),
      evidence: arr.map((a) => a.regret!).filter(Boolean),
      weight: Math.min(1, arr.length / Math.max(1, pastAttempts.length)),
    });
  }
  topRisks.sort((a, b) => b.weight - a.weight);

  // Verdict
  let verdict: PremortemResult["verdict"] = "low";
  if (regretProbability >= 0.7) verdict = "very_high";
  else if (regretProbability >= 0.4) verdict = "high";
  else if (regretProbability >= 0.15) verdict = "medium";

  const summary = composeSummary(intent, pastAttempts.length, regretCount, verdict);

  return {
    intent,
    pastAttempts,
    regretProbability,
    topRisks: topRisks.slice(0, 3),
    verdict,
    summary,
  };
}

function shareFiles(a: Commit, b: Commit): boolean {
  if (!a.files?.length || !b.files?.length) return false;
  const setA = new Set(a.files);
  for (const f of b.files) if (setA.has(f)) return true;
  return false;
}

function riskLabel(kind: RiskKind, arr: PastAttempt[]): string {
  const n = arr.length;
  switch (kind) {
    case "revert":
      return `change reverted within ${Math.round(median(arr.map((a) => a.daysToRegret)))}d (${n}× before)`;
    case "hotfix":
      return `hotfix follow-up needed (${n}× before)`;
    case "incident":
      return `linked to incident/regression (${n}× before)`;
    case "rewrite":
      return `partially rewritten soon after (${n}× before)`;
  }
}

function median(xs: number[]): number {
  if (xs.length === 0) return 0;
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 === 1 ? s[m]! : (s[m - 1]! + s[m]!) / 2;
}

function composeSummary(
  intent: string,
  total: number,
  regret: number,
  verdict: PremortemResult["verdict"],
): string {
  if (total === 0) {
    return `No similar past attempts found in this repo for "${intent}". Premortem cannot calibrate against history — proceed with normal review.`;
  }
  const pct = Math.round((regret / total) * 100);
  switch (verdict) {
    case "very_high":
      return `${regret} of ${total} similar past attempts ended badly (${pct}%). This pattern has burned this repo before — slow down, write tests first, and review the cited commits.`;
    case "high":
      return `${regret} of ${total} similar past attempts hit problems (${pct}%). High caution warranted; review the cited risks before starting.`;
    case "medium":
      return `${regret} of ${total} similar past attempts had issues (${pct}%). Some historical risk — worth reading the cited commits.`;
    case "low":
      return `Only ${regret} of ${total} similar past attempts had problems (${pct}%). This kind of change has gone smoothly before — usual care is fine.`;
  }
}
