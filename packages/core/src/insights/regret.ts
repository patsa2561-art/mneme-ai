/**
 * `mneme regret` — surface commits that we shipped and then immediately
 * fixed, hotfixed, or reverted. The "things we regretted" log.
 *
 * Reverse-mining git history for failure patterns. A commit is a "regret"
 * if a follow-up commit (within `windowDays`) contains revert/hotfix/fix
 * markers OR touches the same lines/files. The follow-up tells us this
 * commit ALREADY caused pain.
 *
 * Why this is useful:
 *   - Postmortems: "what did we ship and regret?"
 *   - Retrospectives: pattern of regret reveals systemic issues
 *   - Pre-commit awareness: see what *kinds* of changes you tend to redo
 *
 * Pure data extraction — no LLM. The CLI command renders.
 */

import type { Commit } from "../types.js";
import { isNoiseFile } from "../util/noise.js";

export interface Regret {
  shipped: Commit;
  followup: Commit;
  /** Days between ship and followup. */
  daysToFix: number;
  /**
   * What kind of follow-up — drives the rendered label and lesson tone.
   * 'revert' is strongest (full undo); 'hotfix' is urgent fix; 'fix' is
   * any subsequent commit referencing the original; 'sameFiles' is the
   * weakest signal (just touched the same files within window).
   */
  kind: "revert" | "hotfix" | "fix" | "sameFiles";
  /** A 1-line lesson when one is extractable from the follow-up message. */
  lesson?: string;
  /** Files that link the shipped commit to its follow-up — top 5,
   *  noise-filtered. Lets the reader jump to where the regret actually
   *  lives in the codebase. */
  affectedFiles?: string[];
}

const REVERT_RE = /\b(revert|reverts|reverted)\b/i;
const HOTFIX_RE = /\b(hotfix|emergency|urgent|critical)\b/i;
const FIX_RE = /\b(fix(?:es|ed)?|bug|broken|crash|regression)\b/i;
const REF_RE = /\b#?(\d{2,6})\b/;

/**
 * Detect regrets from a chronological commit list. Commits should be
 * sorted oldest-first (caller's responsibility — we use index ordering
 * to compute "follow-up").
 */
export function detectRegrets(
  commits: Commit[],
  opts: { windowDays?: number; minDaysToFix?: number } = {},
): Regret[] {
  const windowMs = (opts.windowDays ?? 7) * 86_400_000;
  const minDaysToFix = opts.minDaysToFix ?? 0;
  const sorted = [...commits].sort((a, b) => a.authorDate.localeCompare(b.authorDate));

  const out: Regret[] = [];
  // Index commits by file for fast suffix matching.
  for (let i = 0; i < sorted.length; i++) {
    const shipped = sorted[i]!;
    const shippedTime = new Date(shipped.authorDate).getTime();
    const shippedHashShort = (shipped.shortHash || shipped.hash.slice(0, 7)).toLowerCase();

    // Walk forward looking for a follow-up within the window.
    for (let j = i + 1; j < sorted.length; j++) {
      const followup = sorted[j]!;
      const followupTime = new Date(followup.authorDate).getTime();
      const dt = followupTime - shippedTime;
      if (dt > windowMs) break; // window exceeded; no later commit qualifies
      const days = dt / 86_400_000;
      if (days < minDaysToFix) continue;

      const fuText = `${followup.subject}\n${followup.body || ""}`;
      const fuTextLower = fuText.toLowerCase();

      let kind: Regret["kind"] | null = null;

      // Strongest signal: explicit revert that names the original commit.
      if (REVERT_RE.test(fuText) && (fuTextLower.includes(shippedHashShort) || fuTextLower.includes(shipped.subject.toLowerCase()))) {
        kind = "revert";
      } else if (REVERT_RE.test(fuText) && shareFiles(shipped, followup)) {
        kind = "revert";
      } else if (HOTFIX_RE.test(fuText) && shareFiles(shipped, followup)) {
        kind = "hotfix";
      } else if (FIX_RE.test(fuText) && shareFiles(shipped, followup)) {
        // Don't double-count the shipped commit itself if it's also a fix.
        if (!FIX_RE.test(shipped.subject)) kind = "fix";
      } else if (REF_RE.test(fuText) && shareFiles(shipped, followup)) {
        // weak signal: same files within window — only count if not already a fix
        kind = "sameFiles";
      }

      if (kind) {
        // Files that connect ship → fix. Prefer the intersection (true
        // shared files) but fall back to the shipped commit's files when
        // the link came from a hash/issue reference (no shared files
        // required for revert-by-hash).
        const shippedSet = new Set(shipped.files ?? []);
        const sharedSet = new Set(
          (followup.files ?? []).filter((f) => shippedSet.has(f) && !isNoiseFile(f)),
        );
        const fallback = (shipped.files ?? []).filter((f) => !isNoiseFile(f));
        const affectedFiles = (sharedSet.size > 0 ? [...sharedSet] : fallback).slice(0, 5);
        out.push({
          shipped,
          followup,
          daysToFix: Number(days.toFixed(1)),
          kind,
          lesson: extractLesson(fuText, kind),
          affectedFiles: affectedFiles.length > 0 ? affectedFiles : undefined,
        });
        break; // one regret per shipped commit (the first follow-up)
      }
    }
  }

  // Sort by recency of ship date (newest first — what users want to see).
  return out.sort((a, b) => b.shipped.authorDate.localeCompare(a.shipped.authorDate));
}

function shareFiles(a: Commit, b: Commit): boolean {
  if (!a.files?.length || !b.files?.length) return false;
  const setA = new Set(a.files);
  for (const f of b.files) if (setA.has(f)) return true;
  return false;
}

function extractLesson(text: string, kind: Regret["kind"]): string | undefined {
  // Simple heuristic — find the first sentence that explains WHY.
  const lines = text.split(/\n+/);
  for (const line of lines) {
    const t = line.trim();
    if (!t) continue;
    if (t.length < 20 || t.length > 200) continue;
    // Skip the subject line (usually the first non-empty)
    if (t.toLowerCase().startsWith("revert ")) continue;
    if (t.toLowerCase().startsWith("hotfix")) continue;
    return t;
  }
  // Fallback — generic lesson by kind.
  switch (kind) {
    case "revert":
      return "this change was fully reverted within the window";
    case "hotfix":
      return "needed an urgent follow-up fix";
    case "fix":
      return "a follow-up commit fixed it";
    case "sameFiles":
      return "the same files were touched again very soon after";
  }
}

/**
 * Aggregate metrics — useful for repo-level trend reporting.
 *
 * `regretRate` is how many of the recent shipped commits later got fixed
 * within the window. We exclude shipped commits whose own subject already
 * looks like a fix (so we don't double-count repair work).
 */
export interface RegretSummary {
  totalShipped: number;
  totalRegrets: number;
  regretRate: number;
  byKind: Record<Regret["kind"], number>;
  averageDaysToFix: number;
}

export function summarizeRegrets(commits: Commit[], regrets: Regret[]): RegretSummary {
  const shippedCandidates = commits.filter((c) => !FIX_RE.test(c.subject));
  const total = shippedCandidates.length;
  const byKind: Record<Regret["kind"], number> = { revert: 0, hotfix: 0, fix: 0, sameFiles: 0 };
  let sumDays = 0;
  for (const r of regrets) {
    byKind[r.kind] += 1;
    sumDays += r.daysToFix;
  }
  return {
    totalShipped: total,
    totalRegrets: regrets.length,
    regretRate: total === 0 ? 0 : regrets.length / total,
    byKind,
    averageDaysToFix: regrets.length === 0 ? 0 : sumDays / regrets.length,
  };
}
