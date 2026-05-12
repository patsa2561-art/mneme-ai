/**
 * v1.65.1 -- EMBEDDER AUTODIAGNOSE.
 *
 * Detects the GAP between the highest tier actually available on the
 * machine and the tier the user's config selected. If the user is
 * sitting on hash tier (★★) while bundled WASM or Ollama is reachable,
 * the autodiagnose flags it AND offers a one-call upgrade.
 *
 * Probe priority (best -> worst):
 *   1. openai  -- env OPENAI_API_KEY set
 *   2. ollama  -- 127.0.0.1:11434 reachable
 *   3. bundled -- @huggingface/transformers importable + cache writable
 *   4. hash    -- always available
 *
 * Pure-read by default; persist=true rewrites .mneme/config.json so
 * the next session picks the upgraded provider.
 *
 * No actual embed calls are made -- probe is cheap (<200ms). The
 * actual model download still happens lazily on first `mneme index`.
 */

import { existsSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { request } from "node:http";

import { classifyEmbedderName, tierInfo, type MemoryTierInfo, type MemoryTierName } from "./memory_tier.js";

export interface EmbedderProbe {
  tier: MemoryTierName;
  available: boolean;
  /** Brief why-not when available=false. */
  reason?: string;
  /** Time spent in probe, ms. */
  ms: number;
}

export interface AutodiagnoseReport {
  /** Tier currently selected in .mneme/config.json (or default). */
  currentTier: MemoryTierName;
  /** Highest available tier on this machine. */
  bestAvailable: MemoryTierName;
  /** True iff bestAvailable is strictly above currentTier. */
  hasUpgrade: boolean;
  /** Probes for each candidate tier. */
  probes: EmbedderProbe[];
  /** Plain-English headline. */
  headline: string;
  /** Recommended action when hasUpgrade=true; null otherwise. */
  recommendation: { action: "switch-to"; tier: MemoryTierName; rationale: string } | null;
  /** When persist=true and recommendation acted on, the config path written. */
  configPathWritten: string | null;
  /** Total wall-time, ms. */
  ms: number;
}

const TIER_RANK: Record<MemoryTierName, number> = {
  openai: 4, ollama: 3, bundled: 2, hash: 1, unknown: 0,
};

function readConfig(repoRoot: string): { embeddings?: { provider?: string; model?: string }; [k: string]: unknown } {
  const p = join(repoRoot, ".mneme/config.json");
  if (!existsSync(p)) return {};
  try { return JSON.parse(readFileSync(p, "utf8")) as Record<string, unknown>; } catch { return {}; }
}

function writeConfig(repoRoot: string, cfg: Record<string, unknown>): string {
  const dir = join(repoRoot, ".mneme");
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  const p = join(dir, "config.json");
  writeFileSync(p, JSON.stringify(cfg, null, 2) + "\n", "utf8");
  return p;
}

function probeOpenAI(): EmbedderProbe {
  const t0 = Date.now();
  const hasKey = typeof process.env["OPENAI_API_KEY"] === "string" && process.env["OPENAI_API_KEY"]!.length >= 10;
  return {
    tier: "openai",
    available: hasKey,
    reason: hasKey ? undefined : "OPENAI_API_KEY not set",
    ms: Date.now() - t0,
  };
}

function probeOllama(timeoutMs = 500): Promise<EmbedderProbe> {
  return new Promise((resolve) => {
    const t0 = Date.now();
    const req = request({ host: "127.0.0.1", port: 11434, path: "/api/tags", method: "GET", timeout: timeoutMs }, (res) => {
      res.resume();
      resolve({ tier: "ollama", available: (res.statusCode ?? 0) < 500, ms: Date.now() - t0 });
    });
    req.on("timeout", () => {
      req.destroy();
      resolve({ tier: "ollama", available: false, reason: "Ollama 127.0.0.1:11434 timeout", ms: Date.now() - t0 });
    });
    req.on("error", (e) => resolve({ tier: "ollama", available: false, reason: `Ollama unreachable: ${e.message}`, ms: Date.now() - t0 }));
    req.end();
  });
}

async function probeBundled(): Promise<EmbedderProbe> {
  const t0 = Date.now();
  try {
    // Just check that the package resolves; do NOT load model (kept cheap).
    // The actual download happens lazily on first embed.
    await import("@huggingface/transformers");
    return { tier: "bundled", available: true, ms: Date.now() - t0 };
  } catch (e) {
    return { tier: "bundled", available: false, reason: `@huggingface/transformers import failed: ${(e as Error).message}`, ms: Date.now() - t0 };
  }
}

function probeHash(): EmbedderProbe {
  return { tier: "hash", available: true, ms: 0 };
}

export interface AutodiagnoseOptions {
  /** If true, rewrite .mneme/config.json to switch to bestAvailable. Default false. */
  persist?: boolean;
  /** Skip Ollama probe (e.g. test environments). Default false. */
  skipOllama?: boolean;
  /** Skip Bundled probe (e.g. CI without network). Default false. */
  skipBundled?: boolean;
}

export async function autodiagnose(repoRoot: string, opts?: AutodiagnoseOptions): Promise<AutodiagnoseReport> {
  const t0 = Date.now();
  const cfg = readConfig(repoRoot);
  const currentName = cfg.embeddings?.provider ?? "unknown";
  const currentTier = classifyEmbedderName(currentName);

  const probes: EmbedderProbe[] = [];
  probes.push(probeOpenAI());
  if (!opts?.skipOllama) probes.push(await probeOllama());
  if (!opts?.skipBundled) probes.push(await probeBundled());
  probes.push(probeHash());

  // Pick best available.
  let bestAvailable: MemoryTierName = "hash";
  let bestRank = TIER_RANK.hash;
  for (const p of probes) {
    if (!p.available) continue;
    const r = TIER_RANK[p.tier];
    if (r > bestRank) {
      bestRank = r;
      bestAvailable = p.tier;
    }
  }

  const hasUpgrade = TIER_RANK[bestAvailable] > TIER_RANK[currentTier];

  let configPathWritten: string | null = null;
  if (opts?.persist && hasUpgrade) {
    const next: Record<string, unknown> = { ...cfg, embeddings: { ...(cfg.embeddings ?? {}), provider: bestAvailable } };
    configPathWritten = writeConfig(repoRoot, next);
  }

  const currentBadge = tierInfo(currentTier).display;
  const bestBadge = tierInfo(bestAvailable).display;
  const headline = hasUpgrade
    ? `Upgrade available: currently on ${currentBadge} (★${tierInfo(currentTier).stars}), can upgrade to ${bestBadge} (★${tierInfo(bestAvailable).stars}).`
    : `Already at best available tier: ${currentBadge} (★${tierInfo(currentTier).stars}).`;
  const recommendation = hasUpgrade
    ? {
        action: "switch-to" as const,
        tier: bestAvailable,
        rationale: bestAvailable === "openai"
          ? "OPENAI_API_KEY detected; switch to ★★★★★ tier."
          : bestAvailable === "ollama"
            ? "Ollama reachable locally; free ★★★★ semantic embeddings."
            : bestAvailable === "bundled"
              ? "Bundled WASM available; ★★★ semantic embeddings without external service."
              : "(no upgrade)",
      }
    : null;

  return {
    currentTier,
    bestAvailable,
    hasUpgrade,
    probes,
    headline,
    recommendation,
    configPathWritten,
    ms: Date.now() - t0,
  };
}

/** Returns the resolved memory-tier info for the (possibly upgraded)
 *  current config. Convenience for pulse/status surfaces. */
export function currentTierInfo(repoRoot: string): MemoryTierInfo {
  const cfg = readConfig(repoRoot);
  const name = cfg.embeddings?.provider ?? "unknown";
  return tierInfo(classifyEmbedderName(name));
}
