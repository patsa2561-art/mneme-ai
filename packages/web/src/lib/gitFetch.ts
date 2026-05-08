/**
 * gitFetch — fetch commits from GitHub/GitLab in-browser and synthesize a
 * `NervousSystemData` shape good enough to drive the dashboard's graph +
 * influence + atrophy(partial) views.
 *
 * Constraints:
 *   • Unauthenticated. GitHub = 60 req/hr/IP, GitLab = 300 req/min/IP.
 *   • We cap at 5 pages of 100 commits (500 total) = 5 requests, ~8% of
 *     GitHub's hourly budget. Plenty of headroom for a few repos in a row.
 *   • No per-commit detail calls (those would blow the budget). That means
 *     no file paths → telepathy/atrophy/lobes are partial.
 *
 * The synthesized data sets `limits[]` so the dashboard's LimitsPanel
 * surfaces what the user is missing + how to upgrade (run `mneme index`).
 */

import type {
  NervousSystemData,
  AlphaSlot,
  PassportData,
  HeroMetric,
} from "../types";

const PAGE_SIZE = 100;
const MAX_PAGES = 5;

interface RawCommit {
  sha: string;
  authorName: string;
  authorEmail: string;
  date: number; // ms
  message: string;
}

export interface FetchResult {
  data: NervousSystemData;
  source: string; // human label e.g. "github.com/foo/bar (live)"
}

/** Detects whether the URL is a GitHub or GitLab repo URL. */
export function classifyUrl(input: string):
  | { kind: "github"; owner: string; repo: string }
  | { kind: "gitlab"; project: string }
  | { kind: "json"; url: string }
  | { kind: "unknown" } {
  const trimmed = input.trim().replace(/\/+$/, "");
  try {
    const u = new URL(trimmed);
    if (u.hostname === "github.com" || u.hostname === "www.github.com") {
      const parts = u.pathname.replace(/^\/+/, "").replace(/\.git$/, "").split("/");
      if (parts.length >= 2 && parts[0] && parts[1]) {
        return { kind: "github", owner: parts[0], repo: parts[1] };
      }
    }
    if (u.hostname === "gitlab.com" || u.hostname === "www.gitlab.com") {
      // GitLab supports nested groups: gitlab.com/group/sub/project
      const project = u.pathname.replace(/^\/+/, "").replace(/\.git$/, "");
      if (project.includes("/")) {
        return { kind: "gitlab", project };
      }
    }
    if (/\.json($|\?)/i.test(u.pathname)) {
      return { kind: "json", url: trimmed };
    }
  } catch {
    // not a URL
  }
  return { kind: "unknown" };
}

export async function fetchAndSynthesize(
  input: string,
  onProgress?: (msg: string) => void,
): Promise<FetchResult> {
  const cls = classifyUrl(input);
  if (cls.kind === "github") {
    onProgress?.(`Fetching ${cls.owner}/${cls.repo} from GitHub…`);
    return await synthFromGitHub(cls.owner, cls.repo, onProgress);
  }
  if (cls.kind === "gitlab") {
    onProgress?.(`Fetching ${cls.project} from GitLab…`);
    return await synthFromGitLab(cls.project, onProgress);
  }
  if (cls.kind === "json") {
    onProgress?.("Fetching JSON…");
    const res = await fetch(cls.url, { cache: "no-cache" });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = (await res.json()) as NervousSystemData;
    return { data, source: input };
  }
  throw new Error(
    "Not a GitHub/GitLab repo URL or a .json URL. Examples: https://github.com/foo/bar · https://gitlab.com/group/project · https://example.com/data.json",
  );
}

// ─── GitHub ─────────────────────────────────────────────────────────────

async function synthFromGitHub(
  owner: string,
  repo: string,
  onProgress?: (msg: string) => void,
): Promise<FetchResult> {
  // Repo metadata.
  const metaRes = await fetch(`https://api.github.com/repos/${owner}/${repo}`);
  if (!metaRes.ok) {
    throw new Error(
      metaRes.status === 404
        ? `Repo not found (or private): ${owner}/${repo}`
        : metaRes.status === 403
        ? "GitHub rate-limited this IP. Try again in an hour, or have your AI agent run `mneme nervous-system --json` locally for full insight."
        : `GitHub returned HTTP ${metaRes.status}`,
    );
  }
  const repoMeta = (await metaRes.json()) as {
    full_name: string;
    description?: string;
    pushed_at?: string;
    default_branch?: string;
  };

  // Commits — paginated.
  const commits: RawCommit[] = [];
  for (let page = 1; page <= MAX_PAGES; page++) {
    onProgress?.(`Fetching commits page ${page}/${MAX_PAGES}…`);
    const res = await fetch(
      `https://api.github.com/repos/${owner}/${repo}/commits?per_page=${PAGE_SIZE}&page=${page}`,
    );
    if (!res.ok) {
      if (res.status === 409) break; // empty repo
      throw new Error(`GitHub commits HTTP ${res.status} on page ${page}`);
    }
    const arr = (await res.json()) as Array<{
      sha: string;
      commit: {
        author: { name?: string; email?: string; date?: string };
        message: string;
      };
    }>;
    if (!Array.isArray(arr) || arr.length === 0) break;
    for (const c of arr) {
      commits.push({
        sha: c.sha,
        authorName: c.commit.author?.name ?? "unknown",
        authorEmail: (c.commit.author?.email ?? "unknown@unknown").toLowerCase(),
        date: c.commit.author?.date ? Date.parse(c.commit.author.date) : Date.now(),
        message: c.commit.message,
      });
    }
    if (arr.length < PAGE_SIZE) break;
  }

  return synthesize({
    repoName: repoMeta.full_name,
    sourceLabel: `github.com/${owner}/${repo} (live · ${commits.length} commits)`,
    commits,
    truncated: commits.length === MAX_PAGES * PAGE_SIZE,
  });
}

// ─── GitLab ─────────────────────────────────────────────────────────────

async function synthFromGitLab(
  project: string,
  onProgress?: (msg: string) => void,
): Promise<FetchResult> {
  const encoded = encodeURIComponent(project);
  // Project metadata.
  const metaRes = await fetch(`https://gitlab.com/api/v4/projects/${encoded}`);
  if (!metaRes.ok) {
    throw new Error(
      metaRes.status === 404
        ? `Project not found (or private): ${project}`
        : metaRes.status === 403 || metaRes.status === 429
        ? "GitLab rate-limited this IP. Try again in a minute, or have your AI agent run `mneme nervous-system --json` locally."
        : `GitLab returned HTTP ${metaRes.status}`,
    );
  }
  const repoMeta = (await metaRes.json()) as {
    path_with_namespace: string;
    description?: string;
    last_activity_at?: string;
  };

  // Commits — paginated.
  const commits: RawCommit[] = [];
  for (let page = 1; page <= MAX_PAGES; page++) {
    onProgress?.(`Fetching commits page ${page}/${MAX_PAGES}…`);
    const res = await fetch(
      `https://gitlab.com/api/v4/projects/${encoded}/repository/commits?per_page=${PAGE_SIZE}&page=${page}`,
    );
    if (!res.ok) {
      throw new Error(`GitLab commits HTTP ${res.status} on page ${page}`);
    }
    const arr = (await res.json()) as Array<{
      id: string;
      author_name?: string;
      author_email?: string;
      authored_date?: string;
      message: string;
    }>;
    if (!Array.isArray(arr) || arr.length === 0) break;
    for (const c of arr) {
      commits.push({
        sha: c.id,
        authorName: c.author_name ?? "unknown",
        authorEmail: (c.author_email ?? "unknown@unknown").toLowerCase(),
        date: c.authored_date ? Date.parse(c.authored_date) : Date.now(),
        message: c.message,
      });
    }
    if (arr.length < PAGE_SIZE) break;
  }

  return synthesize({
    repoName: repoMeta.path_with_namespace,
    sourceLabel: `gitlab.com/${project} (live · ${commits.length} commits)`,
    commits,
    truncated: commits.length === MAX_PAGES * PAGE_SIZE,
  });
}

// ─── Synthesis ──────────────────────────────────────────────────────────

interface SynthInput {
  repoName: string;
  sourceLabel: string;
  commits: RawCommit[];
  truncated: boolean;
}

function synthesize({
  repoName,
  sourceLabel,
  commits,
  truncated,
}: SynthInput): FetchResult {
  if (commits.length === 0) {
    throw new Error("Repo has no commits we could read.");
  }

  // Group commits by author email.
  type Acc = {
    name: string;
    email: string;
    count: number;
    firstDate: number;
    lastDate: number;
  };
  const byAuthor = new Map<string, Acc>();
  for (const c of commits) {
    const key = c.authorEmail;
    const cur = byAuthor.get(key);
    if (cur) {
      cur.count++;
      if (c.date < cur.firstDate) cur.firstDate = c.date;
      if (c.date > cur.lastDate) cur.lastDate = c.date;
    } else {
      byAuthor.set(key, {
        name: c.authorName,
        email: c.authorEmail,
        count: 1,
        firstDate: c.date,
        lastDate: c.date,
      });
    }
  }

  const authorList = Array.from(byAuthor.values()).sort(
    (a, b) => b.count - a.count,
  );

  // Telepathy: synthesize from same-day co-commits. Two authors who pushed on
  // the same calendar day are treated as a "weak signal" pair. Real telepathy
  // needs file co-edits — we set limits[] to flag this.
  const dayKey = (ms: number) => new Date(ms).toISOString().slice(0, 10);
  const dayBuckets = new Map<string, Set<string>>();
  for (const c of commits) {
    const k = dayKey(c.date);
    if (!dayBuckets.has(k)) dayBuckets.set(k, new Set());
    dayBuckets.get(k)!.add(c.authorEmail);
  }
  const pairCounts = new Map<string, number>();
  for (const set of dayBuckets.values()) {
    const arr = Array.from(set);
    for (let i = 0; i < arr.length; i++) {
      for (let j = i + 1; j < arr.length; j++) {
        const key = [arr[i], arr[j]].sort().join("|");
        pairCounts.set(key, (pairCounts.get(key) ?? 0) + 1);
      }
    }
  }
  const telepathyPairs = Array.from(pairCounts.entries())
    .map(([key, events]) => {
      const [eA, eB] = key.split("|");
      const a = byAuthor.get(eA!);
      const b = byAuthor.get(eB!);
      if (!a || !b) return null;
      return {
        authorA: { name: a.name, email: a.email },
        authorB: { name: b.name, email: b.email },
        events,
        opportunities: events,
        score: Math.min(1, events / 30),
        topTopic: { topic: "co-active days", count: events },
        lastSeenAt: new Date(
          Math.max(a.lastDate, b.lastDate),
        ).toISOString(),
      };
    })
    .filter((p): p is NonNullable<typeof p> => p !== null)
    .sort((a, b) => b.events - a.events)
    .slice(0, 50);

  const totalCommits = commits.length;
  const totalAuthors = authorList.length;
  const generatedAt = new Date().toISOString();

  // Alphas — top contributors by commit count (acts as a degraded pageRank).
  const alphas: AlphaSlot[] = authorList.slice(0, 10).map((a, i) => ({
    rank: i + 1,
    name: a.name,
    email: a.email,
    pageRank: a.count / totalCommits,
    originatedShapesAdopted: 0,
    adoptionsByOthers: 0,
    uniqueAdopters: 0,
    topShape: null,
  }));

  // Hero — synthesize basic metrics.
  const lastCommitDate = Math.max(...commits.map((c) => c.date));
  const firstCommitDate = Math.min(...commits.map((c) => c.date));
  const spanDays = Math.max(
    1,
    Math.round((lastCommitDate - firstCommitDate) / 86_400_000),
  );
  const sparkline = buildSparkline(commits, 14);
  const heroMetrics: HeroMetric[] = [
    {
      label: "Commits",
      value: totalCommits.toLocaleString(),
      subtitle: truncated ? "first 500 (capped)" : "in window",
      sparkline,
    },
    {
      label: "Authors",
      value: totalAuthors.toLocaleString(),
      subtitle: "distinct emails",
      sparkline: [],
    },
    {
      label: "Span",
      value: `${spanDays}d`,
      subtitle: "first → last commit",
      sparkline: [],
    },
  ];

  // Passports — minimal per-author profile.
  const passports: PassportData[] = authorList.slice(0, 25).map((a) => ({
    meta: {
      repoName,
      generatedAt,
      totalCommits,
      repoAuthorCount: totalAuthors,
      notes: [
        "Live data via GitHub/GitLab API. File-level expertise needs `mneme index` locally.",
      ],
    },
    identity: {
      name: a.name,
      email: a.email,
      dnaHash: hashStr(`${a.email}|${a.firstDate}`),
      commitCount: a.count,
      fromDate: new Date(a.firstDate).toISOString(),
      toDate: new Date(a.lastDate).toISOString(),
      activeDays: Math.max(
        1,
        Math.round((a.lastDate - a.firstDate) / 86_400_000),
      ),
      repoCommitShare: a.count / totalCommits,
    },
    expertise: {
      // Live-mode proxy for knowledge mass: combines volume (commits) and
      // activity duration (active days). Roughly: a 100-commit / 200-day
      // contributor lands around 60–80, matching the ~140 we see for
      // top alphas in the synthetic demo. Bounded so single-commit drive-bys
      // don't dominate.
      knowledgeMass: round1(
        Math.sqrt(a.count) * 4 +
          Math.sqrt(Math.max(1, (a.lastDate - a.firstDate) / 86_400_000)) * 1.5,
      ),
      filesKnown: 0,
      filesStillFresh: 0,
      lastActiveAt: new Date(a.lastDate).toISOString(),
      topFiles: [],
    },
    influenceSlot: {
      rank: authorList.indexOf(a) + 1,
      pageRank: a.count / totalCommits,
      rankedOf: totalAuthors,
      originatedShapesAdopted: 0,
      adoptionsByOthers: 0,
      uniqueAdopters: 0,
    },
    telepathySlot: {
      pairs: [],
      pairsEvaluated: telepathyPairs.length,
    },
    voice: [],
    limits: ["File-level expertise unavailable — run `mneme index` for the full nervous system."],
  }));

  const liveSource = sourceLabel.includes("github") ? "GitHub" : "GitLab";
  const data: NervousSystemData = {
    meta: {
      repoName,
      generatedAt,
      totalCommits,
      totalAuthors,
      halfLifeDays: 90, // placeholder
      rankedAuthorCount: alphas.length,
    },
    _liveMode: true,
    _liveSource: liveSource,
    hero: {
      headline: `${repoName} — live from ${sourceLabel.includes("github") ? "GitHub" : "GitLab"} API`,
      metrics: heroMetrics,
    },
    alphas,
    telepathy: {
      pairs: telepathyPairs,
      pairsEvaluated: telepathyPairs.length,
      distinctAuthorsInGrid: totalAuthors,
    },
    atrophy: {
      halfLifeDays: 90,
      criticalFiles: [],
      ghostedDeepFiles: 0,
      filesWithLiveExpert: 0,
      fileCount: 0,
    },
    passports,
    lobes: [],
    limits: [
      truncated
        ? `Showing the most-recent ${totalCommits} commits (API cap). Full history needs CLI: ask your AI agent to run \`mneme index && mneme nervous-system --json\`.`
        : `Live from ${sourceLabel}. ${totalCommits} commits read.`,
      "File-level data (atrophy heatmap, critical files, lobes) is empty in live mode — the GitHub/GitLab API doesn't expose per-commit file diffs without burning the rate limit. For the full nervous system, ask your AI agent to run `mneme index && mneme nervous-system --json` and drop the file here.",
      "Telepathy in live mode is co-active-day proxy, not co-edited-file. The full version needs `mneme index`.",
    ],
    surprising: [
      `${authorList[0]!.name} authored ${authorList[0]!.count} of ${totalCommits} commits (${Math.round((authorList[0]!.count / totalCommits) * 100)}%).`,
      `${authorList.filter((a) => a.count === 1).length} authors made exactly one commit in this window.`,
    ],
    _demo_synthetic: false,
  };

  return { data, source: sourceLabel };
}

function buildSparkline(commits: RawCommit[], buckets: number): number[] {
  if (commits.length === 0) return [];
  const min = Math.min(...commits.map((c) => c.date));
  const max = Math.max(...commits.map((c) => c.date));
  if (max === min) return [commits.length];
  const step = (max - min) / buckets;
  const out = new Array(buckets).fill(0) as number[];
  for (const c of commits) {
    const i = Math.min(buckets - 1, Math.floor((c.date - min) / step));
    out[i]!++;
  }
  return out;
}

function round1(n: number): number {
  return Math.round(n * 10) / 10;
}

function hashStr(s: string): string {
  // Tiny non-cryptographic hash, stable across runs. Just for dna display.
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return ("0000000" + (h >>> 0).toString(16)).slice(-8) + s.length.toString(16);
}
