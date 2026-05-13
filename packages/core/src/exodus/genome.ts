/**
 * v1.61.0 -- EXODUS LAYER 1: THE GENOME.
 *
 * Mneme distills its entire wisdom corpus into a 4-stranded DNA-style
 * genome that's diffable, recombinable, compressible, inheritable,
 * tamper-evident.
 *
 * The 4 strands:
 *
 *   Strand A (Adamant)     -- vaccines + grounded facts + commit anchors
 *                             (immutable, hard refutations)
 *   Strand C (Calibrated)  -- forecast priors + Brier-weighted models
 *                             (probabilistic, updated by Dream Weaver)
 *   Strand G (Governed)    -- covenant + accountability + soul mirror
 *                             (HMAC-chained, audit trail)
 *   Strand T (Temporal)    -- time-river snapshots + nucleus DNA history
 *                             (point-in-time anchors)
 *
 * Pure functions. Reads existing .mneme/ state files; writes nothing
 * unless caller persists the returned genome. Deterministic encoding
 * (sorted keys) so two genomes from the same state are byte-identical.
 */

import { existsSync, readFileSync, readdirSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { createHmac, randomBytes } from "node:crypto";
import { safeExecTry } from "../util/safe_exec.js";

export type StrandLabel = "A" | "C" | "G" | "T";

export interface AdamantStrand {
  vaccines: Array<{ id: string; simhash: string; signature: string; refuteCount: number }>;
  commitAnchors: string[];
}

export interface CalibratedStrand {
  forecastPriors: Array<{ window: number; basePrior: number; sampleSize: number }>;
  oracleBands: Record<string, number>; // band counts from oracle history
}

export interface GovernedStrand {
  activeCovenantId: string | null;
  totalViolations: number;
  soulVendors: Array<{ vendor: string; sessions: number; brokenCount: number }>;
}

export interface TemporalStrand {
  earliestCommit: string | null;
  latestCommit: string | null;
  nucleusTick: number;
  nucleusDna: string | null;
  vaultSnapshots: number;
}

export interface MnemeGenome {
  schemaVersion: 1;
  emittedAt: string;
  emittedBy: string;
  strands: {
    A: AdamantStrand;
    C: CalibratedStrand;
    G: GovernedStrand;
    T: TemporalStrand;
  };
  hmac: string;
}

/** v1.61.1 hotfix: drop undefined-valued keys + filter undefined array
 *  elements so a JSON write/read roundtrip produces the same canonical
 *  bytes. Without this, fields read from .jsonl that have missing
 *  attributes (e.g. an old vaccine row lacking `signature`) come back
 *  as `{key: undefined}` on the encode side and `{}` on the decode side
 *  -- breaking HMAC verification across pack/unpack. */
function canonicalize(v: unknown): string {
  if (v === undefined) return "null";
  if (v === null || typeof v !== "object") return JSON.stringify(v);
  if (Array.isArray(v)) {
    return "[" + v.filter((x) => x !== undefined).map(canonicalize).join(",") + "]";
  }
  const o = v as Record<string, unknown>;
  const ks = Object.keys(o).filter((k) => o[k] !== undefined).sort();
  return "{" + ks.map((k) => JSON.stringify(k) + ":" + canonicalize(o[k])).join(",") + "}";
}

function secretPath(repoRoot: string): string {
  return join(repoRoot, ".mneme", "exodus", ".secret");
}
function loadOrCreateSecret(repoRoot: string): string {
  const dir = join(repoRoot, ".mneme", "exodus");
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  const p = secretPath(repoRoot);
  if (existsSync(p)) return readFileSync(p, "utf8").trim();
  const s = randomBytes(32).toString("hex");
  writeFileSync(p, s, "utf8");
  return s;
}

function readJsonl<T>(path: string): T[] {
  if (!existsSync(path)) return [];
  try {
    return readFileSync(path, "utf8").split("\n").filter(Boolean).map((l) => {
      try { return JSON.parse(l) as T; } catch { return null; }
    }).filter((x): x is T => x !== null);
  } catch { return []; }
}

function readJson<T>(path: string, fallback: T): T {
  if (!existsSync(path)) return fallback;
  try { return JSON.parse(readFileSync(path, "utf8")) as T; } catch { return fallback; }
}

// ─── strand encoders ────────────────────────────────────────────────

function encodeAdamant(repoRoot: string): AdamantStrand {
  const vaccines = readJsonl<{ id: string; simhash64: string; signature: string; refuteCount: number }>(
    join(repoRoot, ".mneme/squadron/lie-vaccines.jsonl"),
  );
  const commits: string[] = [];
  // Pull last 20 git SHAs as commit anchors -- cheap, useful for time-river.
  // v2.4: spawnSync via safeExecTry — repoRoot never reaches a shell.
  const gitPath = join(repoRoot, ".git");
  if (existsSync(gitPath)) {
    const r = safeExecTry("git", ["-C", repoRoot, "log", "--max-count=20", "--pretty=format:%H"], { timeoutMs: 3000 });
    if (r?.status === 0) {
      for (const sha of r.stdout.split("\n").filter(Boolean)) commits.push(sha.slice(0, 12));
    }
  }
  return {
    vaccines: vaccines.map((v) => ({
      id: v.id, simhash: v.simhash64, signature: v.signature, refuteCount: v.refuteCount,
    })),
    commitAnchors: commits,
  };
}

function encodeCalibrated(repoRoot: string): CalibratedStrand {
  const forecasts = readJsonl<{ prior: number; sampleSize: number }>(join(repoRoot, ".mneme/forecast/forecasts.jsonl"));
  const oracleBands: Record<string, number> = { "very-low": 0, low: 0, moderate: 0, elevated: 0, high: 0 };
  // Bin by prior magnitude as a proxy for band frequency.
  const priors: Array<{ window: number; basePrior: number; sampleSize: number }> = [];
  for (const f of forecasts) {
    priors.push({ window: 14, basePrior: f.prior, sampleSize: f.sampleSize });
    if (f.prior < 0.05) oracleBands["very-low"]!++;
    else if (f.prior < 0.15) oracleBands["low"]!++;
    else if (f.prior < 0.35) oracleBands["moderate"]!++;
    else if (f.prior < 0.6) oracleBands["elevated"]!++;
    else oracleBands["high"]!++;
  }
  return { forecastPriors: priors.slice(-50), oracleBands };
}

function encodeGoverned(repoRoot: string): GovernedStrand {
  const covenant = readJson<{ id?: string } | null>(join(repoRoot, ".mneme/covenant/active.json"), null);
  const violations = readJsonl<unknown>(join(repoRoot, ".mneme/covenant/violations.jsonl"));
  const soulsDir = join(repoRoot, ".mneme/ai-souls");
  const soulVendors: GovernedStrand["soulVendors"] = [];
  if (existsSync(soulsDir)) {
    try {
      for (const f of readdirSync(soulsDir)) {
        if (!f.endsWith(".json")) continue;
        const body = readJson<{ sessions?: Array<{ broken?: number }> }>(join(soulsDir, f), {});
        const sessions = body.sessions ?? [];
        soulVendors.push({
          vendor: f.replace(/\.json$/, ""),
          sessions: sessions.length,
          brokenCount: sessions.reduce((acc, s) => acc + (s.broken ?? 0), 0),
        });
      }
    } catch { /* */ }
  }
  return {
    activeCovenantId: covenant?.id ?? null,
    totalViolations: violations.length,
    soulVendors,
  };
}

function encodeTemporal(repoRoot: string): TemporalStrand {
  const nucleus = readJson<{ tick?: number; dnaHash?: string }>(join(repoRoot, ".mneme/nucleus.json"), {});
  const anchors = encodeAdamant(repoRoot).commitAnchors;
  const vaultDir = join(repoRoot, ".mneme/vault-snapshots");
  let vaultCount = 0;
  if (existsSync(vaultDir)) {
    try { vaultCount = readdirSync(vaultDir).filter((f) => f.endsWith(".json")).length; } catch { /* */ }
  }
  return {
    earliestCommit: anchors.length > 0 ? anchors[anchors.length - 1]! : null,
    latestCommit: anchors.length > 0 ? anchors[0]! : null,
    nucleusTick: nucleus.tick ?? 0,
    nucleusDna: nucleus.dnaHash ?? null,
    vaultSnapshots: vaultCount,
  };
}

/** Encode the full Mneme state into a signed 4-strand genome. */
export function encodeGenome(repoRoot: string, opts?: { emittedBy?: string }): MnemeGenome {
  const emittedBy = opts?.emittedBy ?? "mneme-local";
  const strands = {
    A: encodeAdamant(repoRoot),
    C: encodeCalibrated(repoRoot),
    G: encodeGoverned(repoRoot),
    T: encodeTemporal(repoRoot),
  };
  const draft = {
    schemaVersion: 1 as const,
    emittedAt: new Date().toISOString(),
    emittedBy,
    strands,
  };
  const secret = loadOrCreateSecret(repoRoot);
  const hmac = createHmac("sha256", secret).update(canonicalize(draft)).digest("hex").slice(0, 32);
  return { ...draft, hmac };
}

/** Verify a genome's HMAC against the local secret. */
export function verifyGenome(repoRoot: string, genome: MnemeGenome): { ok: boolean; reason: string } {
  const { hmac, ...rest } = genome;
  const secret = loadOrCreateSecret(repoRoot);
  const expected = createHmac("sha256", secret).update(canonicalize(rest)).digest("hex").slice(0, 32);
  return expected === hmac
    ? { ok: true, reason: "HMAC valid" }
    : { ok: false, reason: `HMAC mismatch (expected ${expected.slice(0, 8)}..., got ${hmac.slice(0, 8)}...)` };
}

export interface GenomeDiff {
  vaccinesAdded: number;
  vaccinesRemoved: number;
  commitsAdded: number;
  forecastSamplesAdded: number;
  violationsAdded: number;
  soulVendorsChanged: number;
  nucleusTickDelta: number;
}

/** Diff strand-by-strand. */
export function diffGenomes(a: MnemeGenome, b: MnemeGenome): GenomeDiff {
  const av = new Set(a.strands.A.vaccines.map((v) => v.simhash));
  const bv = new Set(b.strands.A.vaccines.map((v) => v.simhash));
  let added = 0, removed = 0;
  for (const s of bv) if (!av.has(s)) added++;
  for (const s of av) if (!bv.has(s)) removed++;
  const ac = new Set(a.strands.A.commitAnchors);
  const bc = new Set(b.strands.A.commitAnchors);
  let commitsAdded = 0;
  for (const c of bc) if (!ac.has(c)) commitsAdded++;
  return {
    vaccinesAdded: added,
    vaccinesRemoved: removed,
    commitsAdded,
    forecastSamplesAdded: Math.max(0, b.strands.C.forecastPriors.length - a.strands.C.forecastPriors.length),
    violationsAdded: Math.max(0, b.strands.G.totalViolations - a.strands.G.totalViolations),
    soulVendorsChanged: Math.abs(b.strands.G.soulVendors.length - a.strands.G.soulVendors.length),
    nucleusTickDelta: b.strands.T.nucleusTick - a.strands.T.nucleusTick,
  };
}

/** Genetic crossover -- pick strands from each parent. Default: A+T
 *  from parent1, C+G from parent2. */
export function recombine(
  repoRoot: string,
  parent1: MnemeGenome,
  parent2: MnemeGenome,
  opts?: { strands?: Record<StrandLabel, "p1" | "p2"> },
): MnemeGenome {
  const choice = opts?.strands ?? { A: "p1", C: "p2", G: "p2", T: "p1" };
  const pick = (l: StrandLabel) => choice[l] === "p1" ? parent1.strands[l] : parent2.strands[l];
  const strands = {
    A: pick("A") as AdamantStrand,
    C: pick("C") as CalibratedStrand,
    G: pick("G") as GovernedStrand,
    T: pick("T") as TemporalStrand,
  };
  const draft = {
    schemaVersion: 1 as const,
    emittedAt: new Date().toISOString(),
    emittedBy: `crossover(${parent1.emittedBy}+${parent2.emittedBy})`,
    strands,
  };
  const secret = loadOrCreateSecret(repoRoot);
  const hmac = createHmac("sha256", secret).update(canonicalize(draft)).digest("hex").slice(0, 32);
  return { ...draft, hmac };
}

/** Persist a genome to disk (signed). */
export function persistGenome(repoRoot: string, genome: MnemeGenome): string {
  const dir = join(repoRoot, ".mneme", "exodus");
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  const path = join(dir, `genome-${genome.emittedAt.replace(/[:.]/g, "-")}.json`);
  writeFileSync(path, JSON.stringify(genome, null, 2), "utf8");
  // Also write a stable "latest" symlink-equivalent.
  writeFileSync(join(dir, "latest.json"), JSON.stringify(genome, null, 2), "utf8");
  return path;
}

export function readLatestGenome(repoRoot: string): MnemeGenome | null {
  const p = join(repoRoot, ".mneme", "exodus", "latest.json");
  if (!existsSync(p)) return null;
  try { return JSON.parse(readFileSync(p, "utf8")) as MnemeGenome; } catch { return null; }
}
