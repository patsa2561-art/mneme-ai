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
/**
 * Cap on per-commit file-detail fetches. Each detail = 1 API call.
 * GitHub unauth limit = 60/hr/IP; we reserve headroom for the list-fetch +
 * meta-fetch + a couple of follow-on user actions.
 */
const FILE_DETAIL_CAP = 30;

interface RawCommit {
  sha: string;
  authorName: string;
  authorEmail: string;
  date: number; // ms
  message: string;
  files?: string[];
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

  // Second pass: fetch file lists for the most-recent N commits so the
  // Atrophy heatmap + per-author topFiles have something to render. Each
  // detail fetch = 1 API call; we cap to stay inside the unauth budget.
  const detailTarget = commits.slice(0, FILE_DETAIL_CAP);
  for (let i = 0; i < detailTarget.length; i++) {
    const c = detailTarget[i]!;
    if (i % 5 === 0) {
      onProgress?.(`Fetching file detail ${i + 1}/${detailTarget.length}…`);
    }
    try {
      const dRes = await fetch(
        `https://api.github.com/repos/${owner}/${repo}/commits/${c.sha}`,
      );
      if (!dRes.ok) {
        if (dRes.status === 403) break; // rate-limited — stop here, keep what we have
        continue;
      }
      const detail = (await dRes.json()) as { files?: Array<{ filename?: string }> };
      c.files = (detail.files ?? [])
        .map((f) => f.filename)
        .filter((f): f is string => typeof f === "string");
    } catch {
      // network blip — skip this commit, keep going
    }
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

  // Second pass: fetch file diffs for the most-recent N commits.
  const detailTarget = commits.slice(0, FILE_DETAIL_CAP);
  for (let i = 0; i < detailTarget.length; i++) {
    const c = detailTarget[i]!;
    if (i % 5 === 0) {
      onProgress?.(`Fetching file detail ${i + 1}/${detailTarget.length}…`);
    }
    try {
      const dRes = await fetch(
        `https://gitlab.com/api/v4/projects/${encoded}/repository/commits/${c.sha}/diff`,
      );
      if (!dRes.ok) {
        if (dRes.status === 403 || dRes.status === 429) break;
        continue;
      }
      const diff = (await dRes.json()) as Array<{ new_path?: string; old_path?: string }>;
      const paths = new Set<string>();
      for (const d of diff) {
        if (d.new_path) paths.add(d.new_path);
        else if (d.old_path) paths.add(d.old_path);
      }
      c.files = [...paths];
    } catch {
      // network blip — skip
    }
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

  // ─── File-level data, derived from the detail-fetch subset ────────────
  // For commits whose `files` field is populated (the most-recent
  // FILE_DETAIL_CAP), accumulate per-file touches per author.
  const detailedCommits = commits.filter((c) => Array.isArray(c.files) && c.files.length > 0);
  const fileWindow =
    detailedCommits.length === 0
      ? null
      : {
          from: Math.min(...detailedCommits.map((c) => c.date)),
          to: Math.max(...detailedCommits.map((c) => c.date)),
          commits: detailedCommits.length,
        };

  // touches[email][file] = { count, lastTouchMs }
  const touches = new Map<string, Map<string, { count: number; lastMs: number }>>();
  // fileTotalTouches[file] = aggregate count
  const fileTotalTouches = new Map<string, number>();
  // fileLastTouch[file] = ms
  const fileLastTouch = new Map<string, number>();
  // fileTopAuthor[file] = email of the author with the most touches
  const fileTouchByAuthor = new Map<string, Map<string, number>>();

  for (const c of detailedCommits) {
    let perAuthor = touches.get(c.authorEmail);
    if (!perAuthor) {
      perAuthor = new Map();
      touches.set(c.authorEmail, perAuthor);
    }
    for (const f of c.files!) {
      const cur = perAuthor.get(f);
      if (cur) {
        cur.count++;
        if (c.date > cur.lastMs) cur.lastMs = c.date;
      } else {
        perAuthor.set(f, { count: 1, lastMs: c.date });
      }
      fileTotalTouches.set(f, (fileTotalTouches.get(f) ?? 0) + 1);
      const lastSeen = fileLastTouch.get(f) ?? 0;
      if (c.date > lastSeen) fileLastTouch.set(f, c.date);
      let perFileAuthors = fileTouchByAuthor.get(f);
      if (!perFileAuthors) {
        perFileAuthors = new Map();
        fileTouchByAuthor.set(f, perFileAuthors);
      }
      perFileAuthors.set(
        c.authorEmail,
        (perFileAuthors.get(c.authorEmail) ?? 0) + 1,
      );
    }
  }

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
  const halfLifeDays = 90;
  const refDate = fileWindow ? fileWindow.to : Date.now();
  const passports: PassportData[] = authorList.slice(0, 25).map((a) => {
    const perAuthor = touches.get(a.email);
    const topFiles: PassportData["expertise"]["topFiles"] = perAuthor
      ? Array.from(perAuthor.entries())
          .sort((x, y) => y[1].count - x[1].count)
          .slice(0, 8)
          .map(([filePath, info]) => {
            const daysAgo = Math.max(0, Math.round((refDate - info.lastMs) / 86_400_000));
            const decay = Math.exp((-daysAgo * Math.LN2) / halfLifeDays);
            const fam = 1 - Math.exp(-info.count / 5);
            const knowledge = round3(Math.max(0, Math.min(1, decay * fam)));
            return {
              filePath,
              knowledge,
              lastTouchDaysAgo: daysAgo,
              touchCount: info.count,
              band:
                knowledge >= 0.7
                  ? "fresh"
                  : knowledge >= 0.4
                  ? "warm"
                  : knowledge >= 0.15
                  ? "fading"
                  : "ghosted",
              refreshHint:
                knowledge >= 0.7
                  ? "still strong"
                  : knowledge >= 0.4
                  ? "still recent enough"
                  : "needs review before next change",
            } as PassportData["expertise"]["topFiles"][number];
          })
      : [];
    const filesKnown = perAuthor ? perAuthor.size : 0;
    const filesStillFresh = topFiles.filter((f) => f.knowledge >= 0.5).length;
    const knowledgeMass = topFiles.length > 0
      ? round1(topFiles.reduce((s, f) => s + f.knowledge * (1 + Math.log(1 + f.touchCount)), 0))
      : round1(
          Math.sqrt(a.count) * 4 +
            Math.sqrt(Math.max(1, (a.lastDate - a.firstDate) / 86_400_000)) * 1.5,
        );

    return {
      meta: {
        repoName,
        generatedAt,
        totalCommits,
        repoAuthorCount: totalAuthors,
        notes: [
          fileWindow
            ? `Live data — file-level facts derived from the most-recent ${fileWindow.commits} commits (${new Date(fileWindow.from).toISOString().slice(0, 10)} → ${new Date(fileWindow.to).toISOString().slice(0, 10)}).`
            : "Live data via GitHub/GitLab API. File-level expertise needs `mneme index` locally for full coverage.",
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
        knowledgeMass,
        filesKnown,
        filesStillFresh,
        lastActiveAt: new Date(a.lastDate).toISOString(),
        topFiles,
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
      limits: filesKnown === 0
        ? ["File-level expertise unavailable for this author in the detail window."]
        : [],
    };
  });

  // Build atrophy.criticalFiles = top files by total touches across all
  // detailed commits. Tier them by recency + author concentration.
  const criticalFiles = Array.from(fileTotalTouches.entries())
    .sort((x, y) => y[1] - x[1])
    .slice(0, 12)
    .map(([filePath, totalTouchesAcrossAuthors]) => {
      const lastMs = fileLastTouch.get(filePath) ?? refDate;
      const daysAgo = Math.max(0, Math.round((refDate - lastMs) / 86_400_000));
      const decay = Math.exp((-daysAgo * Math.LN2) / halfLifeDays);
      const fam = 1 - Math.exp(-totalTouchesAcrossAuthors / 5);
      const freshestKnowledge = round3(Math.max(0, Math.min(1, decay * fam)));
      const tier: "safe" | "warn" | "at-risk" =
        freshestKnowledge >= 0.7 ? "safe" : freshestKnowledge >= 0.4 ? "warn" : "at-risk";

      const perFileAuthors = fileTouchByAuthor.get(filePath) ?? new Map<string, number>();
      const topAuthorEntry = Array.from(perFileAuthors.entries()).sort((x, y) => y[1] - x[1])[0];
      const topKnowerEmail = topAuthorEntry ? topAuthorEntry[0] : null;
      const topKnowerInfo = topKnowerEmail ? byAuthor.get(topKnowerEmail) : null;

      return {
        filePath,
        totalTouches: totalTouchesAcrossAuthors,
        tier,
        freshestKnowledge,
        liveExpertCount: perFileAuthors.size,
        topKnower: topKnowerInfo
          ? {
              name: topKnowerInfo.name,
              email: topKnowerInfo.email,
              knowledge: freshestKnowledge,
            }
          : null,
      };
    });

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
    _liveDataWindow: fileWindow
      ? {
          from: new Date(fileWindow.from).toISOString(),
          to: new Date(fileWindow.to).toISOString(),
          commits: fileWindow.commits,
          totalFetched: commits.length,
        }
      : undefined,
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
      halfLifeDays,
      criticalFiles,
      ghostedDeepFiles: criticalFiles.filter((c) => c.tier === "at-risk").length,
      filesWithLiveExpert: criticalFiles.filter((c) => c.liveExpertCount >= 1).length,
      fileCount: fileTotalTouches.size,
    },
    passports,
    lobes: [],
    limits: [
      truncated
        ? `Showing the most-recent ${totalCommits} commits (API cap). Full history needs CLI: ask your AI agent to run \`mneme index && mneme nervous-system --json\`.`
        : `Live from ${sourceLabel}. ${totalCommits} commits read.`,
      fileWindow
        ? `File-level data (atrophy, critical files, per-author topFiles) was computed from the most-recent ${fileWindow.commits} commits (${new Date(fileWindow.from).toISOString().slice(0, 10)} → ${new Date(fileWindow.to).toISOString().slice(0, 10)}). Older commits in this window contributed authorship counts but no file diffs (kept inside the unauth API rate limit). For full coverage of every commit, ask your AI agent to run \`mneme index && mneme nervous-system --json\` and drop the file here.`
        : "File-level data (atrophy, critical files) is empty in this fetch — the per-commit detail step was rate-limited or returned no diffs. For the full nervous system, ask your AI agent to run `mneme index && mneme nervous-system --json` and drop the file here.",
      "Telepathy in live mode is a co-active-day proxy, not co-edited-file. The full version needs `mneme index`.",
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

function round3(n: number): number {
  return Math.round(n * 1000) / 1000;
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
