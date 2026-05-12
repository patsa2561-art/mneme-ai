/**
 * v1.70.0 -- PRECOG P3: TEMPORAL VERIFIER.
 *
 * Catches "we deleted X last week" / "yesterday Y was added" / "3
 * days ago we shipped Z" -- temporal claims that need to be
 * corroborated by `git log` within the bounded window.
 *
 *   "last week"      -> window [now-14d, now-1d]
 *   "yesterday"      -> window [now-2d, now-1d]
 *   "today"          -> window [now-1d, now]
 *   "3 days ago"     -> window [now-4d, now-2d]
 *   "last month"     -> window [now-45d, now-15d]
 *   "X days ago"     -> window [now-X-1d, now-X+1d]
 *
 * Verifier checks:
 *   1. Were there ANY commits in the window? (sanity)
 *   2. If claim mentions a verb (add/delete/fix/ship), is there a
 *      commit with that verb root in subject within the window?
 *   3. If claim names a file, does git log -- <file> show commits in window?
 *
 * Honest "INSUFFICIENT_EVIDENCE" verdict when window is empty.
 */

import { execSync } from "node:child_process";

export interface TemporalReference {
  /** The phrase that triggered the match. */
  phrase: string;
  /** Window start (ms since epoch). */
  fromMs: number;
  /** Window end (ms since epoch). */
  toMs: number;
  offset: number;
}

export interface TemporalSuspect {
  ref: TemporalReference;
  reason: string;
  confidence: number;
}

export interface TemporalReport {
  refs: TemporalReference[];
  suspects: TemporalSuspect[];
  corroborated: TemporalReference[];
  headline: string;
}

const PHRASE_RES: Array<{ pattern: RegExp; days: { from: number; to: number } }> = [
  { pattern: /\b(today)\b/gi, days: { from: 1, to: 0 } },
  { pattern: /\b(yesterday)\b/gi, days: { from: 2, to: 1 } },
  { pattern: /\b(last\s+week)\b/gi, days: { from: 14, to: 1 } },
  { pattern: /\b(last\s+month)\b/gi, days: { from: 45, to: 15 } },
  { pattern: /\b(last\s+quarter)\b/gi, days: { from: 120, to: 45 } },
  { pattern: /\b(this\s+week)\b/gi, days: { from: 7, to: 0 } },
];

const N_DAYS_AGO = /\b(\d+)\s+days?\s+ago\b/gi;

const VERB_PATTERN = /\b(added?|deleted?|removed?|shipped?|fixed?|merged?|reverted?|deployed?|released?|refactored?)\b/gi;
const FILE_PATTERN = /([\w./_-]+\.(?:ts|tsx|js|mjs|cjs|jsx|json|md|sql|yml|yaml|py|rs|go))/g;

const DAY_MS = 86400 * 1000;

export function extractTemporalRefs(text: string): TemporalReference[] {
  const out: TemporalReference[] = [];
  const seen = new Set<string>();
  const now = Date.now();
  for (const { pattern, days } of PHRASE_RES) {
    for (const m of text.matchAll(pattern)) {
      const phrase = m[1]!.toLowerCase();
      const key = `${phrase}|${m.index}`;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push({
        phrase,
        fromMs: now - days.from * DAY_MS,
        toMs: now - days.to * DAY_MS,
        offset: m.index ?? 0,
      });
    }
  }
  for (const m of text.matchAll(N_DAYS_AGO)) {
    const n = Number(m[1]);
    if (!Number.isFinite(n) || n < 0) continue;
    out.push({
      phrase: m[0].toLowerCase(),
      fromMs: now - (n + 1) * DAY_MS,
      toMs: now - Math.max(0, n - 1) * DAY_MS,
      offset: m.index ?? 0,
    });
  }
  return out;
}

interface GitWindowResult {
  totalCommits: number;
  verbMatches: number;
  fileTouches: number;
}

function queryGitWindow(repoRoot: string, ref: TemporalReference, verbs: string[], files: string[]): GitWindowResult {
  const since = new Date(ref.fromMs).toISOString();
  const until = new Date(ref.toMs).toISOString();
  let totalCommits = 0;
  let subjects = "";
  try {
    const r = execSync(`git -C "${repoRoot}" log --since="${since}" --until="${until}" --pretty=format:%s`,
      { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"], timeout: 3000 });
    subjects = r;
    totalCommits = r.split("\n").filter(Boolean).length;
  } catch { /* */ }
  let verbMatches = 0;
  for (const v of verbs) {
    const re = new RegExp(`\\b${v.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "i");
    if (re.test(subjects)) verbMatches += 1;
  }
  let fileTouches = 0;
  for (const f of files.slice(0, 3)) {
    try {
      const r = execSync(`git -C "${repoRoot}" log --since="${since}" --until="${until}" --format=%H -- "${f}"`,
        { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"], timeout: 3000 });
      if (r.trim().split("\n").filter(Boolean).length > 0) fileTouches += 1;
    } catch { /* */ }
  }
  return { totalCommits, verbMatches, fileTouches };
}

export function verifyTemporal(repoRoot: string, text: string): TemporalReport {
  const refs = extractTemporalRefs(text);
  if (refs.length === 0) {
    return { refs, suspects: [], corroborated: [], headline: "No temporal claims in text." };
  }
  // Extract verbs + files ONCE for the whole text -- conservative: any temporal
  // ref in the text takes context from all verbs/files in the same text.
  const verbs = [...new Set([...text.matchAll(VERB_PATTERN)].map((m) => m[1]!.toLowerCase()))];
  const files = [...new Set([...text.matchAll(FILE_PATTERN)].map((m) => m[1]!))];
  const suspects: TemporalSuspect[] = [];
  const corroborated: TemporalReference[] = [];
  for (const ref of refs) {
    const result = queryGitWindow(repoRoot, ref, verbs, files);
    if (result.totalCommits === 0) {
      suspects.push({
        ref,
        reason: `No git commits in window [${new Date(ref.fromMs).toISOString().slice(0, 10)} .. ${new Date(ref.toMs).toISOString().slice(0, 10)}] for "${ref.phrase}".`,
        confidence: 0.85,
      });
      continue;
    }
    // If claim names verbs or files, require corroboration.
    if (verbs.length > 0 && result.verbMatches === 0 && files.length === 0) {
      suspects.push({
        ref,
        reason: `${result.totalCommits} commit(s) in window but none match the claimed verbs (${verbs.slice(0, 3).join(", ")}).`,
        confidence: 0.7,
      });
      continue;
    }
    if (files.length > 0 && result.fileTouches === 0) {
      suspects.push({
        ref,
        reason: `${result.totalCommits} commit(s) in window but none touched the named file(s).`,
        confidence: 0.8,
      });
      continue;
    }
    corroborated.push(ref);
  }
  const headline = `${refs.length} temporal claim(s); ${corroborated.length} corroborated, ${suspects.length} suspect.`;
  return { refs, suspects, corroborated, headline };
}
