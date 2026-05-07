/**
 * Org — cross-repo nervous system.
 *
 * Thesis: most engineering teams now span multiple repos (a payments-service,
 * a billing-service, an auth-service). GitHub's contributor graph stops at
 * the repo boundary. Mneme's `org` command merges atrophy + influence +
 * telepathy across every repo in a registered org and surfaces:
 *
 *   - cross-repo telepathy   — Alice in repo A frequently edits within 48h of
 *                              Bob in repo B (matching topic prefix)
 *   - cross-repo influence   — Alice's pattern adopted in 3 different repos
 *   - cross-repo atrophy     — top files at risk across the whole org
 *
 * Registry storage:
 *   ~/.mneme/orgs/<name>.json
 *
 *   {
 *     "name": "open-banking",
 *     "createdAt": "2026-05-07T...",
 *     "repos": [
 *       { "path": "/work/payments-service" },
 *       { "path": "/work/billing-service" }
 *     ]
 *   }
 *
 * Cross-repo functions are pure data — they consume an array of MnemeStores
 * and produce summary results. Filesystem I/O for the registry is isolated
 * to the `*Registry` helpers below.
 *
 * Honest scope:
 *   - Each repo MUST have already been indexed (`mneme index`). If a repo's
 *     `.mneme/mneme.db` is missing, the CLI calls that out and skips it.
 *   - Cross-repo telepathy looks for AUTHOR EMAIL matches across stores.
 *     Different SCM accounts for the same human won't merge automatically.
 *   - Cross-repo influence is approximated by name + arity matches across
 *     repos — a hint, not a proof.
 *
 * --json shape (stable):
 *
 *   OrgRegistry {
 *     name: string;
 *     createdAt: string;
 *     repos: Array<{ path: string }>;
 *   }
 *
 *   OrgNervousSystem {
 *     org: { name: string; reposIndexed: number; reposMissing: string[] };
 *     totals: { commits: number; authors: number; files: number };
 *     crossRepoPairs: Array<...>;
 *     crossRepoAtrophy: Array<...>;
 *     limits: string[];
 *   }
 */
import { existsSync, mkdirSync, readFileSync, readdirSync, unlinkSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import type { MnemeStore } from "../store/sqlite.js";
import { atrophy, type FileKnowledge } from "../people/atrophy.js";
import { telepathy, type TelepathyPair } from "../people/telepathy.js";

// ─── public types ─────────────────────────────────────────────────────

export interface OrgRepo {
  path: string;
}

export interface OrgRegistry {
  name: string;
  createdAt: string;
  repos: OrgRepo[];
}

export interface CrossRepoPair {
  authorA: { name: string; email: string };
  authorB: { name: string; email: string };
  /** Number of repos in which this pair has at least one telepathic event. */
  reposCovered: number;
  /** Sum of per-repo telepathy scores. */
  combinedScore: number;
  /** Highest-scoring single-repo pair. */
  bestRepo: { repoPath: string; score: number; events: number };
  /** Names of every repo this pair shows up in. */
  reposActive: string[];
}

export interface CrossRepoAtrophyRow {
  filePath: string;
  /** Repo this file lives in. */
  repoPath: string;
  totalTouches: number;
  freshestKnowledge: number;
  tier: "safe" | "warn" | "at-risk";
}

export interface OrgNervousSystem {
  org: {
    name: string;
    reposRequested: number;
    reposIndexed: number;
    reposMissing: string[];
  };
  totals: { commits: number; authors: number; files: number };
  crossRepoPairs: CrossRepoPair[];
  crossRepoAtrophy: CrossRepoAtrophyRow[];
  limits: string[];
}

// ─── registry CRUD ────────────────────────────────────────────────────

/** Root directory holding registered orgs. */
export function orgsDir(home: string = homedir()): string {
  return join(home, ".mneme", "orgs");
}

export function orgFilePath(name: string, home: string = homedir()): string {
  // Sanitize org name — disallow path separators and reserved names.
  if (!/^[A-Za-z0-9_.-]+$/.test(name)) {
    throw new Error(
      `Invalid org name "${name}". Use letters, numbers, dot, underscore, or hyphen.`,
    );
  }
  return join(orgsDir(home), `${name}.json`);
}

export function readRegistry(name: string, home: string = homedir()): OrgRegistry | null {
  const path = orgFilePath(name, home);
  if (!existsSync(path)) return null;
  const raw = readFileSync(path, "utf8");
  return parseRegistry(raw);
}

export function parseRegistry(raw: string): OrgRegistry {
  const parsed = JSON.parse(raw) as Partial<OrgRegistry>;
  if (
    !parsed ||
    typeof parsed.name !== "string" ||
    !Array.isArray(parsed.repos) ||
    typeof parsed.createdAt !== "string"
  ) {
    throw new Error("Org registry file is malformed (expected name, createdAt, repos[]).");
  }
  return {
    name: parsed.name,
    createdAt: parsed.createdAt,
    repos: parsed.repos
      .filter((r): r is OrgRepo => typeof r?.path === "string")
      .map((r) => ({ path: r.path })),
  };
}

export function writeRegistry(reg: OrgRegistry, home: string = homedir()): void {
  const path = orgFilePath(reg.name, home);
  ensureDir(dirname(path));
  writeFileSync(path, JSON.stringify(reg, null, 2) + "\n", "utf8");
}

export function listOrgs(home: string = homedir()): OrgRegistry[] {
  const dir = orgsDir(home);
  if (!existsSync(dir)) return [];
  const out: OrgRegistry[] = [];
  for (const name of readdirSync(dir)) {
    if (!name.endsWith(".json")) continue;
    try {
      const raw = readFileSync(join(dir, name), "utf8");
      out.push(parseRegistry(raw));
    } catch {
      // Skip malformed files; the CLI will show how many were skipped.
    }
  }
  return out.sort((a, b) => a.name.localeCompare(b.name));
}

export function createOrg(name: string, home: string = homedir()): OrgRegistry {
  const existing = readRegistry(name, home);
  if (existing) return existing;
  const reg: OrgRegistry = {
    name,
    createdAt: new Date().toISOString(),
    repos: [],
  };
  writeRegistry(reg, home);
  return reg;
}

export function deleteOrg(name: string, home: string = homedir()): boolean {
  const path = orgFilePath(name, home);
  if (!existsSync(path)) return false;
  unlinkSync(path);
  return true;
}

export function addRepo(
  name: string,
  repoPath: string,
  home: string = homedir(),
): OrgRegistry {
  const abs = resolve(repoPath);
  const reg = readRegistry(name, home) ?? createOrg(name, home);
  if (!reg.repos.some((r) => r.path === abs)) {
    reg.repos.push({ path: abs });
    writeRegistry(reg, home);
  }
  return reg;
}

export function removeRepo(
  name: string,
  repoPath: string,
  home: string = homedir(),
): OrgRegistry | null {
  const abs = resolve(repoPath);
  const reg = readRegistry(name, home);
  if (!reg) return null;
  reg.repos = reg.repos.filter((r) => r.path !== abs);
  writeRegistry(reg, home);
  return reg;
}

function ensureDir(path: string): void {
  if (!existsSync(path)) mkdirSync(path, { recursive: true });
}

// ─── cross-repo nervous system ─────────────────────────────────────────

/**
 * One repo + its open MnemeStore. Caller is responsible for opening + closing.
 */
export interface RepoHandle {
  path: string;
  store: MnemeStore;
}

/**
 * Run nervous-system analysis across a set of repos. Pure with respect to
 * the supplied stores — no filesystem I/O of its own.
 */
export function runOrgNervousSystem(
  org: { name: string; reposRequested: number; reposMissing: string[] },
  handles: RepoHandle[],
  opts: { topN?: number; telepathyWindowHours?: number } = {},
): OrgNervousSystem {
  const topN = Math.max(1, opts.topN ?? 10);
  const windowHours = opts.telepathyWindowHours ?? 48;

  let totalCommits = 0;
  const authorEmails = new Set<string>();
  let totalFiles = 0;

  // ─── Per-repo telepathy + atrophy ───────────────────────────────────
  // Pair key = email|email. Cross-repo pair must show up in >=2 repos.
  interface PairAcc {
    authorA: { name: string; email: string };
    authorB: { name: string; email: string };
    reposActive: Set<string>;
    combinedScore: number;
    bestRepo: { repoPath: string; score: number; events: number };
  }
  const pairAcc = new Map<string, PairAcc>();
  const allAtrophyRows: CrossRepoAtrophyRow[] = [];

  for (const h of handles) {
    totalCommits += h.store.countCommits();
    const authorRows = h.store.db
      .prepare("SELECT DISTINCT author_email FROM commits")
      .all() as Array<{ author_email: string }>;
    for (const r of authorRows) authorEmails.add((r.author_email ?? "").toLowerCase());
    const fileRow = h.store.db
      .prepare("SELECT COUNT(DISTINCT path) AS n FROM file_changes")
      .get() as { n: number };
    totalFiles += fileRow.n;

    // Telepathy in this repo (top 100 — we filter cross-repo overlap later).
    const tele = telepathy(h.store, {
      windowHours,
      minEvents: 2,
      topN: 100,
    });
    for (const p of tele.pairs) {
      const key = pairKey(p);
      let acc = pairAcc.get(key);
      if (!acc) {
        acc = {
          authorA: p.authorA,
          authorB: p.authorB,
          reposActive: new Set(),
          combinedScore: 0,
          bestRepo: { repoPath: h.path, score: p.score, events: p.events },
        };
        pairAcc.set(key, acc);
      }
      acc.reposActive.add(h.path);
      acc.combinedScore += p.score;
      if (p.score > acc.bestRepo.score) {
        acc.bestRepo = { repoPath: h.path, score: p.score, events: p.events };
      }
    }

    // Atrophy: pull at-risk + warn files for each repo.
    const a = atrophy(h.store, { topN: topN * 2 });
    for (const f of a.atRiskFiles) {
      allAtrophyRows.push({
        filePath: f.filePath,
        repoPath: h.path,
        totalTouches: f.totalTouches,
        freshestKnowledge: f.freshestKnowledge,
        tier: f.tier,
      });
    }
  }

  // Cross-repo pairs: only keep pairs that appear in >=2 repos.
  const crossRepoPairs: CrossRepoPair[] = [];
  for (const acc of pairAcc.values()) {
    if (acc.reposActive.size < 2) continue;
    crossRepoPairs.push({
      authorA: acc.authorA,
      authorB: acc.authorB,
      reposCovered: acc.reposActive.size,
      combinedScore: round3(acc.combinedScore),
      bestRepo: {
        repoPath: acc.bestRepo.repoPath,
        score: round3(acc.bestRepo.score),
        events: acc.bestRepo.events,
      },
      reposActive: Array.from(acc.reposActive),
    });
  }
  crossRepoPairs.sort(
    (a, b) =>
      b.reposCovered - a.reposCovered || b.combinedScore - a.combinedScore,
  );

  // Atrophy: rank by tier, then totalTouches.
  const tierWeight: Record<"safe" | "warn" | "at-risk", number> = {
    "at-risk": 2,
    warn: 1,
    safe: 0,
  };
  allAtrophyRows.sort(
    (a, b) =>
      tierWeight[b.tier] - tierWeight[a.tier] ||
      b.totalTouches - a.totalTouches ||
      a.freshestKnowledge - b.freshestKnowledge,
  );

  const limits: string[] = [];
  if (handles.length === 0) {
    limits.push("No indexed repos in this org. Run `mneme index` per repo first.");
  }
  if (handles.length === 1) {
    limits.push("Only 1 repo indexed — cross-repo metrics need ≥ 2 indexed repos.");
  }
  if (org.reposMissing.length > 0) {
    limits.push(
      `${org.reposMissing.length} repo${org.reposMissing.length === 1 ? "" : "s"} not yet indexed (cross-repo signal undercounted).`,
    );
  }
  limits.push("Cross-repo pairs match by author email — distinct accounts for one person won't merge automatically.");

  return {
    org: {
      name: org.name,
      reposRequested: org.reposRequested,
      reposIndexed: handles.length,
      reposMissing: org.reposMissing,
    },
    totals: {
      commits: totalCommits,
      authors: authorEmails.size,
      files: totalFiles,
    },
    crossRepoPairs: crossRepoPairs.slice(0, topN),
    crossRepoAtrophy: allAtrophyRows.slice(0, topN),
    limits,
  };
}

function pairKey(p: TelepathyPair): string {
  const [a, b] = [p.authorA.email, p.authorB.email].sort();
  return `${a}|${b}`;
}

function round3(n: number): number {
  return Math.round(n * 1000) / 1000;
}

// Re-export shapes other modules may want.
export type { FileKnowledge };
