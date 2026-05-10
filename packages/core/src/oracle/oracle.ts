/**
 * MNEME ORACLE -- main API. Persistence + algorithm orchestration.
 *
 * On-disk layout (under repoRoot):
 *
 *   .mneme/oracle/observations.jsonl   append-only event log
 *   .mneme/oracle/pheromones.json      ACO state
 *   .mneme/oracle/cache.jsonl          pre-computed predictions w/ TTL
 *   .mneme/oracle/stats.json           aggregate stats (hit-rate etc.)
 *
 * The bigram model is rebuilt from observations.jsonl on demand (cheap
 * for <5000 obs). We don't persist it -- stale-window calc is cleaner
 * when always derived.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync, appendFileSync } from "node:fs";
import { join } from "node:path";
import { createHash } from "node:crypto";

import type {
  OracleObservation, OraclePrediction, OracleStats, OracleConfig, PheromoneEdge,
} from "./types.js";
import { DEFAULT_ORACLE_CONFIG } from "./types.js";
import { buildBigrams, transitionProbabilities, uniqueTools } from "./markov.js";
import { evaporate, reinforce, pheromoneScores, tauOf } from "./pheromone.js";

const DIR = ".mneme/oracle";
const OBSERVATIONS_FILE = "observations.jsonl";
const PHEROMONES_FILE = "pheromones.json";
const CACHE_FILE = "cache.jsonl";
const STATS_FILE = "stats.json";

interface PersistedState {
  pheromones: PheromoneEdge[];
  predictions: OraclePrediction[];
  meta: {
    dreamCycles: number;
    hits: number;
    predictionsTotal: number;
    lastDreamAt: string | null;
  };
}

function ensureDir(repoRoot: string): void {
  const d = join(repoRoot, DIR);
  if (!existsSync(d)) mkdirSync(d, { recursive: true });
}

function pathOf(repoRoot: string, file: string): string {
  return join(repoRoot, DIR, file);
}

// ─── persistence ────────────────────────────────────────────────────────

function readObservations(repoRoot: string): OracleObservation[] {
  const p = pathOf(repoRoot, OBSERVATIONS_FILE);
  if (!existsSync(p)) return [];
  try {
    return readFileSync(p, "utf8")
      .trim().split("\n").filter(Boolean)
      .map((ln) => { try { return JSON.parse(ln) as OracleObservation; } catch { return null; } })
      .filter((o): o is OracleObservation => o !== null);
  } catch {
    return [];
  }
}

function readPheromones(repoRoot: string): PheromoneEdge[] {
  const p = pathOf(repoRoot, PHEROMONES_FILE);
  if (!existsSync(p)) return [];
  try {
    const raw = JSON.parse(readFileSync(p, "utf8")) as { edges?: PheromoneEdge[] };
    return Array.isArray(raw.edges) ? raw.edges : [];
  } catch {
    return [];
  }
}

function writePheromones(repoRoot: string, edges: PheromoneEdge[]): void {
  try {
    ensureDir(repoRoot);
    writeFileSync(pathOf(repoRoot, PHEROMONES_FILE), JSON.stringify({ edges }, null, 2), "utf8");
  } catch { /* best-effort */ }
}

function readPredictions(repoRoot: string): OraclePrediction[] {
  const p = pathOf(repoRoot, CACHE_FILE);
  if (!existsSync(p)) return [];
  try {
    return readFileSync(p, "utf8")
      .trim().split("\n").filter(Boolean)
      .map((ln) => { try { return JSON.parse(ln) as OraclePrediction; } catch { return null; } })
      .filter((p): p is OraclePrediction => p !== null);
  } catch {
    return [];
  }
}

function writePredictions(repoRoot: string, predictions: OraclePrediction[]): void {
  try {
    ensureDir(repoRoot);
    writeFileSync(
      pathOf(repoRoot, CACHE_FILE),
      predictions.length === 0 ? "" : predictions.map((p) => JSON.stringify(p)).join("\n") + "\n",
      "utf8",
    );
  } catch { /* best-effort */ }
}

interface MetaCounters {
  dreamCycles: number;
  hits: number;
  predictionsTotal: number;
  lastDreamAt: string | null;
}

function readMeta(repoRoot: string): MetaCounters {
  const p = pathOf(repoRoot, STATS_FILE);
  if (!existsSync(p)) return { dreamCycles: 0, hits: 0, predictionsTotal: 0, lastDreamAt: null };
  try {
    return JSON.parse(readFileSync(p, "utf8")) as MetaCounters;
  } catch {
    return { dreamCycles: 0, hits: 0, predictionsTotal: 0, lastDreamAt: null };
  }
}

function writeMeta(repoRoot: string, meta: MetaCounters): void {
  try {
    ensureDir(repoRoot);
    writeFileSync(pathOf(repoRoot, STATS_FILE), JSON.stringify(meta, null, 2), "utf8");
  } catch { /* best-effort */ }
}

// ─── public API ─────────────────────────────────────────────────────────

/**
 * Record a tool call observation. Append-only. Trims to maxObservations
 * (FIFO drop). Also reinforces the pheromone edge (prev -> tool) when a
 * predecessor exists.
 *
 * Returns the observation that was written.
 */
export function recordObservation(
  repoRoot: string,
  tool: string,
  argKeys: string[] = [],
  config: Partial<OracleConfig> = {},
  ts?: string,
): OracleObservation {
  const cfg = { ...DEFAULT_ORACLE_CONFIG, ...config };
  const obs: OracleObservation = { at: ts ?? new Date().toISOString(), tool, argKeys };
  try {
    ensureDir(repoRoot);
    appendFileSync(pathOf(repoRoot, OBSERVATIONS_FILE), JSON.stringify(obs) + "\n", "utf8");
    // Trim to cap (rare path; only when over-cap).
    const all = readObservations(repoRoot);
    if (all.length > cfg.maxObservations) {
      const trimmed = all.slice(-cfg.maxObservations);
      writeFileSync(
        pathOf(repoRoot, OBSERVATIONS_FILE),
        trimmed.map((o) => JSON.stringify(o)).join("\n") + "\n",
        "utf8",
      );
    }
    // Pheromone reinforcement on the (prev, this) edge.
    if (all.length >= 2) {
      const prev = all[all.length - 2]!;
      const dt = Date.parse(obs.at) - Date.parse(prev.at);
      if (Number.isFinite(dt) && dt >= 0 && dt <= 30 * 60 * 1000) {
        const table = readPheromones(repoRoot);
        const next = reinforce(table, prev.tool, tool, cfg.reinforcement);
        writePheromones(repoRoot, next);
      }
    }
    // Prediction hit detection: if any FRESH prediction had this tool
    // as the predicted next, mark hit + bump meta.
    const preds = readPredictions(repoRoot);
    const now = Date.now();
    let hits = 0;
    const next = preds.map((p) => {
      const fresh = Date.parse(p.expiresAt) > now;
      if (fresh && !p.hit && p.toTool === tool) {
        hits++;
        return { ...p, hit: true };
      }
      return p;
    });
    if (hits > 0) {
      writePredictions(repoRoot, next);
      const meta = readMeta(repoRoot);
      meta.hits += hits;
      writeMeta(repoRoot, meta);
    }
  } catch { /* best-effort */ }
  return obs;
}

/**
 * Top-K predictions for what the AI will call next given current state.
 * Score = alpha * P_markov(j|i) + beta * P_pheromone(j|i).
 *
 * Falls back to:
 *   - pheromone-only when no Markov data
 *   - empty array when neither has anything for `fromTool`
 */
export function predictNext(
  repoRoot: string,
  fromTool: string,
  k = 3,
  config: Partial<OracleConfig> = {},
): Array<{ tool: string; confidence: number; pMarkov: number; pPheromone: number; tau: number }> {
  const cfg = { ...DEFAULT_ORACLE_CONFIG, ...config };
  const observations = readObservations(repoRoot);
  const bigrams = buildBigrams(observations);
  const markov = transitionProbabilities(bigrams, fromTool);
  const phero = pheromoneScores(readPheromones(repoRoot), fromTool);
  const candidateTools = new Set<string>([
    ...markov.map((m) => m.next),
    ...phero.map((p) => p.next),
  ]);
  if (candidateTools.size === 0) return [];
  const scored = Array.from(candidateTools).map((tool) => {
    const m = markov.find((x) => x.next === tool);
    const p = phero.find((x) => x.next === tool);
    const pm = m ? m.p : 0;
    const pp = p ? p.score : 0;
    const confidence = cfg.alpha * pm + cfg.beta * pp;
    return {
      tool, confidence,
      pMarkov: pm,
      pPheromone: pp,
      tau: tauOf(readPheromones(repoRoot), fromTool, tool),
    };
  });
  return scored.sort((a, b) => b.confidence - a.confidence).slice(0, k);
}

/**
 * Run one DREAM CYCLE. Three things happen:
 *
 *   1. Evaporate every pheromone edge by rho (the "forgetting" pass).
 *   2. From the most-recent observed tool (current state), predict
 *      top-K next tools, store them as fresh predictions in the cache.
 *   3. Drop expired predictions from the cache.
 *
 * The daemon calls this on idle ticks. CLI users can call it manually
 * via `mneme oracle dream`.
 *
 * Returns what we stored.
 */
export function dreamCycle(
  repoRoot: string,
  config: Partial<OracleConfig> = {},
): { evaporatedEdges: number; predictions: OraclePrediction[] } {
  const cfg = { ...DEFAULT_ORACLE_CONFIG, ...config };
  const meta = readMeta(repoRoot);

  // 1. Evaporate.
  const before = readPheromones(repoRoot);
  const after = evaporate(before, cfg.rho);
  writePheromones(repoRoot, after);

  // 2. Predict from current state.
  const obs = readObservations(repoRoot);
  const currentState = obs.length > 0 ? obs[obs.length - 1]!.tool : null;
  const newPreds: OraclePrediction[] = [];
  if (currentState) {
    const top = predictNext(repoRoot, currentState, 3, cfg);
    const predictedAt = new Date().toISOString();
    const expiresAt = new Date(Date.now() + cfg.predictionTtlMs).toISOString();
    for (const p of top) {
      if (p.confidence < 0.01) continue; // skip near-zero noise
      const id = createHash("sha256")
        .update(currentState).update(p.tool).update(predictedAt)
        .digest("hex").slice(0, 16);
      newPreds.push({
        id, fromTool: currentState, toTool: p.tool,
        confidence: p.confidence, predictedAt, expiresAt, hit: false,
      });
    }
  }

  // 3. Drop expired + merge new.
  const now = Date.now();
  const old = readPredictions(repoRoot).filter((p) => Date.parse(p.expiresAt) > now);
  writePredictions(repoRoot, [...old, ...newPreds]);

  meta.dreamCycles++;
  meta.predictionsTotal += newPreds.length;
  meta.lastDreamAt = new Date().toISOString();
  writeMeta(repoRoot, meta);

  return { evaporatedEdges: before.length - after.length, predictions: newPreds };
}

/** Read-only snapshot of every cached prediction (fresh + expired). */
export function peekCache(repoRoot: string): OraclePrediction[] {
  return readPredictions(repoRoot);
}

/** Aggregate stats. */
export function oracleStats(repoRoot: string): OracleStats {
  const obs = readObservations(repoRoot);
  const bigrams = buildBigrams(obs);
  const phero = readPheromones(repoRoot);
  const preds = readPredictions(repoRoot);
  const meta = readMeta(repoRoot);
  const tools = uniqueTools(obs);
  return {
    totalObservations: obs.length,
    uniqueTools: tools.length,
    bigramCount: bigrams.length,
    pheromoneEdges: phero.length,
    predictions: preds.length,
    hits: meta.hits,
    hitRate: meta.predictionsTotal > 0 ? meta.hits / meta.predictionsTotal : 0,
    dreamCycles: meta.dreamCycles,
    currentState: obs.length > 0 ? obs[obs.length - 1]!.tool : null,
    lastObservationAt: obs.length > 0 ? obs[obs.length - 1]!.at : null,
    lastDreamAt: meta.lastDreamAt,
  };
}

/** Wipe all Oracle state (for tests + the `mneme oracle reset` CLI). */
export function resetOracle(repoRoot: string): void {
  for (const f of [OBSERVATIONS_FILE, PHEROMONES_FILE, CACHE_FILE, STATS_FILE]) {
    const p = pathOf(repoRoot, f);
    if (existsSync(p)) {
      try { writeFileSync(p, ""); } catch { /* */ }
    }
  }
}

/**
 * v1.26.6 -- chicken-and-egg breaker. Plant a synthetic observation
 * trail that mirrors realistic Mneme MCP usage patterns, then run a
 * dream cycle. After this, `mneme precog peek` / `predict` / `hint`
 * all show populated state -- demoable without needing a live MCP
 * connection.
 *
 * The seeded sequence is deliberately MNEME-shaped (not random):
 *   capabilities -> who_knows -> passport -> story
 *   capabilities -> blast -> palimpsest
 *   capabilities -> antivirus.scan -> antivirus.bench
 *   nucleus.tick -> selfcheck.run -> evolve.scan
 * Repeat 5x with a few cross-bridges so bigram + pheromone both
 * carry signal.
 *
 * Returns the count of observations + dream cycles produced.
 */
export function seedDemoOracle(repoRoot: string): { observations: number; dreamCycles: number } {
  resetOracle(repoRoot);

  const sequences: string[][] = [
    ["mneme.capabilities", "mneme.who_knows", "mneme.passport", "mneme.story"],
    ["mneme.capabilities", "mneme.blast", "mneme.palimpsest"],
    ["mneme.capabilities", "mneme.antivirus.scan", "mneme.antivirus.cert.benchmark"],
    ["mneme.nucleus.tick", "mneme.selfcheck.run", "mneme.evolve.scan"],
    ["mneme.who_knows", "mneme.passport", "mneme.confess"],
    ["mneme.dna.search", "mneme.confess"],
    ["mneme.smart_do", "mneme.dna.search", "mneme.confess"],
    ["mneme.help", "mneme.tool.contract", "mneme.smart_do"],
  ];

  // Spread observations across the past hour so bigrams form within
  // the default 30-min session window.
  let baseTime = Date.now() - 30 * 60 * 1000;
  let n = 0;
  for (let cycle = 0; cycle < 5; cycle++) {
    for (const seq of sequences) {
      for (const tool of seq) {
        const ts = new Date(baseTime).toISOString();
        recordObservation(repoRoot, tool, [], {}, ts);
        baseTime += 5_000; // 5s between successive calls in a session
        n++;
      }
      baseTime += 60_000; // 1-min gap between sessions
    }
  }

  // Run two dream cycles so the cache populates with predictions.
  const c1 = dreamCycle(repoRoot);
  const c2 = dreamCycle(repoRoot);
  void c1; void c2;

  return { observations: n, dreamCycles: 2 };
}

/**
 * Render a 1-3 line "Oracle hint" for inclusion in the pulse, when the
 * current top prediction has confidence >= minConfidenceForHint.
 *
 * Returns "" when nothing's worth showing (so the hint doesn't bloat
 * the pulse output on cold-start or low-signal turns).
 */
export function renderOracleHint(
  repoRoot: string,
  config: Partial<OracleConfig> = {},
): string {
  const cfg = { ...DEFAULT_ORACLE_CONFIG, ...config };
  const obs = readObservations(repoRoot);
  if (obs.length === 0) return "";
  const currentState = obs[obs.length - 1]!.tool;
  const top = predictNext(repoRoot, currentState, 3, cfg);
  if (top.length === 0 || top[0]!.confidence < cfg.minConfidenceForHint) return "";
  const lines: string[] = [];
  lines.push(`[PRECOG] After ${currentState} you usually call:`);
  for (const t of top.slice(0, 3)) {
    if (t.confidence < 0.05) continue;
    lines.push(`  -> ${t.tool}  (${(t.confidence * 100).toFixed(0)}%, markov=${(t.pMarkov * 100).toFixed(0)}% phero=${t.tau.toFixed(2)})`);
  }
  return lines.join("\n");
}
