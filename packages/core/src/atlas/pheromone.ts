/**
 * v2.21.5 — ATLAS HELP · PHEROMONE log.
 *
 * Stigmergy-style learning over CLI verb usage. Every successful call
 * drops pheromone; pheromone decays over time. Top-N hot verbs surface
 * in `mneme --hot`. AI agents see the live "what works right now" set
 * without reading the full menu.
 *
 *   - Append-only JSONL log: cheap, no DB.
 *   - HMAC-signed entries (composes with TRUST CAPSULE chain).
 *   - Exponential decay: weight(verb) = sum( e^(-Δt/τ) ) over all hits.
 *     τ default = 7 days. Recent use dominates ancient use.
 *   - Top-N selection: simple sort over decayed weights.
 *
 * Cross-repo aggregation is a v2.22+ idea — for now, per-repo only.
 */

import { existsSync, readFileSync, appendFileSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { createHmac, randomBytes } from "node:crypto";

const DIR = ".mneme/atlas";
const LOG = "pheromones.jsonl";
const KEY = "atlas.key";

const DEFAULT_TAU_DAYS = 7;
const DEFAULT_TOP_N = 20;

export interface PheromoneHit {
  v: 1;
  ts: string;
  verb: string;
  /** Optional: actor (ai-agent / human / ci / daemon). */
  actor?: string;
  /** Optional: outcome (success / failure). Failures get half-weight. */
  outcome?: "success" | "failure";
  sig: string;
}

function dir(repoRoot: string): string {
  const d = join(repoRoot, DIR);
  if (!existsSync(d)) mkdirSync(d, { recursive: true });
  return d;
}

function getKey(repoRoot: string): string {
  const p = join(dir(repoRoot), KEY);
  if (existsSync(p)) return readFileSync(p, "utf8").trim();
  const k = randomBytes(32).toString("base64url");
  writeFileSync(p, k, "utf8");
  return k;
}

function sign(payload: string, k: string): string {
  return createHmac("sha256", k).update(payload).digest("base64url").slice(0, 22);
}

function logPath(repoRoot: string): string { return join(dir(repoRoot), LOG); }

export interface DropPheromoneOptions {
  verb: string;
  actor?: string;
  outcome?: "success" | "failure";
}

/** Drop one pheromone for a verb. Called by the CLI right after a
 *  successful action. */
export function dropPheromone(repoRoot: string, opts: DropPheromoneOptions): PheromoneHit {
  const k = getKey(repoRoot);
  const ts = new Date().toISOString();
  const canonical = `${ts}|${opts.verb}|${opts.actor ?? ""}|${opts.outcome ?? "success"}`;
  const sig = sign(canonical, k);
  const hit: PheromoneHit = {
    v: 1, ts, verb: opts.verb, sig,
    ...(opts.actor ? { actor: opts.actor } : {}),
    ...(opts.outcome ? { outcome: opts.outcome } : {}),
  };
  appendFileSync(logPath(repoRoot), JSON.stringify(hit) + "\n", "utf8");
  return hit;
}

export function listPheromones(repoRoot: string): PheromoneHit[] {
  const p = logPath(repoRoot);
  if (!existsSync(p)) return [];
  try {
    return readFileSync(p, "utf8").trim().split("\n").map((l) => { try { return JSON.parse(l) as PheromoneHit; } catch { return null; } }).filter((r): r is PheromoneHit => !!r);
  } catch { return []; }
}

export interface HotVerb {
  verb: string;
  /** Decayed weight: sum of e^(-Δt/τ) for every hit on this verb. */
  weight: number;
  /** Raw hit count. */
  hits: number;
  /** Last seen timestamp. */
  lastSeen: string;
}

/** Compute hot verbs via exponential decay. Same verbs ranked top-N. */
export function computeHot(repoRoot: string, opts: { tauDays?: number; topN?: number; now?: number } = {}): HotVerb[] {
  const tau = (opts.tauDays ?? DEFAULT_TAU_DAYS) * 86_400_000; // ms
  const topN = opts.topN ?? DEFAULT_TOP_N;
  const now = opts.now ?? Date.now();
  const hits = listPheromones(repoRoot);
  if (hits.length === 0) return [];
  const agg: Record<string, { weight: number; hits: number; lastSeen: string }> = {};
  for (const h of hits) {
    const t = Date.parse(h.ts);
    if (Number.isNaN(t)) continue;
    const dt = now - t;
    let w = Math.exp(-dt / tau);
    if (h.outcome === "failure") w *= 0.5;
    if (!agg[h.verb]) agg[h.verb] = { weight: 0, hits: 0, lastSeen: h.ts };
    agg[h.verb]!.weight += w;
    agg[h.verb]!.hits += 1;
    if (h.ts > agg[h.verb]!.lastSeen) agg[h.verb]!.lastSeen = h.ts;
  }
  return Object.entries(agg)
    .map(([verb, v]) => ({ verb, ...v }))
    .sort((a, b) => b.weight - a.weight)
    .slice(0, topN);
}

export function formatHot(hot: HotVerb[]): string {
  if (hot.length === 0) return "🗺  HOT verbs — (no pheromones yet · run any `mneme` command to seed)";
  const lines = ["🗺  HOT verbs (top by recent use)"];
  lines.push("");
  for (const h of hot) {
    const wStr = h.weight.toFixed(3).padStart(7);
    lines.push(`  ${wStr}  ${h.verb.padEnd(28)} ${h.hits} hit${h.hits === 1 ? "" : "s"}`);
  }
  return lines.join("\n");
}
