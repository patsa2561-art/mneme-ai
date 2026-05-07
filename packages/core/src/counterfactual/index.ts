/**
 * Counterfactual — Bayesian-style "what if X never joined?" re-simulation.
 *
 * Thesis: every team carries hidden dependencies on individual contributors.
 * `mneme counterfactual <author>` makes those dependencies visible by
 * re-running atrophy + telepathy against a shadow store that has the
 * author's commits removed (and any commits where the author appears as
 * a co-author have that co-author trailer stripped).
 *
 * Output is a delta report:
 *   - atrophyDelta:    files that lose live expertise / shift to new owners
 *   - telepathyDelta:  pairs that disappear / shift rank
 *   - knowledgeMassDelta: total Σ knowledge mass that vanishes with the author
 *   - narrative:       plain-English summary
 *
 * Honest framing:
 *   - Bayesian what-if, not a prediction. The repo as it actually exists
 *     is the only ground truth; this estimate assumes every other commit
 *     would still have happened on the same timeline, which is rarely true.
 *   - NEVER use this to evaluate a real person. The headline is "what
 *     knowledge would the team need to relearn?" — not "are they replaceable?"
 *
 * Influence is intentionally not re-simulated here:
 *   - influence walks the live git tree (not the SQLite store) so we can't
 *     cleanly drop one author's contributions without checking out a synthetic
 *     branch. The CLI surfaces this as an honest scope cap.
 *
 * Pure data over a {@link MnemeStore}. No I/O of its own.
 */

import type { MnemeStore } from "../store/sqlite.js";
import { MnemeStore as MnemeStoreCtor } from "../store/sqlite.js";
import { atrophyForFile, type FileKnowledge } from "../people/atrophy.js";
import {
  telepathy,
  type TelepathyResult,
  type TelepathyPair,
} from "../people/telepathy.js";

// ─── public types ─────────────────────────────────────────────────────

export interface CounterfactualOptions {
  /** Author to drop. Lower-cased internally. */
  authorEmail: string;
  /** Knowledge half-life override for atrophy. */
  halfLifeDays?: number;
  /** Cap on top files / pairs returned per delta. Default 10. */
  topN?: number;
  /** Telepathy window (hours). Default 48. */
  telepathyWindowHours?: number;
  /** Min telepathy events for a pair to register. Default 3. */
  telepathyMinEvents?: number;
  /** ISO "as-of" override for deterministic tests. */
  asOf?: string;
}

export interface FileExpertChange {
  filePath: string;
  /** Total touches the file has across history. */
  totalTouches: number;
  /** Tier in the actual repo. */
  tierBefore: "safe" | "warn" | "at-risk";
  /** Tier without the author. */
  tierAfter: "safe" | "warn" | "at-risk";
  /** 0..1 — the freshest knowledge score with the author present. */
  freshestBefore: number;
  /** 0..1 — the freshest knowledge score with the author removed. */
  freshestAfter: number;
  /**
   * Plain-English label for the shift.
   *   "lost-only-expert" — file went from any live expert to none.
   *   "lost-top-expert"  — top expert was the target; another is still live.
   *   "tier-degraded"    — moved from a higher safety tier to a lower one.
   *   "no-impact"        — author had no recorded ownership of this file.
   */
  shift:
    | "lost-only-expert"
    | "lost-top-expert"
    | "tier-degraded"
    | "no-impact";
}

export interface PairChange {
  authorA: string;
  authorB: string;
  scoreBefore: number;
  scoreAfter: number;
  rankBefore: number | null;
  rankAfter: number | null;
  /**
   * "vanished" — pair had a score before, has none now (target was a member).
   * "rank-shift" — pair survived but moved up the leaderboard.
   * "unchanged"  — bookkeeping only; usually omitted from output.
   */
  shift: "vanished" | "rank-shift" | "unchanged";
}

export interface CounterfactualReport {
  /** Display name of the dropped author (lower-cased email). */
  authorEmail: string;
  /** Was the author actually present in the repo? (False → degenerate report.) */
  authorWasPresent: boolean;
  /** Was anyone else still around? (False → cannot meaningfully simulate.) */
  remainingContributors: number;
  /** Counts only — full reports are large; CLI re-renders summaries. */
  meta: {
    commitsBefore: number;
    commitsAfter: number;
    authorsBefore: number;
    authorsAfter: number;
    filesBefore: number;
    filesAfter: number;
  };
  /** Atrophy snapshot — both before + after, plus diffed file shifts. */
  atrophy: {
    knowledgeMassRemoved: number;
    filesLoseLastExpert: FileKnowledge[];
    fileShifts: FileExpertChange[];
  };
  /** Telepathy snapshot — pairs that vanish or get re-ranked. */
  telepathy: {
    pairsBefore: TelepathyPair[];
    pairsAfter: TelepathyPair[];
    vanishedPairs: PairChange[];
    rankShifts: PairChange[];
  };
  /** Plain-English narrative — built once for the CLI to render. */
  narrative: string;
}

// ─── shadow-store builder ──────────────────────────────────────────────

interface CommitRow {
  hash: string;
  short_hash: string;
  author_name: string;
  author_email: string;
  author_date: string;
  committer_date: string;
  subject: string;
  body: string;
  parents: string;
  pr_number: number | null;
  pr_title: string | null;
  pr_body: string | null;
  issue_refs: string | null;
}

interface FileRow {
  commit_hash: string;
  path: string;
  change_kind: string;
  insertions: number;
  deletions: number;
}

/**
 * Build an in-memory MnemeStore that mirrors `source` except for any commit
 * authored by `dropEmail` (which is omitted entirely). Commits that merely
 * include the dropped email as a co-author keep their primary authorship
 * intact but lose the co-author trailer.
 *
 * The returned store MUST be closed by the caller.
 */
export function buildShadowStore(
  source: MnemeStore,
  dropEmail: string,
): MnemeStore {
  const target = dropEmail.toLowerCase();
  const shadow = new MnemeStoreCtor(":memory:");

  const commits = source.db
    .prepare(
      `SELECT hash, short_hash, author_name, author_email, author_date,
              committer_date, subject, body, parents,
              pr_number, pr_title, pr_body, issue_refs
       FROM commits`,
    )
    .all() as unknown as CommitRow[];

  const insertCommit = shadow.db.prepare(
    `INSERT OR REPLACE INTO commits
       (hash, short_hash, author_name, author_email, author_date, committer_date,
        subject, body, parents, pr_number, pr_title, pr_body, issue_refs)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  );

  const keptHashes = new Set<string>();
  const tx = shadow.transaction((rows: CommitRow[]) => {
    for (const r of rows) {
      if ((r.author_email ?? "").toLowerCase() === target) continue;
      // Strip the target's co-author trailer if present.
      const cleanedBody = stripCoAuthorTrailer(r.body, target);
      insertCommit.run(
        r.hash,
        r.short_hash,
        r.author_name,
        r.author_email,
        r.author_date,
        r.committer_date,
        r.subject,
        cleanedBody,
        r.parents,
        r.pr_number,
        r.pr_title,
        r.pr_body,
        r.issue_refs,
      );
      keptHashes.add(r.hash);
    }
  });
  tx(commits);

  const fileRows = source.db
    .prepare("SELECT commit_hash, path, change_kind, insertions, deletions FROM file_changes")
    .all() as unknown as FileRow[];
  const insertFile = shadow.db.prepare(
    `INSERT OR REPLACE INTO file_changes
       (commit_hash, path, change_kind, insertions, deletions)
     VALUES (?, ?, ?, ?, ?)`,
  );
  const fileTx = shadow.transaction((rows: FileRow[]) => {
    for (const r of rows) {
      if (!keptHashes.has(r.commit_hash)) continue;
      insertFile.run(r.commit_hash, r.path, r.change_kind, r.insertions, r.deletions);
    }
  });
  fileTx(fileRows);

  return shadow;
}

/** Remove a single Co-authored-by trailer line whose email matches `target`. */
export function stripCoAuthorTrailer(body: string, target: string): string {
  if (!body) return body;
  const targetLc = target.toLowerCase();
  const lines = body.split(/\r?\n/);
  const out: string[] = [];
  for (const line of lines) {
    const m = line.match(/^Co-authored-by:\s*[^<\n\r]+<([^>\n\r]+)>/i);
    if (m && m[1]!.trim().toLowerCase() === targetLc) continue;
    out.push(line);
  }
  return out.join("\n");
}

// ─── core simulation ───────────────────────────────────────────────────

const DEFAULT_TOP_N = 10;

/**
 * Run the counterfactual simulation.
 *
 * Caller is responsible for closing `source`. The shadow store is created
 * and closed inside this function.
 */
export function runCounterfactual(
  source: MnemeStore,
  opts: CounterfactualOptions,
): CounterfactualReport {
  const target = opts.authorEmail.trim().toLowerCase();
  const topN = Math.max(1, opts.topN ?? DEFAULT_TOP_N);

  const commitsBefore = countCommits(source);
  const authorsBefore = countAuthors(source);
  const filesBefore = countFiles(source);
  const presence = source.db
    .prepare("SELECT COUNT(*) AS n FROM commits WHERE LOWER(author_email) = ?")
    .get(target) as { n: number };
  const authorWasPresent = presence.n > 0;

  if (!authorWasPresent) {
    return emptyReport(target, {
      commitsBefore,
      authorsBefore,
      filesBefore,
      remainingContributors: authorsBefore,
      reason: "author-not-found",
    });
  }

  const shadow = buildShadowStore(source, target);
  try {
    const commitsAfter = countCommits(shadow);
    const authorsAfter = countAuthors(shadow);
    const filesAfter = countFiles(shadow);

    if (authorsAfter === 0) {
      return emptyReport(target, {
        commitsBefore,
        authorsBefore,
        filesBefore,
        remainingContributors: 0,
        reason: "no-other-contributors",
      });
    }

    // ─── atrophy before / after ──────────────────────────────────────
    // We use atrophyForFile() per candidate path so we get the FULL story
    // (safe files included), not just the top-N at-risk list. The candidate
    // set is "every file the target author ever touched" — that's exactly
    // the set whose ownership could possibly shift. Limiting the scan keeps
    // this fast even on huge repos.
    const candidateFiles = source.db
      .prepare(
        `SELECT DISTINCT fc.path AS path
           FROM file_changes fc
           JOIN commits c ON c.hash = fc.commit_hash
          WHERE LOWER(c.author_email) = ?`,
      )
      .all(target) as Array<{ path: string }>;

    const beforeByFile = new Map<string, FileKnowledge>();
    const afterByFile = new Map<string, FileKnowledge>();
    for (const row of candidateFiles) {
      const before = atrophyForFile(source, row.path, {
        halfLifeDays: opts.halfLifeDays,
        asOf: opts.asOf,
      });
      if (before) beforeByFile.set(row.path, before);
      const after = atrophyForFile(shadow, row.path, {
        halfLifeDays: opts.halfLifeDays,
        asOf: opts.asOf,
      });
      if (after) afterByFile.set(row.path, after);
    }

    const fileShifts: FileExpertChange[] = [];
    const filesLoseLastExpert: FileKnowledge[] = [];
    let knowledgeMassRemoved = 0;

    // Iterate the union of file paths — a file that was safe before
    // (and therefore absent from `atRiskFiles`) but becomes at-risk after
    // is exactly the kind of shift we want to surface.
    const unionPaths = new Set<string>();
    for (const k of beforeByFile.keys()) unionPaths.add(k);
    for (const k of afterByFile.keys()) unionPaths.add(k);

    for (const filePath of unionPaths) {
      const before = beforeByFile.get(filePath);
      const after = afterByFile.get(filePath);
      // We're iterating files the target ever touched; "before" is reliable.
      // "after" being undefined means the file has zero remaining touches.
      const freshestBefore = before?.freshestKnowledge ?? 0;
      const freshestAfter = after?.freshestKnowledge ?? 0;
      const massDelta = Math.max(0, freshestBefore - freshestAfter);
      knowledgeMassRemoved += massDelta;

      // Determine shift class.
      let shift: FileExpertChange["shift"] = "no-impact";
      const tierBefore = before?.tier ?? "at-risk";
      const tierAfter = after?.tier ?? "at-risk";
      const liveBefore = before?.liveExperts.length ?? 0;
      const liveAfter = after?.liveExperts.length ?? 0;
      const lostLive = liveBefore > 0 && liveAfter === 0 && before !== undefined;
      const topAuthorBefore = before?.allKnowers[0]?.email.toLowerCase();
      const topWasTarget = topAuthorBefore === target;

      if (lostLive && before) {
        shift = "lost-only-expert";
        filesLoseLastExpert.push(before);
      } else if (topWasTarget) {
        shift = "lost-top-expert";
      } else if (tierWeight(tierBefore) > tierWeight(tierAfter)) {
        shift = "tier-degraded";
      }

      if (shift !== "no-impact") {
        fileShifts.push({
          filePath,
          totalTouches: before?.totalTouches ?? after?.totalTouches ?? 0,
          tierBefore,
          tierAfter,
          freshestBefore: round3(freshestBefore),
          freshestAfter: round3(freshestAfter),
          shift,
        });
      }
    }

    fileShifts.sort((a, b) => {
      const w = shiftWeight(b.shift) - shiftWeight(a.shift);
      if (w !== 0) return w;
      return b.freshestBefore - b.freshestAfter - (a.freshestBefore - a.freshestAfter);
    });

    // ─── telepathy before / after ────────────────────────────────────
    const telepathyOpts = {
      windowHours: opts.telepathyWindowHours ?? 48,
      minEvents: opts.telepathyMinEvents ?? 3,
      topN: 1000,
    };
    const telepathyBefore = telepathy(source, telepathyOpts);
    const telepathyAfter = telepathy(shadow, telepathyOpts);

    const pairChanges = diffTelepathy(telepathyBefore, telepathyAfter, target);

    const report: CounterfactualReport = {
      authorEmail: target,
      authorWasPresent: true,
      remainingContributors: authorsAfter,
      meta: {
        commitsBefore,
        commitsAfter,
        authorsBefore,
        authorsAfter,
        filesBefore,
        filesAfter,
      },
      atrophy: {
        knowledgeMassRemoved: round2(knowledgeMassRemoved),
        filesLoseLastExpert: filesLoseLastExpert
          .sort((a, b) => b.totalTouches - a.totalTouches)
          .slice(0, topN),
        fileShifts: fileShifts.slice(0, topN),
      },
      telepathy: {
        pairsBefore: telepathyBefore.pairs.slice(0, topN),
        pairsAfter: telepathyAfter.pairs.slice(0, topN),
        vanishedPairs: pairChanges.vanished.slice(0, topN),
        rankShifts: pairChanges.shifted.slice(0, topN),
      },
      narrative: "",
    };
    report.narrative = buildNarrative(report);
    return report;
  } finally {
    shadow.close();
  }
}

// ─── helpers ───────────────────────────────────────────────────────────

function countCommits(s: MnemeStore): number {
  return (s.db.prepare("SELECT COUNT(*) AS n FROM commits").get() as { n: number }).n;
}

function countAuthors(s: MnemeStore): number {
  return (
    s.db.prepare("SELECT COUNT(DISTINCT author_email) AS n FROM commits").get() as {
      n: number;
    }
  ).n;
}

function countFiles(s: MnemeStore): number {
  return (s.db.prepare("SELECT COUNT(DISTINCT path) AS n FROM file_changes").get() as { n: number }).n;
}

const TIER_RANK: Record<"safe" | "warn" | "at-risk", number> = {
  safe: 2,
  warn: 1,
  "at-risk": 0,
};
function tierWeight(t: "safe" | "warn" | "at-risk"): number {
  return TIER_RANK[t];
}

const SHIFT_WEIGHT: Record<FileExpertChange["shift"], number> = {
  "lost-only-expert": 3,
  "lost-top-expert": 2,
  "tier-degraded": 1,
  "no-impact": 0,
};
function shiftWeight(s: FileExpertChange["shift"]): number {
  return SHIFT_WEIGHT[s];
}

function diffTelepathy(
  before: TelepathyResult,
  after: TelepathyResult,
  target: string,
): { vanished: PairChange[]; shifted: PairChange[] } {
  const beforeIdx = new Map<string, { pair: TelepathyPair; rank: number }>();
  before.pairs.forEach((p, i) =>
    beforeIdx.set(pairKey(p), { pair: p, rank: i + 1 }),
  );
  const afterIdx = new Map<string, { pair: TelepathyPair; rank: number }>();
  after.pairs.forEach((p, i) => afterIdx.set(pairKey(p), { pair: p, rank: i + 1 }));

  const vanished: PairChange[] = [];
  const shifted: PairChange[] = [];

  for (const [key, { pair, rank }] of beforeIdx) {
    const a = afterIdx.get(key);
    const involvesTarget =
      pair.authorA.email.toLowerCase() === target ||
      pair.authorB.email.toLowerCase() === target;
    if (!a) {
      // Pair vanished — only meaningful if the target was in it.
      if (involvesTarget) {
        vanished.push({
          authorA: pair.authorA.email,
          authorB: pair.authorB.email,
          scoreBefore: pair.score,
          scoreAfter: 0,
          rankBefore: rank,
          rankAfter: null,
          shift: "vanished",
        });
      }
    } else if (a.rank !== rank) {
      shifted.push({
        authorA: pair.authorA.email,
        authorB: pair.authorB.email,
        scoreBefore: pair.score,
        scoreAfter: a.pair.score,
        rankBefore: rank,
        rankAfter: a.rank,
        shift: "rank-shift",
      });
    }
  }

  vanished.sort((a, b) => b.scoreBefore - a.scoreBefore);
  shifted.sort(
    (a, b) =>
      Math.abs((a.rankBefore ?? 0) - (a.rankAfter ?? 0)) -
      Math.abs((b.rankBefore ?? 0) - (b.rankAfter ?? 0)),
  );
  return { vanished, shifted };
}

function pairKey(p: TelepathyPair): string {
  const [a, b] = [p.authorA.email, p.authorB.email].sort();
  return `${a}|${b}`;
}

// ─── narrative + degenerate paths ──────────────────────────────────────

function emptyReport(
  target: string,
  ctx: {
    commitsBefore: number;
    authorsBefore: number;
    filesBefore: number;
    remainingContributors: number;
    reason: "author-not-found" | "no-other-contributors";
  },
): CounterfactualReport {
  const narrative =
    ctx.reason === "author-not-found"
      ? `No commits found for ${target}. Either the email is misspelled, or the author truly never contributed to this repo.`
      : `${target} is the only contributor to this repo. A counterfactual without them produces an empty repo — there is nothing to redistribute.`;
  return {
    authorEmail: target,
    authorWasPresent: ctx.reason !== "author-not-found",
    remainingContributors: ctx.remainingContributors,
    meta: {
      commitsBefore: ctx.commitsBefore,
      commitsAfter: ctx.commitsBefore,
      authorsBefore: ctx.authorsBefore,
      authorsAfter: ctx.authorsBefore,
      filesBefore: ctx.filesBefore,
      filesAfter: ctx.filesBefore,
    },
    atrophy: {
      knowledgeMassRemoved: 0,
      filesLoseLastExpert: [],
      fileShifts: [],
    },
    telepathy: {
      pairsBefore: [],
      pairsAfter: [],
      vanishedPairs: [],
      rankShifts: [],
    },
    narrative,
  };
}

function buildNarrative(r: CounterfactualReport): string {
  const lostFiles = r.atrophy.filesLoseLastExpert.length;
  const tierShifts = r.atrophy.fileShifts.filter((s) => s.shift !== "no-impact").length;
  const vanishedPairs = r.telepathy.vanishedPairs.length;

  const parts: string[] = [];
  if (lostFiles > 0) {
    parts.push(
      `${lostFiles} file${lostFiles === 1 ? "" : "s"} lose their last live expert without ${r.authorEmail}`,
    );
  } else if (tierShifts > 0) {
    parts.push(
      `no file is fully orphaned, but ${tierShifts} would shift to a worse safety tier`,
    );
  } else {
    parts.push(`every file retains an alternate expert — knowledge is well-distributed`);
  }
  if (vanishedPairs > 0) {
    parts.push(
      `${vanishedPairs} latent pair${vanishedPairs === 1 ? "" : "s"} disappear (their telepathy was anchored to ${r.authorEmail})`,
    );
  }
  parts.push(
    `Bayesian what-if; not a prediction. Treat as a heat-map of where to invest in pairing or documentation.`,
  );
  return parts.join(". ") + ".";
}

// ─── small math ────────────────────────────────────────────────────────

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

function round3(n: number): number {
  return Math.round(n * 1000) / 1000;
}

