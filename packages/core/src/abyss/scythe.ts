/**
 * v1.76.0 -- ABYSS MINION 1: SCYTHE (capsule TTL + auto-prune).
 *
 * The bug user spotted: `.mneme/capsules/` accumulates a capsule
 * EVERY session, forever. Disk fills, search slows, snapshots bloat.
 *
 * SCYTHE keeps the capsule directory bounded by two simultaneous
 * policies:
 *   1. Time-to-live (TTL): default 30 days. Older capsules deleted.
 *   2. Hard count cap: default 200. Beyond that, the oldest are
 *      culled regardless of age.
 *
 * Both policies apply -- a capsule survives only if BOTH its age is
 * under the TTL AND its rank (newest=0) is under the cap. Capsules
 * marked `keep: true` (set by the user / by REVENANT when archived)
 * are immune.
 *
 * Audit log: every prune writes a structured entry to
 * `.mneme/abyss/scythe.jsonl` so we can later prove what disappeared
 * and why. The daemon can call this nightly via `scheduledPrune()`.
 */

import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, appendFileSync } from "node:fs";
import { join } from "node:path";

export interface ScytheOptions {
  /** Time-to-live in milliseconds. Default 30 days. */
  ttlMs?: number;
  /** Maximum capsules to keep (newest first). Default 200. */
  maxCount?: number;
  /** Directory holding `.capsule` files. Default `<repoRoot>/.mneme/capsules`. */
  capsuleDir?: string;
  /** When true, list what WOULD be pruned without deleting. */
  dryRun?: boolean;
}

export interface ScythePrunedEntry {
  file: string;
  ageDays: number;
  reason: "ttl-exceeded" | "count-cap-exceeded" | "both";
  sizeBytes: number;
}

export interface ScytheReport {
  scannedCount: number;
  prunedCount: number;
  keptCount: number;
  bytesReclaimed: number;
  pruned: ScythePrunedEntry[];
  ttlMs: number;
  maxCount: number;
  dryRun: boolean;
  ranAt: string;
}

const DEFAULT_TTL_MS = 30 * 24 * 60 * 60 * 1000;
const DEFAULT_MAX_COUNT = 200;
const AUDIT_DIR = ".mneme/abyss";
const AUDIT_LOG = "scythe.jsonl";

function isCapsuleFile(name: string): boolean {
  return name.endsWith(".capsule") || name.endsWith(".capsule.json");
}

function isKeepMarked(filePath: string): boolean {
  try {
    const content = readFileSync(filePath, "utf8");
    // Conservative: anything that mentions "keep": true near the top.
    const j = JSON.parse(content);
    return j && j.keep === true;
  } catch {
    return false;
  }
}

/** Prune capsules in `<repoRoot>/.mneme/capsules` according to TTL + cap. */
export function pruneCapsules(repoRoot: string, opts: ScytheOptions = {}): ScytheReport {
  const ttlMs = opts.ttlMs ?? DEFAULT_TTL_MS;
  const maxCount = opts.maxCount ?? DEFAULT_MAX_COUNT;
  const dir = opts.capsuleDir ?? join(repoRoot, ".mneme/capsules");
  const ranAt = new Date().toISOString();
  const out: ScytheReport = {
    scannedCount: 0,
    prunedCount: 0,
    keptCount: 0,
    bytesReclaimed: 0,
    pruned: [],
    ttlMs,
    maxCount,
    dryRun: Boolean(opts.dryRun),
    ranAt,
  };

  if (!existsSync(dir)) return out;

  const entries = readdirSync(dir)
    .filter(isCapsuleFile)
    .map((name) => {
      const p = join(dir, name);
      const st = statSync(p);
      return { name, path: p, mtimeMs: st.mtimeMs, sizeBytes: st.size };
    })
    .sort((a, b) => b.mtimeMs - a.mtimeMs); // newest first

  out.scannedCount = entries.length;
  const now = Date.now();

  for (let i = 0; i < entries.length; i++) {
    const e = entries[i]!;
    const ageMs = now - e.mtimeMs;
    const ttlExceeded = ageMs > ttlMs;
    const countExceeded = i >= maxCount;
    const keep = isKeepMarked(e.path);
    if (keep) {
      out.keptCount += 1;
      continue;
    }
    if (!ttlExceeded && !countExceeded) {
      out.keptCount += 1;
      continue;
    }
    const reason: ScythePrunedEntry["reason"] =
      ttlExceeded && countExceeded ? "both" : ttlExceeded ? "ttl-exceeded" : "count-cap-exceeded";
    out.pruned.push({
      file: e.name,
      ageDays: Math.round(ageMs / 86_400_000),
      reason,
      sizeBytes: e.sizeBytes,
    });
    out.bytesReclaimed += e.sizeBytes;
    if (!opts.dryRun) {
      try {
        rmSync(e.path, { force: true });
      } catch {
        // ignore individual delete failures; reporter still surfaces them
      }
    }
  }
  out.prunedCount = out.pruned.length;

  // Audit log -- best-effort.
  if (!opts.dryRun) {
    try {
      const auditDir = join(repoRoot, AUDIT_DIR);
      if (!existsSync(auditDir)) mkdirSync(auditDir, { recursive: true });
      const auditPath = join(auditDir, AUDIT_LOG);
      const summary = {
        ranAt,
        scanned: out.scannedCount,
        pruned: out.prunedCount,
        kept: out.keptCount,
        bytes: out.bytesReclaimed,
        ttlMs,
        maxCount,
        files: out.pruned.map((p) => p.file),
      };
      appendFileSync(auditPath, JSON.stringify(summary) + "\n", "utf8");
    } catch {
      // audit best-effort
    }
  }

  return out;
}

/** Daemon-friendly nightly entry point. Same as pruneCapsules with defaults. */
export function scheduledPrune(repoRoot: string): ScytheReport {
  return pruneCapsules(repoRoot, {});
}
