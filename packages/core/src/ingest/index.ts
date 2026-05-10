/**
 * Mneme Ingest+ -- public surface.
 *
 *   scrapePRReviews(repoRoot)  -- gh CLI -> PR review + issue comments
 *   scrapeLinear()             -- LINEAR_API_KEY -> Linear issues + comments
 *   scrapeJira()               -- JIRA_BASE_URL/EMAIL/API_TOKEN -> Jira issues + comments
 *   writeIngestedChunks(...)   -- persist for retrieval to pick up
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { IngestedChunk, IngestStats } from "./types.js";

export type { IngestedChunk, IngestStats } from "./types.js";
export { scrapePRReviews } from "./pr_reviews.js";
export { scrapeLinear, scrapeJira } from "./linear_jira.js";

const DIR = ".mneme/ingest";
const CHUNKS_FILE = ".mneme/ingest/chunks.jsonl";
const STATS_FILE = ".mneme/ingest/stats.json";

function ensureDir(repoRoot: string): void {
  const dir = join(repoRoot, DIR);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
}

/** Append (de-duped on id) ingested chunks to .mneme/ingest/chunks.jsonl. */
export function writeIngestedChunks(repoRoot: string, chunks: IngestedChunk[]): number {
  if (chunks.length === 0) return 0;
  ensureDir(repoRoot);
  const path = join(repoRoot, CHUNKS_FILE);
  const existing = readIngestedChunks(repoRoot);
  const seen = new Set(existing.map((c) => c.id));
  const fresh = chunks.filter((c) => !seen.has(c.id));
  if (fresh.length === 0) return 0;
  const lines = fresh.map((c) => JSON.stringify(c)).join("\n") + "\n";
  try {
    if (existsSync(path)) {
      // append
      const fd = readFileSync(path, "utf8");
      writeFileSync(path, fd + lines, "utf8");
    } else {
      writeFileSync(path, lines, "utf8");
    }
  } catch { /* best-effort */ }
  return fresh.length;
}

export function readIngestedChunks(repoRoot: string): IngestedChunk[] {
  const path = join(repoRoot, CHUNKS_FILE);
  if (!existsSync(path)) return [];
  try {
    const lines = readFileSync(path, "utf8").trim().split("\n").filter(Boolean);
    return lines.map((l) => JSON.parse(l) as IngestedChunk).filter((x) => x && typeof x.id === "string");
  } catch { return []; }
}

export function writeStats(repoRoot: string, stats: IngestStats[]): void {
  ensureDir(repoRoot);
  try {
    writeFileSync(join(repoRoot, STATS_FILE), JSON.stringify(stats, null, 2), "utf8");
  } catch { /* best-effort */ }
}
export function readStats(repoRoot: string): IngestStats[] {
  const path = join(repoRoot, STATS_FILE);
  if (!existsSync(path)) return [];
  try { return JSON.parse(readFileSync(path, "utf8")); } catch { return []; }
}
