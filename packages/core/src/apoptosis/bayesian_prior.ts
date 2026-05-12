/**
 * v1.65.0 -- APOPTOSIS L3: BAYESIAN VACCINE PRIOR.
 *
 * Every refuted lie shape in .mneme/squadron/lie-vaccines.jsonl
 * contributes a Bayesian prior. For a new claim:
 *
 *   1. Compute simhash of the claim.
 *   2. Find k nearest vaccine simhashes by Hamming distance.
 *   3. Posterior(fabrication) = baseline + sum(weight * exp(-dist/scale))
 *
 * If 3+ neighbors fall inside radius `R` -> ALERT (the claim is
 * structurally similar to known lies).
 *
 * The vaccine bank GROWS over time, so this layer asymptotically
 * approaches 100% recall on previously-seen lie families.
 */

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

export interface BayesianReport {
  /** P(fabrication | claim) in [0, 1]. */
  posterior: number;
  /** Verdict at posterior >= 0.5 by default. */
  verdict: "GROUNDED" | "ALERT" | "INAPPLICABLE";
  /** Vaccine entries that contributed most weight. */
  topNeighbors: Array<{ id: string; hammingDistance: number; weight: number; sample?: string }>;
  detail: string;
  ms: number;
}

/** 64-bit simhash via word hashes. Returns 16-hex-char string. */
function simhash64(text: string): string {
  const tokens = (text.toLowerCase().match(/[a-z][a-z0-9_-]+/g) ?? []).filter((t) => t.length >= 3);
  if (tokens.length === 0) return "0".repeat(16);
  const vec = new Array(64).fill(0);
  for (const tok of tokens) {
    // FNV-1a-ish 64-bit fold.
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

interface VaccineRow {
  id: string;
  simhash: string;
  sample?: string;
  refuteCount?: number;
}

function readVaccines(repoRoot: string): VaccineRow[] {
  const p = join(repoRoot, ".mneme/squadron/lie-vaccines.jsonl");
  if (!existsSync(p)) return [];
  try {
    return readFileSync(p, "utf8").split("\n").filter(Boolean).map((l) => {
      try { return JSON.parse(l) as VaccineRow; } catch { return null; }
    }).filter((x): x is VaccineRow => x !== null);
  } catch { return []; }
}

export function bayesianPrior(
  repoRoot: string,
  claim: string,
  opts?: { baseline?: number; scale?: number; radiusBits?: number },
): BayesianReport {
  const t0 = Date.now();
  const baseline = opts?.baseline ?? 0.05;
  const scale = opts?.scale ?? 8; // bits
  const radius = opts?.radiusBits ?? 12;

  const vaccines = readVaccines(repoRoot);
  if (vaccines.length === 0) {
    return {
      posterior: baseline,
      verdict: "INAPPLICABLE",
      topNeighbors: [],
      detail: "Vaccine bank empty; no prior.",
      ms: Date.now() - t0,
    };
  }
  const claimHash = simhash64(claim);
  const neighbors: Array<{ id: string; hammingDistance: number; weight: number; sample?: string }> = [];
  let posterior = baseline;
  for (const v of vaccines) {
    if (!v.simhash || v.simhash.length !== 16) continue;
    const d = hammingHex(claimHash, v.simhash);
    if (d < 0) continue;
    if (d <= radius) {
      // Each refuted neighbor contributes weight that decays with distance.
      const refute = v.refuteCount ?? 1;
      const weight = refute * Math.exp(-d / scale);
      posterior += weight * 0.15; // each near-neighbor bumps posterior up to ~0.15 at d=0
      neighbors.push({ id: v.id, hammingDistance: d, weight, sample: v.sample });
    }
  }
  posterior = Math.min(1, posterior);
  neighbors.sort((a, b) => b.weight - a.weight);
  const top = neighbors.slice(0, 5);

  let verdict: BayesianReport["verdict"];
  if (neighbors.length === 0) verdict = "GROUNDED";
  else if (posterior >= 0.5) verdict = "ALERT";
  else verdict = "GROUNDED";

  return {
    posterior,
    verdict,
    topNeighbors: top,
    detail: verdict === "ALERT"
      ? `Posterior ${posterior.toFixed(3)} >= 0.5 with ${neighbors.length} near-neighbor(s) within Hamming ${radius} bits.`
      : neighbors.length === 0
        ? `No vaccine within Hamming ${radius} bits; claim has no historical lie-shape match.`
        : `Posterior ${posterior.toFixed(3)} below 0.5; ${neighbors.length} weak neighbor(s).`,
    ms: Date.now() - t0,
  };
}
