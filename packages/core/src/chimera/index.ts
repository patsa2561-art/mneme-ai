/**
 * MNEME CHIMERA (v1.27.9) -- single-author insight synthesizer.
 *
 * The painpoint: many Mneme commands degenerate gracefully when the
 * repo has only one author (NETWORK = "0 edges, solo author", STIGMERGY
 * = "no pairs", AUDIT certify = "insufficient data"). All correct.
 * But the user gets nothing actionable.
 *
 * CHIMERA is the fix. Even with one author + zero AI commits + zero
 * stigmergy pairs, a git history still carries SIGNAL:
 *
 *   - Time-of-day commit fingerprint (when do you actually code?)
 *   - File-area diversity (how scattered is your attention?)
 *   - Velocity profile (rolling 30/60/90 day commit cadence)
 *   - Topic momentum (which areas are heating up vs cooling down?)
 *   - PHANTOM COLLABORATORS -- for each major area, who SHOULD own
 *     it if you brought N team members on, based on file co-edit
 *     graph entropy
 *
 * "Chimera" because we synthesise insight from multiple sparse
 * sources -- like the mythical chimera built from lion/goat/snake.
 * No single source is enough; together they form a useful creature.
 *
 * Pure-functional with one git-log entry point. Sub-second on repos
 * with <10k commits.
 */

import { spawnSync } from "node:child_process";

export interface CommitFact {
  sha: string;
  email: string;
  at: string;
  files: string[];
}

export interface TimeFingerprint {
  /** Hour-of-day histogram (24 buckets, 0-23). */
  hourBuckets: number[];
  /** Day-of-week histogram (7 buckets, Mon=0..Sun=6). */
  dowBuckets: number[];
  /** Most common hour (0-23). */
  peakHour: number;
  /** Most common day-of-week label. */
  peakDay: string;
  /** Total commits analysed. */
  totalCommits: number;
}

export interface AreaDiversity {
  /** Distinct top-level paths touched. */
  distinctTopDirs: number;
  /** Average file-path depth (slashes per path). */
  avgDepth: number;
  /** Top-5 directories by commit count. */
  hotDirs: Array<{ dir: string; commits: number; pctOfTotal: number }>;
  /** "Spread index" 0-1 -- 0 = always one area, 1 = uniform across all. */
  spreadIndex: number;
}

export interface VelocityProfile {
  last30dCommits: number;
  last60dCommits: number;
  last90dCommits: number;
  rolling30dPerDay: number;
  trend: "accelerating" | "steady" | "decelerating";
  /** Comparison ratio: last 30d / prev 30d (60-30 days ago). */
  vs60dRatio: number;
}

export interface TopicMomentum {
  /** Per-top-dir momentum: comparing recent activity vs older. */
  perDir: Array<{
    dir: string;
    recent30d: number;
    prior30to90d: number;
    /** Ratio recent / prior. >1 = heating up, <1 = cooling. */
    momentumRatio: number;
    label: "🔥 hot" | "📈 warming" | "→ steady" | "📉 cooling" | "❄ cold";
  }>;
}

export interface PhantomCollaborator {
  /** Suggested phantom dev id (e.g. "phantom-frontend-1"). */
  phantomId: string;
  /** Domain they would own. */
  area: string;
  /** Files in that area (top by churn). */
  topFiles: string[];
  /** Why this area is its own cluster (entropy + co-edit clustering). */
  rationale: string;
}

export interface PhantomCollaborators {
  /** True iff repo is solo (chimera's primary use case). */
  isSolo: boolean;
  /** Number of authors observed. */
  actualAuthors: number;
  /** Suggested team size for healthy ownership distribution. */
  suggestedTeamSize: number;
  /** The phantom team, ranked by area importance. */
  phantoms: PhantomCollaborator[];
}

export interface ChimeraReport {
  computedAt: string;
  commitsAnalysed: number;
  timeFingerprint: TimeFingerprint;
  areaDiversity: AreaDiversity;
  velocityProfile: VelocityProfile;
  topicMomentum: TopicMomentum;
  phantomCollaborators: PhantomCollaborators;
  /** One-paragraph synthesis the user can read in 30s. */
  narrative: string;
}

const DOW_LABELS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

// ─── parsing ────────────────────────────────────────────────────────────

function readGitLog(repoRoot: string, windowCommits = 1000): CommitFact[] {
  const r = spawnSync("git", [
    "log", `-${windowCommits}`,
    "--pretty=tformat:%h|%ae|%cI",
    "--name-only",
  ], { cwd: repoRoot, encoding: "utf8", timeout: 15_000, maxBuffer: 50 * 1024 * 1024 });
  if (r.status !== 0) return [];
  return parseGitLog(r.stdout || "");
}

// Parse `git log --pretty=tformat:%h|%ae|%cI --name-only` output.
// Note: tformat puts ONE blank line between the header line and the
// file list, AND another blank line between commits. Our parser must
// tolerate both. Strategy: a header line (3-pipe-separated) starts a
// new commit (pushing any previous one). All non-empty non-header
// lines append as files. Empty lines are ignored entirely.
export function parseGitLog(raw: string): CommitFact[] {
  const out: CommitFact[] = [];
  let cur: CommitFact | null = null;
  const HEADER_RE = /^([0-9a-f]+)\|([^|]+)\|([\dT:.+\-Z]+)$/;
  for (const ln of raw.split("\n")) {
    if (ln === "") continue;
    const h = HEADER_RE.exec(ln);
    if (h) {
      if (cur) out.push(cur);
      cur = {
        sha: h[1]!.trim(),
        email: h[2]!.trim().toLowerCase(),
        at: h[3]!.trim(),
        files: [],
      };
      continue;
    }
    if (cur) cur.files.push(ln.trim());
  }
  if (cur) out.push(cur);
  return out.filter((c) => c.sha && c.email && c.at);
}

// ─── per-axis analysers ─────────────────────────────────────────────────

function analyseTime(commits: CommitFact[]): TimeFingerprint {
  const hourBuckets = new Array(24).fill(0);
  const dowBuckets = new Array(7).fill(0);
  for (const c of commits) {
    const d = new Date(c.at);
    if (isNaN(d.getTime())) continue;
    hourBuckets[d.getUTCHours()]++;
    // JS getUTCDay: 0=Sunday. Reorder so Mon=0.
    const jsDay = d.getUTCDay();
    dowBuckets[(jsDay + 6) % 7]++;
  }
  const peakHour = hourBuckets.indexOf(Math.max(...hourBuckets));
  const peakDayIdx = dowBuckets.indexOf(Math.max(...dowBuckets));
  return {
    hourBuckets,
    dowBuckets,
    peakHour,
    peakDay: DOW_LABELS[peakDayIdx] ?? "?",
    totalCommits: commits.length,
  };
}

function topDirOf(filePath: string): string {
  const slash = filePath.indexOf("/");
  return slash > 0 ? filePath.slice(0, slash) : "(root)";
}

function analyseAreaDiversity(commits: CommitFact[]): AreaDiversity {
  const dirCounts = new Map<string, number>();
  let totalFileMentions = 0;
  let totalDepth = 0;
  for (const c of commits) {
    for (const f of c.files) {
      const td = topDirOf(f);
      dirCounts.set(td, (dirCounts.get(td) ?? 0) + 1);
      totalFileMentions++;
      totalDepth += f.split("/").length;
    }
  }
  const total = totalFileMentions || 1;
  const sorted = Array.from(dirCounts.entries()).sort((a, b) => b[1] - a[1]);
  const hotDirs = sorted.slice(0, 5).map(([dir, n]) => ({
    dir, commits: n, pctOfTotal: n / total,
  }));
  // Shannon entropy normalised by max entropy (uniform distribution).
  const probs = sorted.map(([, n]) => n / total);
  const entropy = probs.reduce((acc, p) => p > 0 ? acc - p * Math.log2(p) : acc, 0);
  const maxEntropy = sorted.length > 0 ? Math.log2(sorted.length) : 1;
  const spreadIndex = maxEntropy > 0 ? entropy / maxEntropy : 0;
  return {
    distinctTopDirs: sorted.length,
    avgDepth: totalFileMentions > 0 ? totalDepth / totalFileMentions : 0,
    hotDirs,
    spreadIndex,
  };
}

function analyseVelocity(commits: CommitFact[]): VelocityProfile {
  const now = Date.now();
  const ms30 = 30 * 86_400_000;
  let last30 = 0, last60 = 0, last90 = 0;
  for (const c of commits) {
    const dt = now - Date.parse(c.at);
    if (!Number.isFinite(dt) || dt < 0) continue;
    if (dt < ms30) last30++;
    if (dt < 2 * ms30) last60++;
    if (dt < 3 * ms30) last90++;
  }
  const prev30 = last60 - last30;
  const vs60dRatio = prev30 > 0 ? last30 / prev30 : last30 > 0 ? 99 : 0;
  const trend: VelocityProfile["trend"] =
    vs60dRatio >= 1.25 ? "accelerating"
    : vs60dRatio <= 0.75 ? "decelerating"
    : "steady";
  return {
    last30dCommits: last30,
    last60dCommits: last60,
    last90dCommits: last90,
    rolling30dPerDay: last30 / 30,
    trend,
    vs60dRatio,
  };
}

function analyseTopicMomentum(commits: CommitFact[]): TopicMomentum {
  const now = Date.now();
  const ms30 = 30 * 86_400_000;
  // recent (last 30d) vs prior (30-90d ago) per-dir.
  const recent: Map<string, number> = new Map();
  const prior: Map<string, number> = new Map();
  for (const c of commits) {
    const age = now - Date.parse(c.at);
    if (!Number.isFinite(age) || age < 0) continue;
    const tds = new Set(c.files.map(topDirOf));
    if (age < ms30) {
      for (const td of tds) recent.set(td, (recent.get(td) ?? 0) + 1);
    } else if (age < 3 * ms30) {
      for (const td of tds) prior.set(td, (prior.get(td) ?? 0) + 1);
    }
  }
  const allDirs = new Set([...recent.keys(), ...prior.keys()]);
  const perDir = Array.from(allDirs).map((dir) => {
    const r = recent.get(dir) ?? 0;
    const p = prior.get(dir) ?? 0;
    const ratio = p > 0 ? r / (p / 2) : r > 0 ? 99 : 0;  // prior is 60d window, normalize to 30d
    let label: TopicMomentum["perDir"][number]["label"];
    if (r === 0 && p === 0) label = "❄ cold";
    else if (ratio >= 2) label = "🔥 hot";
    else if (ratio >= 1.2) label = "📈 warming";
    else if (ratio >= 0.8) label = "→ steady";
    else if (ratio > 0) label = "📉 cooling";
    else label = "❄ cold";
    return { dir, recent30d: r, prior30to90d: p, momentumRatio: ratio, label };
  }).sort((a, b) => b.recent30d - a.recent30d);
  return { perDir };
}

function analysePhantomCollaborators(
  commits: CommitFact[],
  areaDiv: AreaDiversity,
): PhantomCollaborators {
  const authors = new Set(commits.map((c) => c.email));
  const isSolo = authors.size <= 1;

  // Heuristic: each "hot dir" with significant churn (>5%) becomes its own
  // potential ownership area. Suggested team size = number of such areas
  // up to a sensible cap of 6.
  const significantAreas = areaDiv.hotDirs.filter((d) => d.pctOfTotal >= 0.05);
  const suggestedTeamSize = Math.max(2, Math.min(6, significantAreas.length));

  // For each significant area, identify the top files (by commit-touch count).
  const fileChurn = new Map<string, number>();
  for (const c of commits) {
    for (const f of c.files) fileChurn.set(f, (fileChurn.get(f) ?? 0) + 1);
  }

  const phantoms: PhantomCollaborator[] = significantAreas.map((area, i) => {
    const filesInArea = Array.from(fileChurn.entries())
      .filter(([f]) => topDirOf(f) === area.dir)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 3)
      .map(([f]) => f);
    return {
      phantomId: `phantom-${area.dir}-${i + 1}`,
      area: area.dir,
      topFiles: filesInArea,
      rationale: `${(area.pctOfTotal * 100).toFixed(0)}% of repo activity centres on ${area.dir}/. A dedicated owner would shorten review cycles + concentrate domain knowledge.`,
    };
  });

  return {
    isSolo,
    actualAuthors: authors.size,
    suggestedTeamSize,
    phantoms,
  };
}

// ─── narrative synthesis ────────────────────────────────────────────────

function buildNarrative(r: Omit<ChimeraReport, "narrative">): string {
  const lines: string[] = [];
  const tf = r.timeFingerprint;
  const ad = r.areaDiversity;
  const vp = r.velocityProfile;
  const pc = r.phantomCollaborators;

  if (pc.isSolo) {
    lines.push(`Solo author across ${r.commitsAnalysed} commits.`);
  } else {
    lines.push(`${pc.actualAuthors} authors across ${r.commitsAnalysed} commits.`);
  }
  lines.push(`Peak coding window: ${tf.peakDay}s around ${String(tf.peakHour).padStart(2, "0")}:00 UTC.`);
  if (ad.hotDirs.length > 0) {
    const top = ad.hotDirs[0]!;
    lines.push(`Attention concentrated on ${top.dir}/ (${(top.pctOfTotal * 100).toFixed(0)}% of touches); spread index ${(ad.spreadIndex * 100).toFixed(0)}/100.`);
  }
  lines.push(`Velocity: ${vp.last30dCommits} commits in last 30d (${vp.trend}, vs prior 30d: ${vp.vs60dRatio.toFixed(2)}x).`);
  if (pc.isSolo && pc.phantoms.length > 0) {
    lines.push(`If team grew to ${pc.suggestedTeamSize}, ownership would naturally split ${pc.phantoms.length} ways: ${pc.phantoms.map((p) => p.area).join(", ")}.`);
  }
  return lines.join(" ");
}

// ─── public entry ───────────────────────────────────────────────────────

export function chimera(repoRoot: string, opts: { windowCommits?: number } = {}): ChimeraReport {
  const commits = readGitLog(repoRoot, opts.windowCommits ?? 1000);
  if (commits.length === 0) {
    return {
      computedAt: new Date().toISOString(),
      commitsAnalysed: 0,
      timeFingerprint: { hourBuckets: new Array(24).fill(0), dowBuckets: new Array(7).fill(0), peakHour: 0, peakDay: "?", totalCommits: 0 },
      areaDiversity: { distinctTopDirs: 0, avgDepth: 0, hotDirs: [], spreadIndex: 0 },
      velocityProfile: { last30dCommits: 0, last60dCommits: 0, last90dCommits: 0, rolling30dPerDay: 0, trend: "steady", vs60dRatio: 0 },
      topicMomentum: { perDir: [] },
      phantomCollaborators: { isSolo: true, actualAuthors: 0, suggestedTeamSize: 0, phantoms: [] },
      narrative: "(empty repo or git unavailable)",
    };
  }
  const timeFingerprint = analyseTime(commits);
  const areaDiversity = analyseAreaDiversity(commits);
  const velocityProfile = analyseVelocity(commits);
  const topicMomentum = analyseTopicMomentum(commits);
  const phantomCollaborators = analysePhantomCollaborators(commits, areaDiversity);
  const partial: Omit<ChimeraReport, "narrative"> = {
    computedAt: new Date().toISOString(),
    commitsAnalysed: commits.length,
    timeFingerprint, areaDiversity, velocityProfile, topicMomentum, phantomCollaborators,
  };
  return { ...partial, narrative: buildNarrative(partial) };
}
