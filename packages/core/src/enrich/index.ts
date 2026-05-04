/**
 * Enrichment — synthesize missing context for commits with poor messages.
 *
 * The honest framing: we never *replace* git history. The original commit
 * message stays untouched. We add a `synthesized_note` row keyed by commit
 * hash, marked with the model that produced it, and search treats it as a
 * separate kind of chunk so users can always tell synthesized text from
 * original text.
 *
 * The system prompt is intentionally cautious — it tells the model to *infer
 * conservatively from the diff* and to admit uncertainty rather than
 * confabulate. We mark notes that fall back to "unknown" so they don't
 * pollute search.
 */
import type { Commit } from "../types.js";

export const SYNTHESIZE_SYSTEM_PROMPT = `You are reading a git commit and the diff it produced.
Your job is to write a 2-4 sentence note explaining the most likely WHY behind the change,
inferred CONSERVATIVELY from the diff alone — not invented.

Rules:
1. Refer only to what the diff and adjacent commits actually contain. Never make up facts.
2. If the diff is too small or generic to infer intent, say exactly: "Cannot determine purpose from diff alone."
3. Use plain prose, no bullet lists, no markdown headings.
4. Avoid filler ("This commit changes..."). Open with the inferred motivation.
5. Mention specific function/file names from the diff when they help; never invent names.

Output ONLY the note. No preamble, no signoff, no quotes.`;

export interface CommitContextForSynthesis {
  commit: Commit;
  diff: string;
  /** Few neighbor commit subjects for temporal context. */
  neighborSubjects?: string[];
}

export function buildSynthesisPrompt(input: CommitContextForSynthesis): string {
  const { commit, diff, neighborSubjects = [] } = input;
  const lines: string[] = [];
  lines.push(`Commit: ${commit.shortHash || commit.hash.slice(0, 7)}`);
  lines.push(`Author: ${commit.authorName} <${commit.authorEmail}>`);
  lines.push(`Date:   ${commit.authorDate}`);
  lines.push(`Subject: ${commit.subject || "(empty)"}`);
  if (commit.body && commit.body.trim()) {
    lines.push(`Body: ${commit.body}`);
  }
  if (commit.files.length) {
    lines.push(`Files: ${commit.files.slice(0, 8).join(", ")}${commit.files.length > 8 ? " (+more)" : ""}`);
  }
  if (neighborSubjects.length) {
    lines.push(`Neighboring commits:`);
    for (const s of neighborSubjects.slice(0, 5)) lines.push(`  - ${s}`);
  }
  lines.push("");
  lines.push("Diff (truncated to 4000 chars):");
  lines.push(diff.length > 4000 ? diff.slice(0, 4000) + "\n…(truncated)" : diff);
  return lines.join("\n");
}

/**
 * Heuristic: a commit "needs healing" when its message gives no real signal.
 * - Subject shorter than `subjectMinLen` characters, or
 * - Subject matches one of the generic templates ("update", "fix", "wip", etc.), and
 * - Body is empty
 *
 * Tunable so users can heal the worst offenders first.
 */
export function needsHealing(commit: Commit, subjectMinLen = 20): boolean {
  const subject = commit.subject.trim();
  const body = commit.body.trim();
  if (body.length > 30) return false; // already has a body
  if (subject.length < subjectMinLen) return true;
  const generic = /^(?:wip|update[sd]?|fix|fixed|fixes|tweak|small\s+change|misc|stuff|refactor|cleanup|chore|adjust|tweaks)\.?$/i;
  if (generic.test(subject)) return true;
  return false;
}

/** Return true if the synthesized text is a polite "don't know" — should not be persisted as memory. */
export function isUncertain(note: string): boolean {
  if (!note) return true;
  const t = note.trim().toLowerCase();
  if (t.length < 30) return true;
  if (t.includes("cannot determine purpose from diff alone")) return true;
  if (t.startsWith("i cannot") || t.startsWith("unable to")) return true;
  return false;
}
