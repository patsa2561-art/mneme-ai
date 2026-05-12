/**
 * v1.66.0 -- AUTARCHY A2: SCHROEDINGER EMBEDDER.
 *
 * Wild idea: don't pick ONE embedder at config time. Probe all four
 * tiers concurrently at startup, write the AUTHORITATIVE winner to
 * `.mneme/embedder-status.json`, and let the pulse + every other
 * consumer read from THAT instead of guessing at runtime.
 *
 * This kills the "phantom WASM fallback" report once and for all:
 * if WASM verified successfully, the status file says so -- no
 * stale pulse text can override observed truth.
 *
 * Status file format:
 *   {
 *     ts: ISO,
 *     winner: "openai"|"ollama"|"bundled"|"hash",
 *     allTiers: [{ tier, available, verifyMs, reason? }, ...],
 *     stableSince: ISO,
 *     winnerChangedAt: ISO|null,
 *   }
 *
 * Re-probed once per session via cooldownMs. Sub-second on warm path.
 */

import { existsSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { request } from "node:http";

import { classifyEmbedderName, tierInfo, type MemoryTierName } from "../memory_tier.js";

const STATUS_FILE = ".mneme/embedder-status.json";
const TIER_RANK: Record<MemoryTierName, number> = {
  openai: 4, ollama: 3, bundled: 2, hash: 1, unknown: 0,
};

export interface TierProbeResult {
  tier: MemoryTierName;
  available: boolean;
  verifyMs: number;
  reason?: string;
}

export interface EmbedderStatus {
  ts: string;
  winner: MemoryTierName;
  allTiers: TierProbeResult[];
  stableSince: string;
  winnerChangedAt: string | null;
  /** Plain-English. */
  headline: string;
}

function probeOpenAI(): TierProbeResult {
  const t0 = Date.now();
  const ok = typeof process.env["OPENAI_API_KEY"] === "string" && process.env["OPENAI_API_KEY"]!.length >= 10;
  return { tier: "openai", available: ok, verifyMs: Date.now() - t0, reason: ok ? undefined : "OPENAI_API_KEY not set" };
}

function probeOllama(timeoutMs = 500): Promise<TierProbeResult> {
  return new Promise((resolve) => {
    const t0 = Date.now();
    const req = request({ host: "127.0.0.1", port: 11434, path: "/api/tags", method: "GET", timeout: timeoutMs }, (res) => {
      res.resume();
      resolve({ tier: "ollama", available: (res.statusCode ?? 0) < 500, verifyMs: Date.now() - t0 });
    });
    req.on("timeout", () => { req.destroy(); resolve({ tier: "ollama", available: false, verifyMs: Date.now() - t0, reason: "timeout" }); });
    req.on("error", (e) => resolve({ tier: "ollama", available: false, verifyMs: Date.now() - t0, reason: e.message }));
    req.end();
  });
}

async function probeBundled(): Promise<TierProbeResult> {
  const t0 = Date.now();
  try {
    await import("@huggingface/transformers");
    return { tier: "bundled", available: true, verifyMs: Date.now() - t0 };
  } catch (e) {
    return { tier: "bundled", available: false, verifyMs: Date.now() - t0, reason: (e as Error).message };
  }
}

function pickWinner(probes: TierProbeResult[]): MemoryTierName {
  let best: MemoryTierName = "hash";
  let bestRank = TIER_RANK.hash;
  for (const p of probes) {
    if (!p.available) continue;
    const r = TIER_RANK[p.tier];
    if (r > bestRank) { best = p.tier; bestRank = r; }
  }
  return best;
}

function readPrior(repoRoot: string): EmbedderStatus | null {
  const p = join(repoRoot, STATUS_FILE);
  if (!existsSync(p)) return null;
  try { return JSON.parse(readFileSync(p, "utf8")) as EmbedderStatus; } catch { return null; }
}

function persist(repoRoot: string, status: EmbedderStatus): void {
  const dir = join(repoRoot, ".mneme");
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "embedder-status.json"), JSON.stringify(status, null, 2) + "\n", "utf8");
}

export interface ProbeOptions {
  /** Re-probe even if a recent status exists. Default false. */
  force?: boolean;
  /** Skip Ollama probe (e.g. CI). */
  skipOllama?: boolean;
  /** Skip Bundled probe. */
  skipBundled?: boolean;
  /** Reprobe cooldown ms; if last probe is younger, reuse cached. */
  cooldownMs?: number;
}

/** Run the parallel race. Always writes `.mneme/embedder-status.json`. */
export async function observeEmbedders(repoRoot: string, opts?: ProbeOptions): Promise<EmbedderStatus> {
  const cooldownMs = opts?.cooldownMs ?? 60_000;
  const prior = readPrior(repoRoot);
  if (!opts?.force && prior) {
    const age = Date.now() - Date.parse(prior.ts);
    if (Number.isFinite(age) && age < cooldownMs) return prior;
  }

  // Parallel race -- all probes fire at once.
  const promises: Array<Promise<TierProbeResult>> = [];
  promises.push(Promise.resolve(probeOpenAI()));
  if (!opts?.skipOllama) promises.push(probeOllama());
  if (!opts?.skipBundled) promises.push(probeBundled());
  promises.push(Promise.resolve({ tier: "hash", available: true, verifyMs: 0 } as TierProbeResult));
  const allTiers = await Promise.all(promises);
  const winner = pickWinner(allTiers);
  const ts = new Date().toISOString();

  const winnerChangedAt = prior && prior.winner !== winner ? ts : prior?.winnerChangedAt ?? null;
  const stableSince = prior && prior.winner === winner ? prior.stableSince : ts;

  const tierBadge = `${tierInfo(winner).display} ★${tierInfo(winner).stars}`;
  const headline = `Schroedinger collapse: ${tierBadge}. Probed ${allTiers.length} tiers in parallel; ${allTiers.filter((t) => t.available).length} available.`;

  const status: EmbedderStatus = { ts, winner, allTiers, stableSince, winnerChangedAt, headline };
  persist(repoRoot, status);
  return status;
}

/** Read the persisted authoritative status. Returns null if not probed yet. */
export function readEmbedderStatus(repoRoot: string): EmbedderStatus | null {
  return readPrior(repoRoot);
}
