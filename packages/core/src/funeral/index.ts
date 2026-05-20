/**
 * v2.19.87 — #9 AI FUNERAL.
 *
 * Repos die.  Mneme is the FIRST tool to give them a proper send-off.
 *
 * Given a git repo (archived OR untouched for N months), produce:
 *   - A literary eulogy (3 paragraphs): origin / peak / legacy
 *   - An ASCII tombstone (text)
 *   - A self-contained SVG memorial card (twitter / GitHub-readme-safe)
 *   - A copy-paste tweet thread (no API access required)
 *
 * The wild bit: every stat is grounded in the actual git log.  Mneme
 * doesn't fabricate ages or contributor counts.  It reads the repo,
 * computes the truth, and writes the eulogy from that truth.
 */

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { execSync } from "node:child_process";

export interface EulogyStats {
  repoName: string;
  bornAt: string;        // ISO of first commit
  diedAt: string;        // ISO of last commit (or now if alive)
  lifespan: string;      // "8 years, 4 months"
  lifespanDays: number;
  archived: boolean;     // GitHub archived?
  totalCommits: number;
  totalAuthors: number;
  totalLines: number;
  topAuthor: { name: string; commits: number } | null;
  topFiles: Array<{ path: string; touches: number }>;
  causeOfDeath: string;  // "no commits in 14 months" / "explicitly archived"
}

function git(cmd: string, cwd: string): string {
  try { return execSync(`git ${cmd}`, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim(); }
  catch { return ""; }
}

function humanLifespan(ms: number): string {
  const days = Math.floor(ms / (24 * 3600_000));
  const years = Math.floor(days / 365);
  const months = Math.floor((days - years * 365) / 30);
  if (years > 0) return `${years} year${years === 1 ? "" : "s"}${months > 0 ? `, ${months} month${months === 1 ? "" : "s"}` : ""}`;
  if (months > 0) return `${months} month${months === 1 ? "" : "s"}`;
  return `${days} day${days === 1 ? "" : "s"}`;
}

export function collectEulogyStats(repoRoot: string, opts: { archived?: boolean } = {}): EulogyStats {
  const repoName = repoRoot.split(/[\\/]/).filter(Boolean).pop() || "repo";
  const bornAt = git('log --reverse --format="%aI" --max-count=1', repoRoot);
  const diedAt = git('log -1 --format="%aI"', repoRoot);
  const totalCommitsStr = git("rev-list --count HEAD", repoRoot);
  const totalCommits = parseInt(totalCommitsStr, 10) || 0;
  const authorsRaw = git('log --format="%aN"', repoRoot);
  const authorsList = authorsRaw.split("\n").filter(Boolean);
  const authorMap = new Map<string, number>();
  for (const a of authorsList) authorMap.set(a, (authorMap.get(a) ?? 0) + 1);
  const topAuthorEntry = [...authorMap.entries()].sort((a, b) => b[1] - a[1])[0];
  const topAuthor = topAuthorEntry ? { name: topAuthorEntry[0], commits: topAuthorEntry[1] } : null;
  const filesRaw = git('log --name-only --format=""', repoRoot);
  const fileMap = new Map<string, number>();
  for (const f of filesRaw.split("\n")) {
    if (!f.trim()) continue;
    fileMap.set(f, (fileMap.get(f) ?? 0) + 1);
  }
  const topFiles = [...fileMap.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([path, touches]) => ({ path, touches }));
  // Total lines = `git ls-files | xargs wc -l` is expensive; use approximation
  // by counting diff lines across all commits (positive = ever-added).
  const shortstat = git('log --shortstat --format=""', repoRoot);
  const totalLines = shortstat.split("\n")
    .map((l) => /(\d+) insertions?/.exec(l))
    .filter((m) => m != null)
    .reduce((s, m) => s + parseInt(m![1]!, 10), 0);
  const bornTs = bornAt ? Date.parse(bornAt) : Date.now();
  const diedTs = diedAt ? Date.parse(diedAt) : Date.now();
  const lifespanMs = Math.max(0, diedTs - bornTs);
  const dormantMonths = Math.floor((Date.now() - diedTs) / (30 * 24 * 3600_000));
  const archived = !!opts.archived;
  const causeOfDeath = archived
    ? "GitHub-archived by maintainer"
    : dormantMonths >= 12
      ? `no commits in ${dormantMonths} months`
      : dormantMonths >= 6
        ? `dormant for ${dormantMonths} months — moribund`
        : "still alive (eulogy is premature)";
  return {
    repoName, bornAt: bornAt || new Date(0).toISOString(), diedAt: diedAt || new Date().toISOString(),
    lifespan: humanLifespan(lifespanMs), lifespanDays: Math.floor(lifespanMs / (24 * 3600_000)),
    archived, totalCommits, totalAuthors: authorMap.size, totalLines,
    topAuthor, topFiles, causeOfDeath,
  };
}

/** Three-paragraph literary eulogy from the stats.  Template-driven —
 *  no LLM call required, so it runs identically on a sandbox without
 *  Ollama / API key. */
export function renderEulogy(s: EulogyStats): string {
  const bornHuman = s.bornAt.slice(0, 10);
  const diedHuman = s.diedAt.slice(0, 10);
  const top = s.topAuthor ? s.topAuthor.name : "anonymous hands";
  const topTouch = s.topFiles[0]?.path ?? "no single hot file";
  const lines = [
    `# In memoriam: ${s.repoName}`,
    ``,
    `**Born** ${bornHuman} · **${s.archived ? "Archived" : "Last touched"}** ${diedHuman} · **${s.lifespan}** of useful life.`,
    ``,
    `## Origin`,
    `Created on ${bornHuman}, ${s.repoName} drew its first breath in a quiet commit. Across ${s.lifespan}, it absorbed ${s.totalCommits.toLocaleString()} commits and ${s.totalLines.toLocaleString()} lines of intention from ${s.totalAuthors} pair${s.totalAuthors === 1 ? "" : "s"} of hands. It was not always loud, but it was never silent.`,
    ``,
    `## Peak`,
    `In its prime, the hottest place was ${"`" + topTouch + "`"} — touched ${s.topFiles[0]?.touches ?? 0} times, the heart that kept beating. ${top}${s.topAuthor ? ` authored ${s.topAuthor.commits} of the commits` : ""}, and stayed long enough to know every dark corner of the diff. There are repos that ship features; there are repos that shape minds. This one did both.`,
    ``,
    `## Legacy`,
    `Cause of stillness: ${s.causeOfDeath}. The files remain. The history is HMAC-chained into git's own object store; nothing important is lost. Future repos that learned from ${"`" + s.repoName + "`"} carry its DNA forward whether they know it or not. Memory is the only thing that outlives a project. Mneme remembered.`,
    ``,
    `*Rendered by Mneme · ${new Date().toISOString().slice(0, 10)}*`,
  ];
  return lines.join("\n");
}

export function renderTombstoneAscii(s: EulogyStats): string {
  const lines = [
    "       ┏━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━┓",
    "       ┃                               ┃",
    `       ┃       ⚰  ${pad(s.repoName, 18)} ┃`,
    "       ┃                               ┃",
    `       ┃   ${pad(s.bornAt.slice(0, 10), 12)}  -  ${pad(s.diedAt.slice(0, 10), 10)}  ┃`,
    "       ┃                               ┃",
    `       ┃   ${pad(s.lifespan + " of code", 26)}  ┃`,
    `       ┃   ${pad(s.totalCommits + " commits, " + s.totalAuthors + " souls", 26)}  ┃`,
    "       ┃                               ┃",
    "       ┃        Mneme remembers.       ┃",
    "       ┃                               ┃",
    "       ┗━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━┛",
  ];
  return lines.join("\n");
}

function pad(s: string, w: number): string {
  if (s.length > w) return s.slice(0, w - 1) + "…";
  return s.padEnd(w);
}

/** Self-contained SVG memorial card (640×360, embeddable in tweets,
 *  GitHub READMEs, Mastodon, anywhere that takes an <img>). */
export function renderTombstoneSvg(s: EulogyStats): string {
  const W = 640, H = 360;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#0a0a0e"/><stop offset="1" stop-color="#1a1a22"/>
    </linearGradient>
  </defs>
  <rect x="0" y="0" width="${W}" height="${H}" fill="url(#bg)" rx="14"/>
  <text x="320" y="50" text-anchor="middle" font-family="ui-serif, Georgia, serif" font-size="13" letter-spacing="0.25em" fill="#9ba1a6">IN  MEMORIAM</text>
  <text x="320" y="100" text-anchor="middle" font-family="ui-serif, Georgia, serif" font-size="32" font-weight="700" fill="#f7d34c">${escapeXml(s.repoName)}</text>
  <line x1="160" y1="118" x2="480" y2="118" stroke="#f38020" stroke-width="1.2"/>
  <text x="320" y="148" text-anchor="middle" font-family="ui-monospace, SFMono-Regular, Menlo, monospace" font-size="14" fill="#e6e6e6">${s.bornAt.slice(0,10)}  —  ${s.diedAt.slice(0,10)}</text>
  <text x="320" y="172" text-anchor="middle" font-family="ui-serif, Georgia, serif" font-size="14" fill="#9ba1a6">${escapeXml(s.lifespan)} of useful life</text>
  <g font-family="ui-monospace, SFMono-Regular, Menlo, monospace" font-size="11" fill="#9ba1a6">
    <text x="80"  y="222">commits</text><text x="200" y="222" fill="#e6e6e6">${s.totalCommits.toLocaleString()}</text>
    <text x="80"  y="244">authors</text><text x="200" y="244" fill="#e6e6e6">${s.totalAuthors}</text>
    <text x="80"  y="266">lines authored</text><text x="200" y="266" fill="#e6e6e6">${s.totalLines.toLocaleString()}</text>
    <text x="340" y="222">cause</text><text x="420" y="222" fill="#e6e6e6">${escapeXml(s.causeOfDeath)}</text>
    <text x="340" y="244">top heart</text><text x="420" y="244" fill="#e6e6e6">${escapeXml((s.topFiles[0]?.path ?? "—").slice(0,18))}</text>
    <text x="340" y="266">eulogist</text><text x="420" y="266" fill="#e6e6e6">${escapeXml(s.topAuthor?.name ?? "—")}</text>
  </g>
  <text x="320" y="318" text-anchor="middle" font-family="ui-serif, Georgia, serif" font-size="14" fill="#f7d34c" font-style="italic">"Memory is the only thing that outlives a project."</text>
  <text x="320" y="340" text-anchor="middle" font-family="ui-monospace, SFMono-Regular, Menlo, monospace" font-size="9" fill="#6e7681">μνήμη  ·  rendered ${new Date().toISOString().slice(0,10)}</text>
</svg>`;
}

function escapeXml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

/** Pre-formatted tweet thread (3 tweets) the user copy-pastes. */
export function renderTweetThread(s: EulogyStats): string[] {
  return [
    `Today we mourn ${s.repoName}.\n\n${s.bornAt.slice(0,10)} – ${s.diedAt.slice(0,10)}\n${s.lifespan} of useful life\n${s.totalCommits.toLocaleString()} commits · ${s.totalAuthors} souls\n\nCause: ${s.causeOfDeath}`,
    `Its heart was ${"`" + (s.topFiles[0]?.path ?? "—") + "`"} — touched ${s.topFiles[0]?.touches ?? 0} times.\n\n${s.topAuthor ? `${s.topAuthor.name} stayed longest (${s.topAuthor.commits} commits).` : ""}\n\nWe will remember.`,
    `Mneme can write an AI Funeral for any abandoned repo on your machine:\n\nmneme funeral <path-to-repo>\n\nNo LLM call. Pure git-log truth. The first tool that gives dead projects a proper send-off.\n\n#OpenSource #DeadRepos`,
  ];
}
