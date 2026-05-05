/**
 * `mneme time-machine <file>` — narrate a file's evolution as discrete
 * epochs, not a flat diff log. Each epoch is a meaningful era in the
 * file's life: when it was born, when it was rewritten, when it stabilized,
 * when it broke things, when it was abandoned.
 *
 * What makes this novel:
 *   - Most tools show `git log file.ts` — a flat list. Time Machine
 *     groups commits into ERAS based on intent (rewrite, fix, polish,
 *     stable plateau).
 *   - Detects "rewrite events" (large simultaneous insertions+deletions)
 *     vs. "polish events" (small surgical changes) vs. "stable plateaus"
 *     (long quiet stretches).
 *   - Surfaces the WHY for each epoch by extracting the most informative
 *     commit message of that era.
 *   - Computes "narrative health" — how much of the history is rewrite
 *     vs. evolution vs. firefight.
 *
 * Pure data extraction. The CLI renders the timeline; an LLM (optional)
 * can polish the prose.
 */
import type { Commit, FileChange } from "../types.js";

export type EpochKind =
  | "birth" // file's first commit
  | "rewrite" // large structural change (high churn)
  | "evolution" // steady incremental growth
  | "firefight" // cluster of fix/hotfix/revert commits
  | "polish" // small surgical changes, low churn
  | "plateau" // long quiet stretch
  | "twilight"; // file rarely touched, may be abandoned

export interface FileEpoch {
  kind: EpochKind;
  /** Sequential number, 1-indexed. */
  index: number;
  /** Commits defining this epoch (chronological). */
  commits: Commit[];
  /** The most informative commit of the epoch — used for narration. */
  defining: Commit;
  fromDate: string;
  toDate: string;
  /** Total insertions across the epoch. */
  insertions: number;
  /** Total deletions across the epoch. */
  deletions: number;
  /** Days spanned by this epoch. */
  spanDays: number;
  /** A short prose label — the WHY of this epoch. */
  label: string;
}

export interface TimeMachineResult {
  filePath: string;
  totalCommits: number;
  totalSpanDays: number;
  epochs: FileEpoch[];
  /**
   * Health balance across epochs:
   *   - rewriteRatio: fraction of commits in rewrite epochs (high = unstable)
   *   - firefightRatio: fraction in firefight epochs (high = pain)
   *   - polishRatio: fraction in polish/plateau (high = mature)
   */
  health: {
    rewriteRatio: number;
    firefightRatio: number;
    polishRatio: number;
  };
}

const FIRE_RE = /\b(fix(?:es|ed)?|hotfix|revert|rollback|broken|crash|regression|emergency|urgent|critical|p[01])\b/i;
const REWRITE_RE = /\b(rewrite|refactor|overhaul|redesign|migrate|replace[ds]?|move(?:d)? to)\b/i;
const POLISH_RE = /\b(typo|format|lint|rename|comment|whitespace|cleanup|style|chore)\b/i;

/**
 * Compute file epochs from a chronological list of commits + per-commit
 * file changes for the target file. Caller is responsible for filtering
 * commits to ones that actually touched `filePath`.
 */
export function buildTimeMachine(
  filePath: string,
  commits: Commit[],
  changes: Map<string, FileChange>, // commitHash -> file change for filePath
  opts: { plateauDays?: number; rewriteChurnLines?: number } = {},
): TimeMachineResult {
  const plateauDays = opts.plateauDays ?? 60;
  const rewriteChurnLines = opts.rewriteChurnLines ?? 80;

  const sorted = [...commits].sort((a, b) =>
    a.authorDate.localeCompare(b.authorDate),
  );

  if (sorted.length === 0) {
    return {
      filePath,
      totalCommits: 0,
      totalSpanDays: 0,
      epochs: [],
      health: { rewriteRatio: 0, firefightRatio: 0, polishRatio: 0 },
    };
  }

  type Flavor = EpochKind;
  const flavorOf = (c: Commit): Flavor => {
    const text = `${c.subject}\n${c.body || ""}`;
    const fc = changes.get(c.hash);
    const churn = fc ? fc.insertions + fc.deletions : 0;
    if (REWRITE_RE.test(text) || churn >= rewriteChurnLines) return "rewrite";
    if (FIRE_RE.test(text)) return "firefight";
    if (POLISH_RE.test(text) || churn <= 5) return "polish";
    return "evolution";
  };

  const epochs: FileEpoch[] = [];
  let buf: Commit[] = [sorted[0]!];
  let bufFlavor: Flavor = sorted[0]!.parents.length === 0 || epochs.length === 0 ? "birth" : flavorOf(sorted[0]!);
  // birth applies only to the very first commit
  bufFlavor = "birth";
  let prevDate = new Date(sorted[0]!.authorDate).getTime();

  const flush = (kind: Flavor) => {
    const commitsInEpoch = buf;
    if (commitsInEpoch.length === 0) return;
    let ins = 0;
    let del = 0;
    for (const c of commitsInEpoch) {
      const fc = changes.get(c.hash);
      if (fc) {
        ins += fc.insertions;
        del += fc.deletions;
      }
    }
    const fromDate = commitsInEpoch[0]!.authorDate.slice(0, 10);
    const toDate = commitsInEpoch[commitsInEpoch.length - 1]!.authorDate.slice(0, 10);
    const spanDays = Math.max(
      0,
      Math.round(
        (new Date(toDate).getTime() - new Date(fromDate).getTime()) / 86_400_000,
      ),
    );
    const defining = pickDefiningCommit(commitsInEpoch, kind);
    epochs.push({
      kind,
      index: epochs.length + 1,
      commits: commitsInEpoch,
      defining,
      fromDate,
      toDate,
      insertions: ins,
      deletions: del,
      spanDays,
      label: labelEpoch(kind, defining, ins + del),
    });
  };

  for (let i = 1; i < sorted.length; i++) {
    const c = sorted[i]!;
    const cTime = new Date(c.authorDate).getTime();
    const gapDays = (cTime - prevDate) / 86_400_000;
    const flavor = flavorOf(c);

    // Long quiet gap → emit plateau epoch covering the gap
    if (gapDays >= plateauDays) {
      flush(bufFlavor);
      epochs.push({
        kind: "plateau",
        index: epochs.length + 1,
        commits: [],
        defining: buf[buf.length - 1]!,
        fromDate: buf[buf.length - 1]!.authorDate.slice(0, 10),
        toDate: c.authorDate.slice(0, 10),
        insertions: 0,
        deletions: 0,
        spanDays: Math.round(gapDays),
        label: `quiet stretch — ${Math.round(gapDays)} days untouched`,
      });
      buf = [c];
      bufFlavor = flavor;
    } else if (flavor !== bufFlavor) {
      // flavor change → close current epoch, start new one
      flush(bufFlavor);
      buf = [c];
      bufFlavor = flavor;
    } else {
      buf.push(c);
    }
    prevDate = cTime;
  }
  flush(bufFlavor);

  // Mark trailing plateau as "twilight" if file is quiet at end (>plateauDays
  // since last touch).
  const last = epochs[epochs.length - 1];
  if (last && last.kind === "plateau" && last.spanDays >= plateauDays * 2) {
    last.kind = "twilight";
    last.label = `twilight — ${last.spanDays} days since last touch`;
  }

  // Compute health ratios
  const totalCommits = sorted.length;
  let rewrite = 0;
  let firefight = 0;
  let polish = 0;
  for (const e of epochs) {
    if (e.kind === "rewrite") rewrite += e.commits.length;
    else if (e.kind === "firefight") firefight += e.commits.length;
    else if (e.kind === "polish" || e.kind === "plateau") polish += e.commits.length;
  }
  const totalSpanDays = Math.max(
    0,
    Math.round(
      (new Date(sorted[sorted.length - 1]!.authorDate).getTime() -
        new Date(sorted[0]!.authorDate).getTime()) /
        86_400_000,
    ),
  );

  return {
    filePath,
    totalCommits,
    totalSpanDays,
    epochs,
    health: {
      rewriteRatio: totalCommits === 0 ? 0 : rewrite / totalCommits,
      firefightRatio: totalCommits === 0 ? 0 : firefight / totalCommits,
      polishRatio: totalCommits === 0 ? 0 : polish / totalCommits,
    },
  };
}

function pickDefiningCommit(commits: Commit[], kind: EpochKind): Commit {
  if (commits.length === 0) throw new Error("empty epoch");
  if (kind === "birth") return commits[0]!;
  if (kind === "rewrite") {
    // longest body / most descriptive subject wins
    return [...commits].sort(
      (a, b) =>
        (b.body?.length ?? 0) + b.subject.length - ((a.body?.length ?? 0) + a.subject.length),
    )[0]!;
  }
  // For evolution/polish/firefight, pick the commit whose subject is longest
  // (typically more informative than "fix typo")
  return [...commits].sort((a, b) => b.subject.length - a.subject.length)[0]!;
}

function labelEpoch(kind: EpochKind, defining: Commit, churn: number): string {
  switch (kind) {
    case "birth":
      return `born — "${truncate(defining.subject, 60)}"`;
    case "rewrite":
      return `rewrite — "${truncate(defining.subject, 60)}" (${churn} lines)`;
    case "evolution":
      return `evolution — "${truncate(defining.subject, 60)}"`;
    case "firefight":
      return `firefight — "${truncate(defining.subject, 60)}"`;
    case "polish":
      return `polish — "${truncate(defining.subject, 60)}"`;
    case "plateau":
      return `plateau — quiet`;
    case "twilight":
      return `twilight — possibly abandoned`;
  }
}

function truncate(s: string, n: number): string {
  if (s.length <= n) return s;
  return s.slice(0, n - 1).trimEnd() + "…";
}
