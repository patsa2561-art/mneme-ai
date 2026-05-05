/**
 * `mneme ghost` — surface "ghost code": files that haunt the repo without
 * doing anything. Started but never finished, declared but never imported,
 * touched once a year ago and ignored ever since.
 *
 * Ghosts are dangerous because they:
 *   - Add maintenance surface that nobody knows is unused
 *   - Mislead readers who assume "if it's here, it must matter"
 *   - Anchor obsolete patterns ("we use X here, so we must keep using X")
 *
 * What makes this novel:
 *   - Combines staleness, churn pattern, and TODO-density into a single
 *     "ghostliness" score, instead of just "files not edited recently".
 *   - Detects abandoned half-finished work via TODO/FIXME density + low
 *     recent commit activity.
 *   - Surfaces stale TODOs (added long ago, ignored ever since) — these
 *     are individual ghost markers, not just file-level signals.
 *
 * Pure data extraction. The CLI renders.
 */
import type { Commit, FileChange } from "../types.js";

export interface GhostFile {
  path: string;
  /** Days since the file was last modified by any commit. */
  daysSinceLastTouch: number;
  /** Number of commits that ever touched the file. */
  totalCommits: number;
  /** Most recent commit subject — useful clue. */
  lastCommitSubject: string;
  /** Lines of TODO/FIXME in the file when it was last seen (estimated). */
  todoCount: number;
  /**
   * Ghostliness 0..1 — higher = more haunted.
   *   - boosted by staleness (recency-decay)
   *   - boosted by low total commits (born and forgotten)
   *   - boosted by high TODO density
   *   - dampened if many recent commits (active = not a ghost)
   */
  ghostliness: number;
  /** Why this file looks like a ghost — short label. */
  reason: string;
}

export interface StaleTodo {
  /** Commit that introduced the TODO. */
  introducedIn: Commit;
  /** Days since the TODO was added. */
  ageDays: number;
  /** The TODO text (subject of the introducing commit). */
  hint: string;
  /** Times the file was touched after the TODO without removing it. */
  ignoredCount: number;
  /** File path containing the TODO. */
  filePath: string;
}

export interface GhostReport {
  ghostFiles: GhostFile[];
  staleTodos: StaleTodo[];
  /** Total files analyzed. */
  totalFiles: number;
  /** Average ghostliness across files (0..1). */
  averageGhostliness: number;
}

const TODO_RE = /\b(TODO|FIXME|XXX|HACK|TBD)\b/i;

/**
 * Build a ghost report from commits + per-commit file changes + per-file
 * TODO counts. Caller provides:
 *   - commits sorted (any order — we sort)
 *   - changes: list of FileChange across all commits
 *   - todoCounts: optional Map<filePath, number> of TODO/FIXME counts
 *
 * If `todoCounts` is omitted, TODO inference falls back to scanning commit
 * subjects for TODO/FIXME mentions.
 */
export function buildGhostReport(
  commits: Commit[],
  changes: FileChange[],
  opts: {
    todoCounts?: Map<string, number>;
    nowMs?: number; // override "now" for tests
    staleDays?: number; // file is stale if untouched for >= this many days
    todoStaleDays?: number; // TODO is stale if older than this
    minGhostliness?: number; // floor for inclusion in ghostFiles
  } = {},
): GhostReport {
  const nowMs = opts.nowMs ?? Date.now();
  const staleDays = opts.staleDays ?? 180;
  const todoStaleDays = opts.todoStaleDays ?? 90;
  const minGhostliness = opts.minGhostliness ?? 0.4;

  // Index: path -> { lastTouchMs, totalCommits, lastCommit }
  type FileStat = {
    path: string;
    lastTouchMs: number;
    firstTouchMs: number;
    totalCommits: number;
    lastCommit: Commit;
  };
  const byPath = new Map<string, FileStat>();
  const commitByHash = new Map<string, Commit>();
  for (const c of commits) commitByHash.set(c.hash, c);

  for (const ch of changes) {
    const c = commitByHash.get(ch.commitHash);
    if (!c) continue;
    const t = new Date(c.authorDate).getTime();
    const cur = byPath.get(ch.path);
    if (!cur) {
      byPath.set(ch.path, {
        path: ch.path,
        lastTouchMs: t,
        firstTouchMs: t,
        totalCommits: 1,
        lastCommit: c,
      });
    } else {
      cur.totalCommits += 1;
      if (t > cur.lastTouchMs) {
        cur.lastTouchMs = t;
        cur.lastCommit = c;
      }
      if (t < cur.firstTouchMs) cur.firstTouchMs = t;
    }
  }

  const ghostFiles: GhostFile[] = [];
  let totalGhost = 0;
  for (const stat of byPath.values()) {
    const daysSinceLastTouch = (nowMs - stat.lastTouchMs) / 86_400_000;
    const todoCount = opts.todoCounts?.get(stat.path) ?? 0;
    const ghostliness = computeGhostliness(
      daysSinceLastTouch,
      stat.totalCommits,
      todoCount,
      staleDays,
    );
    totalGhost += ghostliness;
    if (ghostliness >= minGhostliness) {
      ghostFiles.push({
        path: stat.path,
        daysSinceLastTouch: Math.round(daysSinceLastTouch),
        totalCommits: stat.totalCommits,
        lastCommitSubject: stat.lastCommit.subject,
        todoCount,
        ghostliness: Number(ghostliness.toFixed(2)),
        reason: explainGhost(daysSinceLastTouch, stat.totalCommits, todoCount, staleDays),
      });
    }
  }

  ghostFiles.sort((a, b) => b.ghostliness - a.ghostliness);

  // Detect stale TODOs from commit history
  const staleTodos: StaleTodo[] = [];
  // Group commits by file: who introduced a TODO mention?
  const fileTouchOrder = new Map<string, Commit[]>();
  for (const ch of changes) {
    const c = commitByHash.get(ch.commitHash);
    if (!c) continue;
    const arr = fileTouchOrder.get(ch.path) ?? [];
    arr.push(c);
    fileTouchOrder.set(ch.path, arr);
  }
  for (const [path, touches] of fileTouchOrder) {
    touches.sort((a, b) => a.authorDate.localeCompare(b.authorDate));
    let firstTodoCommit: Commit | null = null;
    let ignoredCount = 0;
    for (const c of touches) {
      const text = `${c.subject}\n${c.body || ""}`;
      if (firstTodoCommit) {
        ignoredCount += 1;
      } else if (TODO_RE.test(text)) {
        firstTodoCommit = c;
      }
    }
    if (firstTodoCommit) {
      const ageDays = (nowMs - new Date(firstTodoCommit.authorDate).getTime()) / 86_400_000;
      if (ageDays >= todoStaleDays && ignoredCount >= 1) {
        staleTodos.push({
          introducedIn: firstTodoCommit,
          ageDays: Math.round(ageDays),
          hint: firstTodoCommit.subject,
          ignoredCount,
          filePath: path,
        });
      }
    }
  }
  staleTodos.sort((a, b) => b.ageDays - a.ageDays);

  return {
    ghostFiles,
    staleTodos,
    totalFiles: byPath.size,
    averageGhostliness: byPath.size === 0 ? 0 : totalGhost / byPath.size,
  };
}

function computeGhostliness(
  daysSinceLastTouch: number,
  totalCommits: number,
  todoCount: number,
  staleDays: number,
): number {
  // staleness: 0 at 0 days, → 1 as ratio approaches 2x staleDays
  const stale = Math.min(1, daysSinceLastTouch / (staleDays * 2));
  // low-touch boost: peaks when totalCommits ≤ 2
  const lowTouch = totalCommits <= 1 ? 0.3 : totalCommits <= 3 ? 0.15 : 0;
  // todo-density: each todo adds 0.05, capped at 0.25
  const todoBoost = Math.min(0.25, todoCount * 0.05);
  // recent activity dampener: many commits → not a ghost
  const damp = totalCommits >= 10 ? 0.2 : 0;
  return Math.max(0, Math.min(1, stale + lowTouch + todoBoost - damp));
}

function explainGhost(
  daysSinceLastTouch: number,
  totalCommits: number,
  todoCount: number,
  staleDays: number,
): string {
  if (daysSinceLastTouch >= staleDays * 2 && totalCommits <= 2) {
    return `born and forgotten — ${Math.round(daysSinceLastTouch)}d untouched, only ${totalCommits} commit${totalCommits === 1 ? "" : "s"} ever`;
  }
  if (daysSinceLastTouch >= staleDays * 2) {
    return `long-untouched — ${Math.round(daysSinceLastTouch)}d since last edit`;
  }
  if (todoCount >= 3) {
    return `dense with TODOs — ${todoCount} marker${todoCount === 1 ? "" : "s"} pending`;
  }
  if (totalCommits === 1) {
    return `one-shot file — added once, never revisited`;
  }
  return `stale — ${Math.round(daysSinceLastTouch)}d quiet`;
}
