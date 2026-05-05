/**
 * `mneme chronicle` — auto-generate a narrative documentary of the repo,
 * told as chapters. Detects significant epochs across the WHOLE repo
 * (not a single file like time-machine), names each chapter, and emits
 * markdown ready to export to PDF/EPUB.
 *
 * Pure data extraction. CLI renders + optional LLM polish for prose.
 */
import type { Commit } from "../types.js";

export interface Chapter {
  number: number;
  title: string;
  /** Sub-title evoking what happened (extractive). */
  subtitle: string;
  fromDate: string;
  toDate: string;
  spanDays: number;
  commits: Commit[];
  /** Top contributor of this chapter. */
  protagonist: string;
  /** Opening paragraph (extractive — first informative commit). */
  opening: string;
  /** Closing paragraph. */
  closing: string;
}

export interface Chronicle {
  totalCommits: number;
  totalDays: number;
  chapters: Chapter[];
}

const TITLES = [
  "The Founding",
  "The First Expansion",
  "The Auth Wars",
  "The Great Refactor",
  "The Quiet Year",
  "The Reckoning",
  "The New Era",
  "The Revival",
  "The Architecture Schism",
  "The Stabilization",
];

/**
 * Build chapters from commit history. We split history into epochs
 * detected by long gaps OR by sudden churn shifts (rewrite events).
 */
export function buildChronicle(
  commits: Commit[],
  opts: { gapDays?: number; minChapterCommits?: number } = {},
): Chronicle {
  const gapDays = opts.gapDays ?? 30;
  const minChapter = opts.minChapterCommits ?? 5;

  const sorted = [...commits].sort((a, b) =>
    a.authorDate.localeCompare(b.authorDate),
  );
  if (sorted.length === 0) {
    return { totalCommits: 0, totalDays: 0, chapters: [] };
  }

  // First pass: split by long gaps
  const groups: Commit[][] = [];
  let current: Commit[] = [sorted[0]!];
  for (let i = 1; i < sorted.length; i++) {
    const prev = sorted[i - 1]!;
    const cur = sorted[i]!;
    const gap = (new Date(cur.authorDate).getTime() - new Date(prev.authorDate).getTime()) / 86_400_000;
    if (gap >= gapDays && current.length >= minChapter) {
      groups.push(current);
      current = [cur];
    } else {
      current.push(cur);
    }
  }
  groups.push(current);

  // Build chapters
  const chapters: Chapter[] = [];
  for (let i = 0; i < groups.length; i++) {
    const g = groups[i]!;
    if (g.length === 0) continue;
    const fromDate = g[0]!.authorDate.slice(0, 10);
    const toDate = g[g.length - 1]!.authorDate.slice(0, 10);
    const spanDays = Math.max(
      0,
      Math.round(
        (new Date(toDate).getTime() - new Date(fromDate).getTime()) / 86_400_000,
      ),
    );
    chapters.push({
      number: i + 1,
      title: titleFor(i, g),
      subtitle: subtitleFor(g),
      fromDate,
      toDate,
      spanDays,
      commits: g,
      protagonist: protagonistOf(g),
      opening: openingOf(g),
      closing: closingOf(g),
    });
  }

  const totalDays = Math.round(
    (new Date(sorted[sorted.length - 1]!.authorDate).getTime() -
      new Date(sorted[0]!.authorDate).getTime()) /
      86_400_000,
  );
  return {
    totalCommits: sorted.length,
    totalDays,
    chapters,
  };
}

/** Render chronicle as markdown ready to write to disk. */
export function renderChronicle(chronicle: Chronicle): string {
  if (chronicle.chapters.length === 0) {
    return "# Codebase Chronicles\n\n_No commits to chronicle yet._\n";
  }
  const lines: string[] = [];
  lines.push("# Chronicles of Your Codebase");
  lines.push("");
  lines.push(`> ${chronicle.totalCommits} commits across ${chronicle.totalDays} days, told in ${chronicle.chapters.length} chapters.`);
  lines.push("");
  lines.push("---");
  lines.push("");
  for (const ch of chronicle.chapters) {
    lines.push(`## Chapter ${ch.number} · ${ch.title}`);
    lines.push("");
    lines.push(`*${ch.subtitle}*`);
    lines.push("");
    lines.push(`**${ch.fromDate} → ${ch.toDate}** · ${ch.spanDays} days · ${ch.commits.length} commits · protagonist: **@${ch.protagonist}**`);
    lines.push("");
    lines.push(ch.opening);
    lines.push("");
    if (ch.closing && ch.closing !== ch.opening) {
      lines.push(ch.closing);
      lines.push("");
    }
    lines.push("---");
    lines.push("");
  }
  return lines.join("\n");
}

function titleFor(idx: number, commits: Commit[]): string {
  if (idx === 0) return "The Founding";
  // detect refactor cluster
  const text = commits
    .map((c) => c.subject + " " + (c.body || ""))
    .join(" ")
    .toLowerCase();
  if (/\b(rewrite|refactor|migrate|overhaul)\b/.test(text)) {
    return "The Great Refactor";
  }
  if (/\b(hotfix|incident|outage|critical|emergency)\b/.test(text)) {
    return "The Reckoning";
  }
  if (commits.length < 8) {
    return "The Quiet Stretch";
  }
  return TITLES[Math.min(idx, TITLES.length - 1)] ?? `Era ${idx + 1}`;
}

function subtitleFor(commits: Commit[]): string {
  // Prefer the longest subject from the first 5 commits as flavor
  const top = commits
    .slice(0, 5)
    .reduce((best, c) => (c.subject.length > best.subject.length ? c : best), commits[0]!);
  return truncate(top.subject, 100);
}

function protagonistOf(commits: Commit[]): string {
  const counts = new Map<string, number>();
  for (const c of commits) {
    const key = c.authorName || c.authorEmail;
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  let best = "unknown";
  let bestN = -1;
  for (const [k, n] of counts) {
    if (n > bestN) {
      bestN = n;
      best = k;
    }
  }
  return best;
}

function openingOf(commits: Commit[]): string {
  // Use the first commit's subject as the opening sentence
  const first = commits[0]!;
  const author = first.authorName || first.authorEmail.split("@")[0] || "the team";
  return `On **${first.authorDate.slice(0, 10)}**, ${author} began with: *"${truncate(first.subject, 120)}"*. ${commits.length} commits would follow over ${humanSpan(commits)}.`;
}

function closingOf(commits: Commit[]): string {
  const last = commits[commits.length - 1]!;
  return `By **${last.authorDate.slice(0, 10)}**, the chapter closed with *"${truncate(last.subject, 120)}"*.`;
}

function humanSpan(commits: Commit[]): string {
  if (commits.length < 2) return "a single day";
  const first = new Date(commits[0]!.authorDate).getTime();
  const last = new Date(commits[commits.length - 1]!.authorDate).getTime();
  const days = Math.max(1, Math.round((last - first) / 86_400_000));
  if (days < 30) return `${days} day${days === 1 ? "" : "s"}`;
  if (days < 365) return `${Math.round(days / 30)} months`;
  return `${(days / 365).toFixed(1)} years`;
}

function truncate(s: string, n: number): string {
  const oneLine = s.replace(/\s+/g, " ").trim();
  return oneLine.length <= n ? oneLine : oneLine.slice(0, n - 1).trimEnd() + "…";
}
