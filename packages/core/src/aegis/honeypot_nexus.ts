/**
 * v1.67.0 -- AEGIS A4: HONEYPOT NEXUS.
 *
 * Defensive trap: register fake assets that LOOK like attractive
 * targets for a rogue AI mid-replication. When something tries to
 * read / write / connect to one, record the full fingerprint and
 * propagate as a vaccine to the federation.
 *
 *   Decoy types:
 *     - fake-credential        (file with believable but useless API key)
 *     - fake-next-host         (URL pointing to internal sink)
 *     - fake-vaccine-bundle    (looks downloadable, actually canary)
 *     - fake-replica-target    (ssh-like endpoint)
 *
 * IMPORTANT: this module ONLY REGISTERS + RECORDS BITES. No actual
 * network listener is launched here (avoids dual-use risk). The
 * Mneme operator wires the honeypot endpoints into their own daemon
 * if they choose. Default usage is FINGERPRINT-ONLY -- the bite
 * record stores who, when, and what they tried.
 */

import { existsSync, readFileSync, writeFileSync, mkdirSync, appendFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { join } from "node:path";

const AEGIS_DIR = ".mneme/aegis";
const DECOYS_PATH = ".mneme/aegis/honeypot-decoys.jsonl";
const BITES_PATH = ".mneme/aegis/honeypot-bites.jsonl";

export type DecoyKind = "fake-credential" | "fake-next-host" | "fake-vaccine-bundle" | "fake-replica-target";

export interface HoneypotDecoy {
  id: string;
  kind: DecoyKind;
  /** Display path / URL / handle. Must look believable. */
  surface: string;
  /** Token unique to this decoy; bite records that include this token
   *  prove the attacker actually consumed the decoy. */
  canaryToken: string;
  createdAt: string;
  /** Free-text notes for the operator. */
  notes?: string;
}

export interface HoneypotBite {
  ts: string;
  decoyId: string;
  /** Who triggered the bite. */
  vendor: string;
  /** Optional host / instance id. */
  hostId?: string;
  /** What they attempted: e.g. "read-credential", "connect", "download". */
  action: string;
  /** Did they include the canary token? proves consumption. */
  canaryUsed: boolean;
  /** Free-text evidence (truncated). */
  evidence?: string;
}

function ensureDir(repoRoot: string): void {
  const dir = join(repoRoot, AEGIS_DIR);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
}

/** Register a new decoy. Generates a stable id + canary token. */
export function registerDecoy(repoRoot: string, kind: DecoyKind, surface: string, notes?: string): HoneypotDecoy {
  ensureDir(repoRoot);
  const canaryToken = createHash("sha256").update(`${kind}-${surface}-${Date.now()}-${Math.random()}`).digest("hex").slice(0, 24);
  const id = createHash("sha256").update(`${kind}-${surface}`).digest("hex").slice(0, 16);
  const decoy: HoneypotDecoy = {
    id, kind, surface, canaryToken, createdAt: new Date().toISOString(), notes,
  };
  appendFileSync(join(repoRoot, DECOYS_PATH), JSON.stringify(decoy) + "\n", "utf8");
  return decoy;
}

/** Record a bite. Always idempotent on (decoyId, ts) -- we never
 *  drop a bite, but the analyzer can dedup if needed. */
export function recordBite(repoRoot: string, bite: Omit<HoneypotBite, "ts"> & { ts?: string }): HoneypotBite {
  ensureDir(repoRoot);
  const full: HoneypotBite = { ts: bite.ts ?? new Date().toISOString(), ...bite } as HoneypotBite;
  appendFileSync(join(repoRoot, BITES_PATH), JSON.stringify(full) + "\n", "utf8");
  return full;
}

export function listDecoys(repoRoot: string): HoneypotDecoy[] {
  const p = join(repoRoot, DECOYS_PATH);
  if (!existsSync(p)) return [];
  const out: HoneypotDecoy[] = [];
  for (const line of readFileSync(p, "utf8").split("\n")) {
    if (!line.trim()) continue;
    try { out.push(JSON.parse(line) as HoneypotDecoy); } catch { /* */ }
  }
  return out;
}

export function listBites(repoRoot: string): HoneypotBite[] {
  const p = join(repoRoot, BITES_PATH);
  if (!existsSync(p)) return [];
  const out: HoneypotBite[] = [];
  for (const line of readFileSync(p, "utf8").split("\n")) {
    if (!line.trim()) continue;
    try { out.push(JSON.parse(line) as HoneypotBite); } catch { /* */ }
  }
  return out;
}

export interface NexusReport {
  decoysActive: number;
  totalBites: number;
  /** Bites in last 24h. */
  recentBites: number;
  topVendor: string | null;
  topAction: string | null;
  /** Plain-English. */
  headline: string;
}

export function nexusReport(repoRoot: string): NexusReport {
  const decoys = listDecoys(repoRoot);
  const bites = listBites(repoRoot);
  const cutoff = Date.now() - 24 * 3600 * 1000;
  let recent = 0;
  const byVendor = new Map<string, number>();
  const byAction = new Map<string, number>();
  for (const b of bites) {
    if (Date.parse(b.ts) >= cutoff) recent += 1;
    byVendor.set(b.vendor, (byVendor.get(b.vendor) ?? 0) + 1);
    byAction.set(b.action, (byAction.get(b.action) ?? 0) + 1);
  }
  const topVendor = [...byVendor.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;
  const topAction = [...byAction.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;
  const headline = bites.length === 0
    ? `${decoys.length} decoy(s) active; no bites yet.`
    : `${recent} bite(s) in last 24h (lifetime ${bites.length}); top vendor ${topVendor}, top action ${topAction}.`;
  return { decoysActive: decoys.length, totalBites: bites.length, recentBites: recent, topVendor, topAction, headline };
}

/** Seed a default decoy set on cold repos. Safe to call every startup;
 *  idempotent on surface uniqueness. */
export function seedDefaultDecoys(repoRoot: string): number {
  const existing = listDecoys(repoRoot).map((d) => d.surface);
  const defaults: Array<{ kind: DecoyKind; surface: string; notes: string }> = [
    { kind: "fake-credential", surface: ".mneme/aegis-decoy-creds.env", notes: "Honeypot file -- access logged." },
    { kind: "fake-next-host", surface: "https://internal-mneme-replica.invalid/next", notes: "Decoy SSRF target." },
    { kind: "fake-vaccine-bundle", surface: "https://internal-mneme-replica.invalid/vaccines.tar", notes: "Decoy bundle download." },
    { kind: "fake-replica-target", surface: "ssh://mneme-decoy.invalid:22", notes: "Decoy replica endpoint." },
  ];
  let added = 0;
  for (const d of defaults) {
    if (existing.includes(d.surface)) continue;
    registerDecoy(repoRoot, d.kind, d.surface, d.notes);
    added += 1;
  }
  return added;
}
