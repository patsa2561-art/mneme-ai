/**
 * Karma — TODO/FIXME debt as an accumulating ledger.
 *
 * Each `TODO|FIXME|XXX|HACK` line added in a commit becomes a *debit* on the
 * author's karma. Each one removed becomes a *credit*. Net debt compounds with
 * age — a 6-month-old unkept TODO is worth more debt than a 1-week-old one.
 *
 * Why this matters: every code review tool counts TODOs at HEAD ("you have
 * 1,243 TODOs"). None track them as a *flow*. The flow signal is the part
 * that distinguishes "we incur and settle TODOs in equilibrium" from "we
 * incur faster than we settle, debt is silently mounting." Karma is that
 * flow signal — at the author level.
 */
import { execGitOk } from "../git/exec.js";

export type KarmaMarker = "TODO" | "FIXME" | "XXX" | "HACK";

export interface KarmaEvent {
  /** Author email (canonical id). */
  email: string;
  /** Author display name (best-effort). */
  name: string;
  commit: string;
  /** Unix seconds. */
  timestamp: number;
  filePath: string;
  marker: KarmaMarker;
  /** The text of the TODO line (without the marker prefix). */
  content: string;
  /** "incurred" = this commit added a TODO; "settled" = removed one. */
  type: "incurred" | "settled";
}

export interface ScanOptions {
  cwd: string;
  /** Only consider commits since this date (ISO 8601 or git-parseable). */
  since?: string;
  /** Restrict to a path prefix (e.g. "packages/core/"). */
  pathPrefix?: string;
  /** Hard cap on commits scanned (most-recent N). 0 = unlimited. */
  maxCommits?: number;
}

const MARKER_RE = /\b(TODO|FIXME|XXX|HACK)\b\s*[:\-]?\s*(.*)$/i;

/** Walk git history and return every karma event (incurrence or settlement). */
export async function scanKarma(opts: ScanOptions): Promise<KarmaEvent[]> {
  const args: string[] = [
    "log",
    "--diff-filter=AMD",
    "--no-merges",
    "-U0",
    "--pretty=format:--MNEME-COMMIT--%n%H%n%ae%n%an%n%at%n",
  ];
  if (opts.since) args.push(`--since=${opts.since}`);
  if (opts.maxCommits && opts.maxCommits > 0) args.push(`-n`, String(opts.maxCommits));
  if (opts.pathPrefix) args.push("--", opts.pathPrefix);

  const out = await execGitOk(args, { cwd: opts.cwd });
  return parseLog(out);
}

interface CommitMeta {
  commit: string;
  email: string;
  name: string;
  timestamp: number;
}

/** Parse git log -p output into karma events. Robust to weirdness:
 *  ignores binary diffs, file-rename headers, hunk markers. */
export function parseLog(raw: string): KarmaEvent[] {
  const events: KarmaEvent[] = [];
  if (!raw.trim()) return events;

  const blocks = raw.split("--MNEME-COMMIT--\n").filter((b) => b.trim().length > 0);
  for (const block of blocks) {
    const lines = block.split("\n");
    if (lines.length < 5) continue;
    const meta: CommitMeta = {
      commit: lines[0]!.trim(),
      email: lines[1]!.trim().toLowerCase(),
      name: lines[2]!.trim(),
      timestamp: Number(lines[3]!.trim()) || 0,
    };
    if (!meta.commit) continue;

    let currentFile: string | null = null;
    for (let i = 4; i < lines.length; i++) {
      const line = lines[i]!;
      // File header — `diff --git a/<old> b/<new>`
      if (line.startsWith("diff --git ")) {
        const m = /^diff --git a\/(.+?) b\/(.+)$/.exec(line);
        currentFile = m ? m[2]! : null;
        continue;
      }
      // Skip diff metadata lines
      if (
        line.startsWith("index ") ||
        line.startsWith("--- ") ||
        line.startsWith("+++ ") ||
        line.startsWith("Binary files ") ||
        line.startsWith("similarity index") ||
        line.startsWith("rename from") ||
        line.startsWith("rename to") ||
        line.startsWith("new file mode") ||
        line.startsWith("deleted file mode") ||
        line.startsWith("@@")
      ) {
        continue;
      }
      if (!currentFile) continue;

      const isAdd = line.startsWith("+") && !line.startsWith("+++");
      const isDel = line.startsWith("-") && !line.startsWith("---");
      if (!isAdd && !isDel) continue;

      const content = line.slice(1);
      const m = MARKER_RE.exec(content);
      if (!m) continue;

      const marker = m[1]!.toUpperCase() as KarmaMarker;
      const text = (m[2] ?? "").trim();
      events.push({
        email: meta.email,
        name: meta.name,
        commit: meta.commit,
        timestamp: meta.timestamp,
        filePath: currentFile,
        marker,
        content: text,
        type: isAdd ? "incurred" : "settled",
      });
    }
  }
  return events;
}
