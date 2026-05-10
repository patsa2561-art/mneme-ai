/**
 * MNEME STIGMERGY HIVE -- public API.
 *
 *   import * as stigmergy from "@mneme-ai/core/stigmergy";
 *
 *   const report = await stigmergy.analyze(repoRoot);
 *   stigmergy.parseGitLog(rawText) -> CommitFact[]
 *   stigmergy.computeOverlaps(commits, config) -> PairOverlap[]
 *
 * The whole module is intentionally pure where possible: parseGitLog
 * + computeOverlaps take inputs and return values, so they're easy
 * to test against synthetic git logs without spawning git. analyze()
 * is the thin wrapper that calls `git log` and pipes through.
 */

import { spawnSync } from "node:child_process";

import type {
  CommitFact, PairOverlap, StigmergyReport, StigmergyConfig,
} from "./types.js";
import { DEFAULT_STIGMERGY_CONFIG } from "./types.js";

export * from "./types.js";

/**
 * Parse `git log --pretty=tformat:'<sha>|<email>|<isoDate>' --name-only`
 * output into structured CommitFacts.
 */
export function parseGitLog(raw: string): CommitFact[] {
  const out: CommitFact[] = [];
  const lines = raw.split("\n");
  let cur: CommitFact | null = null;
  for (const ln of lines) {
    if (ln === "") {
      if (cur) out.push(cur);
      cur = null;
      continue;
    }
    if (ln.includes("|") && ln.split("|").length === 3 && !cur) {
      const [sha, email, at] = ln.split("|");
      cur = { sha: (sha ?? "").trim(), email: (email ?? "").trim().toLowerCase(), at: (at ?? "").trim(), files: [] };
      continue;
    }
    if (cur && ln.trim().length > 0) cur.files.push(ln.trim());
  }
  if (cur) out.push(cur);
  return out.filter((c) => c.sha && c.email && c.at);
}

/**
 * Compute every pair's stigmergic overlap from a chronological list
 * of commits. Time complexity: O(C * F^2) where C = commits, F =
 * average files per commit. For windows of ~500 commits with ~5 files
 * each, that's ~12500 work units. Sub-second on modern hardware.
 */
export function computeOverlaps(
  commits: CommitFact[],
  config: Partial<StigmergyConfig> = {},
): PairOverlap[] {
  const cfg = { ...DEFAULT_STIGMERGY_CONFIG, ...config };

  // Index files -> commits that touched them, in chronological order.
  const fileTouches = new Map<string, Array<{ email: string; at: number }>>();
  // Track first-introducer per file.
  const fileIntroducer = new Map<string, { email: string; at: number }>();

  // commits assumed newest-first from `git log`. Sort oldest-first for
  // first-introducer detection.
  const chronological = commits.slice().sort((a, b) => Date.parse(a.at) - Date.parse(b.at));

  for (const c of chronological) {
    const ts = Date.parse(c.at);
    if (!Number.isFinite(ts)) continue;
    for (const f of c.files) {
      const arr = fileTouches.get(f) ?? [];
      arr.push({ email: c.email, at: ts });
      fileTouches.set(f, arr);
      if (!fileIntroducer.has(f)) fileIntroducer.set(f, { email: c.email, at: ts });
    }
  }

  // For each pair, compute synchrony + carry-on across all shared files.
  type PairAcc = {
    sharedFiles: Set<string>;
    synchronyHits: number;
    carryOnHits: number;
    coTouchTimes: number[];
  };
  const pairs = new Map<string, PairAcc>();
  function pairKey(a: string, b: string): string {
    return a < b ? `${a}::${b}` : `${b}::${a}`;
  }
  function get(a: string, b: string): PairAcc {
    const key = pairKey(a, b);
    let p = pairs.get(key);
    if (!p) {
      p = { sharedFiles: new Set(), synchronyHits: 0, carryOnHits: 0, coTouchTimes: [] };
      pairs.set(key, p);
    }
    return p;
  }

  const SYNC_MS = cfg.synchronyHours * 3_600_000;
  const CARRY_MS = cfg.carryOnDays * 86_400_000;

  for (const [filePath, touches] of fileTouches) {
    if (touches.length < 2) continue;
    const introducer = fileIntroducer.get(filePath);
    // Authors who touched this file (set of unique emails).
    const authorsForFile = new Set(touches.map((t) => t.email));
    if (authorsForFile.size < 2) continue;

    // For each author pair, mark sharedFiles + scan synchrony / carry-on.
    const authors = Array.from(authorsForFile);
    for (let i = 0; i < authors.length; i++) {
      for (let j = i + 1; j < authors.length; j++) {
        const a = authors[i]!, b = authors[j]!;
        const acc = get(a, b);
        acc.sharedFiles.add(filePath);

        // Synchrony: any A-touch within SYNC_MS of any B-touch (or v/v).
        const aTouches = touches.filter((t) => t.email === a).map((t) => t.at);
        const bTouches = touches.filter((t) => t.email === b).map((t) => t.at);
        let syncHit = false;
        for (const ta of aTouches) {
          for (const tb of bTouches) {
            if (Math.abs(ta - tb) <= SYNC_MS) {
              syncHit = true;
              acc.coTouchTimes.push(Math.min(ta, tb));
              break;
            }
          }
          if (syncHit) break;
        }
        if (syncHit) acc.synchronyHits++;

        // Carry-on: introducer was a, b touched within CARRY_MS; or v/v.
        if (introducer) {
          const introducerEmail = introducer.email;
          const introTime = introducer.at;
          if (introducerEmail === a) {
            const bExtended = bTouches.some((t) => t > introTime && t - introTime <= CARRY_MS);
            if (bExtended) acc.carryOnHits++;
          } else if (introducerEmail === b) {
            const aExtended = aTouches.some((t) => t > introTime && t - introTime <= CARRY_MS);
            if (aExtended) acc.carryOnHits++;
          }
        }
      }
    }
  }

  const overlaps: PairOverlap[] = [];
  for (const [key, acc] of pairs) {
    const [a, b] = key.split("::");
    const sharedCount = acc.sharedFiles.size;
    const sortedTimes = acc.coTouchTimes.slice().sort((x, y) => x - y);
    // Stigmergy score: weighted combo emphasising synchrony + carry-on
    // (which require active collaboration), de-emphasising raw shared
    // file count (which both repo owners touch by accident).
    //
    //   2 * synchrony + 3 * carryOn + 1 * shared
    //
    // Capped at 100. This way 5 carry-ons on isolated files = 15
    // (just over surface threshold), which feels right.
    const stigmergyScore = Math.min(100,
      2 * acc.synchronyHits +
      3 * acc.carryOnHits +
      1 * sharedCount,
    );

    overlaps.push({
      authorA: a!,
      authorB: b!,
      sharedFiles: sharedCount,
      synchronyHits: acc.synchronyHits,
      carryOnHits: acc.carryOnHits,
      firstCoTouch: sortedTimes.length > 0 ? new Date(sortedTimes[0]!).toISOString() : null,
      lastCoTouch: sortedTimes.length > 0 ? new Date(sortedTimes[sortedTimes.length - 1]!).toISOString() : null,
      stigmergyScore,
    });
  }

  return overlaps.sort((x, y) => y.stigmergyScore - x.stigmergyScore);
}

/**
 * End-to-end: spawn `git log`, parse, compute overlaps, return report.
 */
export function analyze(repoRoot: string, config: Partial<StigmergyConfig> = {}): StigmergyReport {
  const cfg = { ...DEFAULT_STIGMERGY_CONFIG, ...config };
  const r = spawnSync("git", [
    "log",
    "--pretty=tformat:%h|%ae|%cI",
    "--name-only",
    "-n", String(cfg.windowCommits),
  ], { cwd: repoRoot, encoding: "utf8", timeout: 15_000, maxBuffer: 50 * 1024 * 1024 });

  if (r.status !== 0) {
    return {
      computedAt: new Date().toISOString(),
      commitsAnalysed: 0,
      authorCount: 0,
      pairs: [],
      weakPairs: 0,
    };
  }

  const commits = parseGitLog(r.stdout || "");
  const overlaps = computeOverlaps(commits, cfg);
  const surfaced = overlaps.filter((o) => o.stigmergyScore >= cfg.surfaceThreshold);
  const authorCount = new Set(commits.map((c) => c.email)).size;

  return {
    computedAt: new Date().toISOString(),
    commitsAnalysed: commits.length,
    authorCount,
    pairs: surfaced,
    weakPairs: overlaps.length - surfaced.length,
  };
}
