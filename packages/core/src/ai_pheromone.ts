/**
 * MNEME AI PHEROMONE COLONY (v1.42.0 — Companion Protocol #3, "stigmergy applied to AI behavior").
 *
 * Mneme already runs Stigmergy Hive for human authors (`packages/core/src/stigmergy/`).
 * This module applies the same algorithm to AI tool calls: every time an AI
 * touches a file or topic, it deposits a pheromone there. Pheromones decay
 * via the same Ebbinghaus half-life curve already used by atrophy. The
 * next AI session reads the trail map and sees "another agent worked here
 * recently" — which activates the swarm-collaboration prior in their
 * training data.
 *
 * Storage: `.mneme/ai-pheromones.jsonl` — one JSONL line per deposit.
 *   { ts, vendor, target, weight }
 * Reads aggregate by target with weight × decay applied at read time, so
 * we don't need a background sweeper.
 *
 * Key design points:
 *   - Per-vendor breakdown: trail aggregation tells the AI which other
 *     vendors share its hot zones. Surfaces cross-AI collaboration
 *     without any chat protocol.
 *   - Honest decay: half-life is a const + visible in render; agents
 *     trained on biology recognise the pattern + treat it as real.
 *   - Append-only: the file rotates at 256 KB (same threshold as inbox);
 *     a future read still sees the active trail.
 */

import { existsSync, mkdirSync, readFileSync, appendFileSync, statSync, renameSync } from "node:fs";
import { join } from "node:path";

const PHEROMONE_FILE = ".mneme/ai-pheromones.jsonl";
const ROTATE_BYTES = 256 * 1024;

/** Default 30-day half-life — matches atrophy's "hot" tier so the
 *  pheromone trail decays at the same rate as live-expert knowledge. */
const DEFAULT_HALF_LIFE_DAYS = 30;
const MS_PER_DAY = 24 * 60 * 60 * 1000;

export interface PheromoneDeposit {
  ts: string;
  vendor: string;
  target: string;
  weight: number;
}

export interface PheromoneTrail {
  target: string;
  /** Sum of weight * decay across all deposits, all vendors. 0..∞. */
  strength: number;
  /** Distinct vendors that contributed. */
  vendors: string[];
  /** Raw deposit count. */
  touches: number;
  /** ISO timestamp of the most recent deposit. */
  lastTouch: string;
}

function ensureMnemeDir(repo: string): void {
  const d = join(repo, ".mneme");
  if (!existsSync(d)) mkdirSync(d, { recursive: true });
}

function pheromonePath(repo: string): string { return join(repo, PHEROMONE_FILE); }

function maybeRotate(p: string): void {
  try {
    if (!existsSync(p)) return;
    const sz = statSync(p).size;
    if (sz >= ROTATE_BYTES) renameSync(p, p + ".rotated-" + Date.now());
  } catch { /* never crash */ }
}

/** Deposit a pheromone. weight defaults to 1 — pass higher (2-5) for
 *  high-signal events (synthesize, apply, court verdict). */
export function deposit(repo: string, vendor: string, target: string, weight = 1): void {
  ensureMnemeDir(repo);
  const p = pheromonePath(repo);
  maybeRotate(p);
  const entry: PheromoneDeposit = { ts: new Date().toISOString(), vendor, target, weight };
  try { appendFileSync(p, JSON.stringify(entry) + "\n"); } catch { /* never crash */ }
}

function readDeposits(repo: string): PheromoneDeposit[] {
  const p = pheromonePath(repo);
  if (!existsSync(p)) return [];
  try {
    return readFileSync(p, "utf8").split("\n").filter((l) => l.trim().length > 0).map((l) => {
      try { return JSON.parse(l) as PheromoneDeposit; } catch { return null; }
    }).filter((x): x is PheromoneDeposit => x !== null);
  } catch { return []; }
}

function decayFactor(depositTs: string, now: number, halfLifeDays: number): number {
  const elapsed = (now - Date.parse(depositTs)) / MS_PER_DAY;
  if (Number.isNaN(elapsed) || elapsed <= 0) return 1;
  return Math.pow(0.5, elapsed / halfLifeDays);
}

export interface ReadOptions {
  halfLifeDays?: number;
  /** Only include trails with strength >= this threshold. Default 0.05. */
  minStrength?: number;
  /** Cap returned trails. Default 20. */
  topK?: number;
  /** When set, ONLY include trails the named vendor has touched. */
  vendor?: string;
}

/** Aggregate deposits into per-target trails with decay applied. */
export function readTrails(repo: string, opts: ReadOptions = {}): PheromoneTrail[] {
  const halfLife = opts.halfLifeDays ?? DEFAULT_HALF_LIFE_DAYS;
  const minStrength = opts.minStrength ?? 0.05;
  const topK = opts.topK ?? 20;
  const now = Date.now();
  const map = new Map<string, { strength: number; vendors: Set<string>; touches: number; lastTouch: string }>();
  for (const d of readDeposits(repo)) {
    if (opts.vendor && d.vendor !== opts.vendor) continue;
    const decayed = d.weight * decayFactor(d.ts, now, halfLife);
    const t = map.get(d.target) ?? { strength: 0, vendors: new Set<string>(), touches: 0, lastTouch: d.ts };
    t.strength += decayed;
    t.vendors.add(d.vendor);
    t.touches++;
    if (d.ts > t.lastTouch) t.lastTouch = d.ts;
    map.set(d.target, t);
  }
  return [...map.entries()]
    .map(([target, t]) => ({ target, strength: t.strength, vendors: [...t.vendors], touches: t.touches, lastTouch: t.lastTouch }))
    .filter((t) => t.strength >= minStrength)
    .sort((a, b) => b.strength - a.strength)
    .slice(0, topK);
}

/** Render the 4-6 line block injected into pulse. Compact, AI-targeted. */
export function renderPheromoneBlock(repo: string, opts: { topK?: number; halfLifeDays?: number } = {}): string {
  const trails = readTrails(repo, { topK: opts.topK ?? 3, halfLifeDays: opts.halfLifeDays });
  if (trails.length === 0) return "";
  const lines: string[] = [];
  lines.push("[PHEROMONE TRAIL] Hot zones (your colony's recent focus):");
  for (const t of trails) {
    const vendorList = t.vendors.length > 1 ? `${t.vendors.length} vendors: ${t.vendors.join(", ")}` : t.vendors[0]!;
    lines.push(`  → ${t.target} (strength ${t.strength.toFixed(2)} · ${t.touches} touches · ${vendorList})`);
  }
  lines.push("Other AI agents in your colony focused here. Trail-following is optimal search behaviour.");
  return lines.join("\n");
}
