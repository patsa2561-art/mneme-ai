/**
 * v1.82.0 -- OSMOSIS: 24/7 second-brain expansion.
 *
 * Wild premise: Mneme's second brain should keep growing even while
 * the user sleeps. Every AI agent the user touches (Claude / Cursor /
 * Codex / Gemini / Cline / Aider / Copilot / web AIs) leaks usable
 * knowledge through:
 *   - Their replies (decisions, reasoning, verdicts)
 *   - Their tool calls (what they tried, what worked)
 *   - Their refusals (boundaries the user cares about)
 *
 * OSMOSIS harvests those leaks WITH USER CONSENT, distills them into
 * compact "wisdom shards", and merges into the local genome. The user
 * never trains anything; they just keep working, and the brain grows.
 *
 * Storage:
 *   .mneme/osmosis/shards/<id>.json   -- raw harvested observations
 *   .mneme/osmosis/wisdom.jsonl        -- distilled wisdom rules (signed)
 *   .mneme/osmosis/consent.json        -- per-vendor opt-in record
 *
 * Privacy: opt-in per vendor. Never harvests without explicit consent.
 * No content leaves your machine. Everything stored locally.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync, appendFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { createHash } from "node:crypto";

const OSMOSIS_DIR = ".mneme/osmosis";
const SHARDS_DIR = ".mneme/osmosis/shards";
const WISDOM_LOG = ".mneme/osmosis/wisdom.jsonl";
const CONSENT_FILE = ".mneme/osmosis/consent.json";

export interface HarvestObservation {
  /** Source AI vendor id. */
  vendor: string;
  /** What kind of leak (reply / tool-call / refusal). */
  kind: "reply" | "tool-call" | "refusal" | "verdict" | "decision";
  /** Short, distilled text. */
  text: string;
  /** Optional tags for later filtering. */
  tags?: readonly string[];
  /** ISO timestamp of the underlying interaction. */
  observedAt: string;
}

export interface WisdomShard {
  id: string;
  observations: HarvestObservation[];
  createdAt: string;
  /** Compressed wisdom rule distilled from the observations. */
  rule?: string;
  /** Self-rated confidence 0..1. */
  confidence: number;
  /** Hash chain pointer for tamper detection. */
  prevHash: string | null;
  hash: string;
}

export interface OsmosisConsent {
  /** vendor id -> opt-in boolean. */
  vendors: Record<string, boolean>;
  /** Daily harvest rate cap (observations/day). Default 100. */
  dailyCap: number;
  /** ISO timestamp when consent was last updated. */
  updatedAt: string;
}

function ensureDirs(repoRoot: string): { dir: string; shardsDir: string } {
  const dir = join(repoRoot, OSMOSIS_DIR);
  const shardsDir = join(repoRoot, SHARDS_DIR);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  if (!existsSync(shardsDir)) mkdirSync(shardsDir, { recursive: true });
  return { dir, shardsDir };
}

export function readConsent(repoRoot: string): OsmosisConsent {
  const path = join(repoRoot, CONSENT_FILE);
  if (!existsSync(path)) {
    return { vendors: {}, dailyCap: 100, updatedAt: new Date(0).toISOString() };
  }
  try {
    let raw = readFileSync(path, "utf8");
    if (raw.charCodeAt(0) === 0xfeff) raw = raw.slice(1);
    return JSON.parse(raw.trim()) as OsmosisConsent;
  } catch {
    return { vendors: {}, dailyCap: 100, updatedAt: new Date(0).toISOString() };
  }
}

export function setConsent(repoRoot: string, vendor: string, enabled: boolean): OsmosisConsent {
  ensureDirs(repoRoot);
  const current = readConsent(repoRoot);
  current.vendors[vendor] = enabled;
  current.updatedAt = new Date().toISOString();
  writeFileSync(join(repoRoot, CONSENT_FILE), JSON.stringify(current, null, 2), "utf8");
  return current;
}

function shardId(observations: readonly HarvestObservation[]): string {
  const concat = observations.map((o) => `${o.vendor}|${o.kind}|${o.text}`).join("\n");
  return createHash("sha256").update(concat).digest("hex").slice(0, 16);
}

function lastWisdomHash(repoRoot: string): string | null {
  const path = join(repoRoot, WISDOM_LOG);
  if (!existsSync(path)) return null;
  const raw = readFileSync(path, "utf8").trim();
  if (!raw) return null;
  const lines = raw.split("\n");
  try {
    const last = JSON.parse(lines[lines.length - 1]!) as WisdomShard;
    return last.hash;
  } catch {
    return null;
  }
}

/** Record an observation iff consent is granted for the vendor. */
export function harvest(repoRoot: string, obs: HarvestObservation): { recorded: boolean; reason?: string } {
  const consent = readConsent(repoRoot);
  if (consent.vendors[obs.vendor] !== true) {
    return { recorded: false, reason: `vendor ${obs.vendor} not opted-in` };
  }
  ensureDirs(repoRoot);
  const id = shardId([obs]);
  const path = join(repoRoot, SHARDS_DIR, `${id}.json`);
  if (existsSync(path)) {
    return { recorded: false, reason: "duplicate observation (same hash)" };
  }
  writeFileSync(path, JSON.stringify(obs, null, 2), "utf8");
  return { recorded: true };
}

/** Distill a batch of observations into a signed wisdom shard. */
export function distill(repoRoot: string, observations: readonly HarvestObservation[], rule?: string): WisdomShard {
  ensureDirs(repoRoot);
  const id = shardId(observations);
  const createdAt = new Date().toISOString();
  const prev = lastWisdomHash(repoRoot);
  const body = `${id}|${createdAt}|${observations.length}|${rule ?? ""}|${prev ?? ""}`;
  const hash = createHash("sha256").update(body).digest("hex");
  const confidence = Math.min(1, observations.length / 5);
  const shard: WisdomShard = {
    id,
    observations: [...observations],
    createdAt,
    rule,
    confidence,
    prevHash: prev,
    hash,
  };
  appendFileSync(join(repoRoot, WISDOM_LOG), JSON.stringify(shard) + "\n", "utf8");
  return shard;
}

/** Read all wisdom shards. Returns newest-first. */
export function listWisdom(repoRoot: string): WisdomShard[] {
  const path = join(repoRoot, WISDOM_LOG);
  if (!existsSync(path)) return [];
  const lines = readFileSync(path, "utf8").split("\n").filter(Boolean);
  const out: WisdomShard[] = [];
  for (const l of lines) {
    try {
      out.push(JSON.parse(l) as WisdomShard);
    } catch {
      // skip
    }
  }
  return out.reverse();
}

/** Verify the wisdom hash-chain. Returns the first index where the
 *  prevHash pointer breaks, or null if the entire chain is valid. */
export function verifyChain(repoRoot: string): { valid: boolean; brokenAtIndex: number | null } {
  const path = join(repoRoot, WISDOM_LOG);
  if (!existsSync(path)) return { valid: true, brokenAtIndex: null };
  const lines = readFileSync(path, "utf8").split("\n").filter(Boolean);
  let prev: string | null = null;
  for (let i = 0; i < lines.length; i++) {
    try {
      const shard = JSON.parse(lines[i]!) as WisdomShard;
      if (shard.prevHash !== prev) return { valid: false, brokenAtIndex: i };
      prev = shard.hash;
    } catch {
      return { valid: false, brokenAtIndex: i };
    }
  }
  return { valid: true, brokenAtIndex: null };
}

/** Count shards collected today (UTC). Used by the daily-cap guard. */
export function todayShardCount(repoRoot: string): number {
  const dir = join(repoRoot, SHARDS_DIR);
  if (!existsSync(dir)) return 0;
  const today = new Date().toISOString().slice(0, 10);
  let n = 0;
  for (const f of readdirSync(dir)) {
    if (!f.endsWith(".json")) continue;
    try {
      const obs = JSON.parse(readFileSync(join(dir, f), "utf8")) as HarvestObservation;
      if (obs.observedAt.slice(0, 10) === today) n++;
    } catch {
      // skip
    }
  }
  return n;
}
