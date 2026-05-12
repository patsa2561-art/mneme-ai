/**
 * v1.68.0 -- ASCENSION ASC-4: PROPHETIC EMBEDDER.
 *
 * Root-cause fix for the "config says ollama but pulse reports
 * hash:fnv-256 fallback" bug. We compare THREE truth sources every
 * pulse:
 *
 *   1. Config provider     -- .mneme/config.json -> embeddings.provider
 *   2. Schroedinger winner -- .mneme/embedder-status.json -> winner
 *   3. Actual last-tier    -- .mneme/store/meta.json -> embedder
 *
 * If they disagree -> DRIFT alarm with the specific cause + named
 * fix step. Most-common drift = config got upgraded but indexer
 * hasn't re-run yet, so meta.json still records the old tier.
 *
 * Pure-read; ALWAYS surfaces the right next-action.
 */

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { classifyEmbedderName, tierInfo, type MemoryTierName } from "../memory_tier.js";

export interface ProphecyReport {
  /** What config says we WANT. */
  configTier: MemoryTierName;
  /** What Schroedinger says we CAN have. */
  schroedingerWinner: MemoryTierName | null;
  /** What the indexer last USED. */
  lastIndexedTier: MemoryTierName | null;
  /** Is the trio aligned? */
  aligned: boolean;
  /** Plain-English drift cause. */
  driftCause: string | null;
  /** Concrete fix action the AI agent should propose. */
  fixAction: string | null;
  /** ISO ts. */
  builtAt: string;
}

function readJson<T>(path: string): T | null {
  if (!existsSync(path)) return null;
  try { return JSON.parse(readFileSync(path, "utf8")) as T; } catch { return null; }
}

export function prophecy(repoRoot: string): ProphecyReport {
  const builtAt = new Date().toISOString();

  // Source 1: config
  const cfg = readJson<{ embeddings?: { provider?: string } }>(join(repoRoot, ".mneme/config.json"));
  const configProvider = cfg?.embeddings?.provider ?? "unknown";
  const configTier = classifyEmbedderName(configProvider);

  // Source 2: Schroedinger winner (from autarchy A2)
  const schroedinger = readJson<{ winner?: string }>(join(repoRoot, ".mneme/embedder-status.json"));
  const schroedingerWinner: MemoryTierName | null = schroedinger?.winner
    ? classifyEmbedderName(schroedinger.winner)
    : null;

  // Source 3: indexer's last record
  const meta = readJson<{ embedder?: string }>(join(repoRoot, ".mneme/store/meta.json"));
  const lastIndexedTier: MemoryTierName | null = meta?.embedder
    ? classifyEmbedderName(meta.embedder)
    : null;

  // Alignment check.
  const tiers = [configTier, schroedingerWinner, lastIndexedTier].filter((t) => t !== null) as MemoryTierName[];
  const distinct = new Set(tiers);
  const aligned = distinct.size <= 1;

  let driftCause: string | null = null;
  let fixAction: string | null = null;

  if (!aligned) {
    // Diagnose the drift.
    if (lastIndexedTier && configTier !== lastIndexedTier) {
      driftCause = `Config says ${tierInfo(configTier).display}, but the indexer last used ${tierInfo(lastIndexedTier).display}.`;
      fixAction = `Run \`mneme index --force\` to rebuild the store with the configured embedder.`;
    } else if (schroedingerWinner && configTier !== schroedingerWinner) {
      driftCause = `Config selects ${tierInfo(configTier).display}, but Schroedinger probe found ${tierInfo(schroedingerWinner).display} as best available.`;
      fixAction = `Run \`mneme.embedder.autodiagnose persist=true\` to upgrade config to the Schroedinger winner.`;
    } else {
      driftCause = `Sources mismatch: config=${tierInfo(configTier).name}, schroedinger=${schroedingerWinner ?? "(none)"}, lastIndexed=${lastIndexedTier ?? "(none)"}.`;
      fixAction = `Run \`mneme.autarchy.status install=true\` to re-probe + re-align all three sources.`;
    }
  }

  return {
    configTier,
    schroedingerWinner,
    lastIndexedTier,
    aligned,
    driftCause,
    fixAction,
    builtAt,
  };
}

/** One-line pulse-friendly summary. */
export function prophecyHeadline(report: ProphecyReport): string {
  if (report.aligned) {
    return `Embedder aligned (${tierInfo(report.configTier).display}).`;
  }
  return `Embedder DRIFT: ${report.driftCause} Fix: ${report.fixAction}`;
}
