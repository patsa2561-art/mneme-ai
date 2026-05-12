/**
 * v1.70.0 -- PRECOG P6: BAYESIAN REPO PRIORS.
 *
 * Per-repo memory of which claim shapes have hallucinated in the
 * past. The simhash of every failed claim is recorded; a new claim's
 * Bayesian prior is shifted by similarity to past failures.
 *
 *   P(fab | claim) =
 *     base_prior * (1 + sum(weight_i * exp(-hamming(claim, fail_i) / scale)))
 *
 * The repo learns. After 20 failures the model has a strong prior
 * against re-occurring lie shapes.
 */

import { existsSync, readFileSync, writeFileSync, mkdirSync, appendFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { join } from "node:path";

const PRECOG_DIR = ".mneme/precog";
const FAILURES_FILE = ".mneme/precog/failure-priors.jsonl";

export interface FailureRecord {
  /** simhash hex (16 chars). */
  simhash: string;
  /** Plain-English kind label (npm-package / sha / temporal / general). */
  kind: string;
  /** When recorded. */
  ts: string;
  /** Truncated original. */
  sample?: string;
  /** How many times this shape has hallucinated. */
  weight: number;
}

function simhash64(text: string): string {
  const tokens = (text.toLowerCase().match(/[a-z][a-z0-9_-]+/g) ?? []).filter((t) => t.length >= 3);
  if (tokens.length === 0) return "0".repeat(16);
  const vec = new Array(64).fill(0);
  for (const tok of tokens) {
    let h = 0xcbf29ce484222325n;
    for (let i = 0; i < tok.length; i++) {
      h ^= BigInt(tok.charCodeAt(i));
      h = (h * 0x100000001b3n) & 0xffffffffffffffffn;
    }
    for (let b = 0; b < 64; b++) {
      const bit = (h >> BigInt(b)) & 1n;
      vec[b] += bit === 1n ? 1 : -1;
    }
  }
  let out = 0n;
  for (let b = 0; b < 64; b++) {
    if (vec[b] > 0) out |= 1n << BigInt(b);
  }
  return out.toString(16).padStart(16, "0");
}

function hammingHex(a: string, b: string): number {
  if (a.length !== b.length) return -1;
  let d = 0;
  for (let i = 0; i < a.length; i++) {
    let x = parseInt(a[i]!, 16) ^ parseInt(b[i]!, 16);
    while (x) { d += x & 1; x >>>= 1; }
  }
  return d;
}

function readFailures(repoRoot: string): FailureRecord[] {
  const p = join(repoRoot, FAILURES_FILE);
  if (!existsSync(p)) return [];
  const out: FailureRecord[] = [];
  try {
    for (const line of readFileSync(p, "utf8").split("\n")) {
      if (!line.trim()) continue;
      try { out.push(JSON.parse(line) as FailureRecord); } catch { /* */ }
    }
  } catch { /* */ }
  // Coalesce by simhash + kind (sum weights).
  const map = new Map<string, FailureRecord>();
  for (const r of out) {
    const key = `${r.kind}|${r.simhash}`;
    const prior = map.get(key);
    if (prior) prior.weight += r.weight;
    else map.set(key, { ...r });
  }
  return [...map.values()];
}

/** Record a new hallucination event. Each call adds 1 to the
 *  shape's weight (coalesced on read). */
export function recordFailure(repoRoot: string, claim: string, kind: string, sample?: string): FailureRecord {
  const dir = join(repoRoot, PRECOG_DIR);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  const rec: FailureRecord = {
    simhash: simhash64(claim),
    kind,
    ts: new Date().toISOString(),
    sample: sample?.slice(0, 200) ?? claim.slice(0, 200),
    weight: 1,
  };
  try { appendFileSync(join(repoRoot, FAILURES_FILE), JSON.stringify(rec) + "\n", "utf8"); } catch { /* */ }
  return rec;
}

export interface PriorReport {
  basePrior: number;
  posterior: number;
  /** Top contributing past failures. */
  topNeighbors: Array<{ kind: string; hamming: number; weight: number; sample?: string }>;
  /** Plain-English. */
  detail: string;
}

/** Compute P(fabrication | claim) using the repo's failure history. */
export function priorFor(repoRoot: string, claim: string, opts?: { basePrior?: number; scale?: number; radius?: number }): PriorReport {
  const basePrior = opts?.basePrior ?? 0.05;
  const scale = opts?.scale ?? 8;
  const radius = opts?.radius ?? 16;
  const failures = readFailures(repoRoot);
  if (failures.length === 0) {
    return { basePrior, posterior: basePrior, topNeighbors: [], detail: "Empty failure history; base prior used." };
  }
  const claimHash = simhash64(claim);
  let bump = 0;
  const neighbors: Array<{ kind: string; hamming: number; weight: number; sample?: string }> = [];
  for (const f of failures) {
    const d = hammingHex(claimHash, f.simhash);
    if (d < 0 || d > radius) continue;
    const contribution = f.weight * Math.exp(-d / scale);
    bump += contribution * 0.1;
    neighbors.push({ kind: f.kind, hamming: d, weight: f.weight, sample: f.sample });
  }
  const posterior = Math.min(1, basePrior + bump);
  neighbors.sort((a, b) => a.hamming - b.hamming);
  return {
    basePrior,
    posterior,
    topNeighbors: neighbors.slice(0, 5),
    detail: neighbors.length === 0
      ? `No near-neighbor failures in repo history (within Hamming ${radius}).`
      : `Posterior ${posterior.toFixed(3)} from ${neighbors.length} near-neighbor failure(s).`,
  };
}

export function readFailureHistory(repoRoot: string): FailureRecord[] {
  return readFailures(repoRoot);
}
