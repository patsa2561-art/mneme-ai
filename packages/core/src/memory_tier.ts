/**
 * MNEME MEMORY TIER -- transparency layer for the embedder cascade (v1.30.0).
 *
 * Pre-fix: when the embedder cascade fell through to the hash tier
 * (★★ deterministic, near-random semantic quality), the rest of Mneme
 * silently kept marketing itself as "the memory layer of your codebase".
 * A user on the hash tier got search results that looked credible but
 * were essentially keyword overlap -- and never got told.
 *
 * This module exposes the active tier as a first-class signal:
 *   - readMemoryTier(repoRoot) -- read what tier the LAST `mneme index`
 *     run actually used, persisted in `.mneme/store/meta.json` -> `embedder`.
 *   - tierBadge(name) -- render a star-rating + one-word quality label.
 *   - tierWarningForPulse(name) -- when the user is on hash, return a
 *     warning line for the pulse so they know their memory is degraded
 *     AND the one-command upgrade path.
 *
 * Why a SEPARATE module from packages/embeddings?
 *   - `core` is loaded everywhere (pulse, daemon, MCP server). Importing
 *     `@mneme-ai/embeddings` from core creates a cyclic dep.
 *   - This module ONLY READS the persisted tier name from disk. The
 *     actual embedder selection still happens in resolve.ts.
 */

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

export type MemoryTierName = "openai" | "ollama" | "bundled" | "hash" | "unknown";

export interface MemoryTierInfo {
  name: MemoryTierName;
  /** Human-readable display name. */
  display: string;
  /** Star rating 1-5. */
  stars: number;
  /** One-word quality bucket. */
  quality: "excellent" | "good" | "fair" | "degraded" | "unknown";
  /** True iff this tier produces real semantic embeddings. */
  semantic: boolean;
}

const TIER_BADGES: Record<MemoryTierName, MemoryTierInfo> = {
  openai:  { name: "openai",  display: "OpenAI text-embedding-3",       stars: 5, quality: "excellent", semantic: true  },
  ollama:  { name: "ollama",  display: "Ollama (local, free)",          stars: 4, quality: "good",      semantic: true  },
  bundled: { name: "bundled", display: "Bundled MiniLM-L6 WASM",        stars: 3, quality: "fair",      semantic: true  },
  hash:    { name: "hash",    display: "Hash trick (no semantic)",      stars: 2, quality: "degraded",  semantic: false },
  unknown: { name: "unknown", display: "(no embedder seen yet)",        stars: 0, quality: "unknown",   semantic: false },
};

/** Map a stored embedder name (which uses the *runtime* class name like
 *  "openai-text-embedding-3-small" or "bundled-Xenova-all-MiniLM-L6-v2")
 *  to a canonical tier. Substring-match keeps it tolerant of model
 *  changes without needing this table to track every variant. */
export function classifyEmbedderName(stored: string | undefined | null): MemoryTierName {
  if (!stored) return "unknown";
  const s = stored.toLowerCase();
  if (s.startsWith("openai") || s.includes("text-embedding-")) return "openai";
  if (s.startsWith("ollama") || s.includes("nomic-embed") || s.includes("mxbai-embed")) return "ollama";
  if (s.startsWith("bundled") || s.includes("minilm") || s.includes("xenova")) return "bundled";
  if (s.startsWith("hash") || s === "hash-trick") return "hash";
  return "unknown";
}

export function tierInfo(name: MemoryTierName): MemoryTierInfo {
  return TIER_BADGES[name];
}

export function tierBadge(name: MemoryTierName): string {
  const info = TIER_BADGES[name];
  const stars = "★".repeat(info.stars) + "☆".repeat(Math.max(0, 5 - info.stars));
  return `${info.display} ${stars}`;
}

/** Read the tier the last `mneme index` actually used, by inspecting
 *  the persisted store metadata. Returns "unknown" when no index has run. */
export function readMemoryTier(repoRoot: string): MemoryTierInfo {
  const metaPath = join(repoRoot, ".mneme", "store", "meta.json");
  if (!existsSync(metaPath)) {
    // Try the alternate location -- some older versions wrote alongside.
    const altPath = join(repoRoot, ".mneme", "meta.json");
    if (!existsSync(altPath)) return TIER_BADGES.unknown;
    try {
      const m = JSON.parse(readFileSync(altPath, "utf8")) as { embedder?: string };
      return TIER_BADGES[classifyEmbedderName(m.embedder)];
    } catch { return TIER_BADGES.unknown; }
  }
  try {
    const m = JSON.parse(readFileSync(metaPath, "utf8")) as { embedder?: string };
    return TIER_BADGES[classifyEmbedderName(m.embedder)];
  } catch { return TIER_BADGES.unknown; }
}

/** When the active tier is hash (degraded), return a pulse warning line +
 *  the one-command upgrade. Returns null otherwise so quiet pulses stay
 *  quiet. */
export function tierWarningForPulse(repoRoot: string): {
  text: string; remedy: string;
} | null {
  const tier = readMemoryTier(repoRoot);
  if (tier.name !== "hash") return null;
  return {
    text: "Memory layer is on the HASH tier (★★ deterministic, no semantic search) -- DEGRADED.",
    remedy: "Upgrade now: `mneme embeddings upgrade` (downloads the bundled MiniLM model, ~25MB, ★★★ semantic).",
  };
}
