import { describe, expect, it, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  buildBigrams, transitionProbabilities, topKMarkov, uniqueTools,
  evaporate, reinforce, pheromoneScores, tauOf,
  recordObservation, predictNext, dreamCycle, peekCache, oracleStats,
  resetOracle, renderOracleHint,
  DEFAULT_ORACLE_CONFIG,
} from "./index.js";
import type { OracleObservation, PheromoneEdge } from "./index.js";

let repo: string;
beforeEach(() => { repo = mkdtempSync(join(tmpdir(), "mneme-oracle-")); });
afterEach(() => { try { rmSync(repo, { recursive: true, force: true }); } catch { /* */ } });

// ─────────────────────────────────────────────────────────────────────────
// MARKOV bigram
// ─────────────────────────────────────────────────────────────────────────
describe("oracle.markov -- bigram model", () => {
  const obs = (tool: string, secondsAgoFromBase: number, baseMs = 1_700_000_000_000): OracleObservation =>
    ({ at: new Date(baseMs + secondsAgoFromBase * 1000).toISOString(), tool, argKeys: [] });

  it("buildBigrams counts adjacent transitions", () => {
    const o = [obs("A", 0), obs("B", 1), obs("C", 2), obs("B", 3), obs("C", 4)];
    const b = buildBigrams(o);
    // (A,B) once, (B,C) twice, (C,B) once
    const ab = b.find((x) => x.prev === "A" && x.next === "B")!;
    const bc = b.find((x) => x.prev === "B" && x.next === "C")!;
    const cb = b.find((x) => x.prev === "C" && x.next === "B")!;
    expect(ab.count).toBe(1);
    expect(bc.count).toBe(2);
    expect(cb.count).toBe(1);
  });

  it("respects sessionGapMs (no bigram across a long gap)", () => {
    // 31-min gap > default 30-min
    const o = [obs("A", 0), obs("B", 31 * 60)];
    expect(buildBigrams(o)).toEqual([]);
  });

  it("transitionProbabilities normalizes per-prev to sum=1", () => {
    const o = [obs("A", 0), obs("B", 1), obs("A", 2), obs("C", 3), obs("A", 4), obs("B", 5)];
    // From A -> B twice, A -> C once: P(B|A)=2/3, P(C|A)=1/3
    const t = transitionProbabilities(buildBigrams(o), "A");
    const total = t.reduce((s, x) => s + x.p, 0);
    expect(Math.abs(total - 1)).toBeLessThan(1e-9);
    expect(t[0]!.next).toBe("B");
    expect(t[0]!.p).toBeCloseTo(2 / 3, 5);
  });

  it("topKMarkov respects K and order", () => {
    const o = [obs("A", 0), obs("B", 1), obs("A", 2), obs("B", 3), obs("A", 4), obs("C", 5)];
    const t = topKMarkov(buildBigrams(o), "A", 1);
    expect(t).toHaveLength(1);
    expect(t[0]!.next).toBe("B");
  });

  it("uniqueTools returns sorted distinct names", () => {
    const o = [obs("Z", 0), obs("A", 1), obs("M", 2), obs("A", 3)];
    expect(uniqueTools(o)).toEqual(["A", "M", "Z"]);
  });

  it("returns [] for unknown predecessor", () => {
    const o = [obs("A", 0), obs("B", 1)];
    expect(transitionProbabilities(buildBigrams(o), "X")).toEqual([]);
  });
});

// ─────────────────────────────────────────────────────────────────────────
// ACO pheromone
// ─────────────────────────────────────────────────────────────────────────
describe("oracle.pheromone -- ACO", () => {
  const edge = (prev: string, next: string, tau: number): PheromoneEdge =>
    ({ prev, next, tau, lastTouched: "" });

  it("evaporate scales every edge by (1-rho)", () => {
    const t = [edge("A", "B", 1.0), edge("A", "C", 2.0)];
    const e = evaporate(t, 0.10);
    expect(e[0]!.tau).toBeCloseTo(0.9, 5);
    expect(e[1]!.tau).toBeCloseTo(1.8, 5);
  });

  it("evaporate drops edges below floor", () => {
    const t = [edge("A", "B", 0.005), edge("A", "C", 1.0)];
    const e = evaporate(t, 0.10, 0.01);
    expect(e).toHaveLength(1);
    expect(e[0]!.next).toBe("C");
  });

  it("evaporate is no-op when rho=0", () => {
    const t = [edge("A", "B", 1.0)];
    expect(evaporate(t, 0)).toEqual(t);
  });

  it("reinforce adds new edge when absent", () => {
    const r = reinforce([], "A", "B", 1.0);
    expect(r).toHaveLength(1);
    expect(r[0]!.tau).toBe(1.0);
  });

  it("reinforce adds to existing edge", () => {
    const start = reinforce([], "A", "B", 1.0);
    const next = reinforce(start, "A", "B", 0.5);
    expect(next).toHaveLength(1);
    expect(next[0]!.tau).toBeCloseTo(1.5, 5);
  });

  it("pheromoneScores normalizes per-prev", () => {
    const t = reinforce(reinforce([], "A", "B", 3), "A", "C", 1);
    const s = pheromoneScores(t, "A");
    const sum = s.reduce((acc, x) => acc + x.score, 0);
    expect(Math.abs(sum - 1)).toBeLessThan(1e-9);
    // B should outrank C
    expect(s[0]!.next).toBe("B");
    expect(s[0]!.score).toBeCloseTo(0.75, 5);
  });

  it("tauOf returns 0 for missing edges", () => {
    expect(tauOf([], "A", "B")).toBe(0);
  });
});

// ─────────────────────────────────────────────────────────────────────────
// End-to-end: record, predict, dream, hit detection
// ─────────────────────────────────────────────────────────────────────────
describe("oracle.oracle -- end to end", () => {
  it("recordObservation appends to log", () => {
    recordObservation(repo, "mneme.who_knows");
    recordObservation(repo, "mneme.passport");
    const s = oracleStats(repo);
    expect(s.totalObservations).toBe(2);
    expect(s.uniqueTools).toBe(2);
  });

  it("recordObservation reinforces pheromone on consecutive observations", () => {
    recordObservation(repo, "A");
    recordObservation(repo, "B");
    recordObservation(repo, "B");      // reinforces no edge (B->B is the new one)
    const s = oracleStats(repo);
    expect(s.pheromoneEdges).toBeGreaterThan(0);
  });

  it("predictNext combines markov + pheromone", () => {
    // Build sequence: A->B 3x, A->C 1x.
    for (const tool of ["A", "B", "A", "B", "A", "B", "A", "C"]) {
      recordObservation(repo, tool);
    }
    const top = predictNext(repo, "A", 3);
    expect(top.length).toBeGreaterThanOrEqual(2);
    expect(top[0]!.tool).toBe("B");          // dominant successor
    expect(top[0]!.confidence).toBeGreaterThan(top[1]!.confidence);
  });

  it("predictNext returns [] for an unknown predecessor", () => {
    expect(predictNext(repo, "never-seen", 3)).toEqual([]);
  });

  it("dreamCycle generates fresh predictions and bumps meta", () => {
    for (const tool of ["A", "B", "A", "B"]) recordObservation(repo, tool);
    const before = oracleStats(repo);
    const r = dreamCycle(repo);
    const after = oracleStats(repo);
    expect(r.predictions.length).toBeGreaterThan(0);
    expect(after.dreamCycles).toBe(before.dreamCycles + 1);
    expect(peekCache(repo).length).toBeGreaterThan(0);
  });

  it("dream cache hit fires when the predicted tool is then observed", () => {
    // End on A so the dream predicts FROM A. The strong A->B pattern means
    // the cached prediction is for B, and observing B confirms the hit.
    for (const tool of ["A", "B", "A", "B", "A"]) recordObservation(repo, tool);
    dreamCycle(repo);
    const cacheBefore = peekCache(repo);
    const predForB = cacheBefore.find((p) => p.fromTool === "A" && p.toTool === "B");
    expect(predForB).toBeDefined();
    // Observing B should mark the prediction hit.
    recordObservation(repo, "B");
    const cacheAfter = peekCache(repo);
    const predHit = cacheAfter.find((p) => p.id === predForB!.id);
    expect(predHit?.hit).toBe(true);
    const stats = oracleStats(repo);
    expect(stats.hits).toBeGreaterThanOrEqual(1);
  });

  it("dream cycle evaporates pheromone edges", () => {
    for (const tool of ["A", "B"]) recordObservation(repo, tool);
    const before = oracleStats(repo).pheromoneEdges;
    expect(before).toBeGreaterThan(0);
    // Run many evaporation cycles -- edge with tau=1 should fall below 0.01 floor.
    for (let i = 0; i < 50; i++) dreamCycle(repo);
    const after = oracleStats(repo).pheromoneEdges;
    expect(after).toBeLessThan(before);
  });

  it("renderOracleHint returns text when confidence high enough", () => {
    // End the sequence on A so the rendered hint reads "After A".
    for (const tool of ["A", "B", "A", "B", "A", "B", "A"]) recordObservation(repo, tool);
    const hint = renderOracleHint(repo);
    expect(hint).toContain("[PRECOG]");
    expect(hint).toContain("After A");
    expect(hint).toContain("B");
  });

  it("renderOracleHint returns '' when no observations yet", () => {
    expect(renderOracleHint(repo)).toBe("");
  });

  it("renderOracleHint returns '' when below confidence threshold", () => {
    // Single observation -> no bigram
    recordObservation(repo, "loner");
    expect(renderOracleHint(repo)).toBe("");
  });

  it("resetOracle wipes everything", () => {
    for (const tool of ["A", "B"]) recordObservation(repo, tool);
    dreamCycle(repo);
    resetOracle(repo);
    const s = oracleStats(repo);
    expect(s.totalObservations).toBe(0);
    expect(s.pheromoneEdges).toBe(0);
    expect(s.predictions).toBe(0);
  });

  it("respects maxObservations FIFO trim", () => {
    const cfg = { maxObservations: 5 };
    for (let i = 0; i < 10; i++) recordObservation(repo, `T${i}`, [], cfg);
    const s = oracleStats(repo);
    expect(s.totalObservations).toBeLessThanOrEqual(5);
  });

  it("hit rate stat reflects hits / predictions ratio", () => {
    // End on A so dream predicts FROM A; observing B confirms hit.
    for (const tool of ["A", "B", "A", "B", "A"]) recordObservation(repo, tool);
    dreamCycle(repo);
    recordObservation(repo, "B");      // confirms a prediction A->B
    const s = oracleStats(repo);
    expect(s.hits).toBeGreaterThanOrEqual(1);
    expect(s.hitRate).toBeGreaterThan(0);
  });

  it("DEFAULT_ORACLE_CONFIG is exported with sensible defaults", () => {
    expect(DEFAULT_ORACLE_CONFIG.alpha + DEFAULT_ORACLE_CONFIG.beta).toBeCloseTo(1.0, 5);
    expect(DEFAULT_ORACLE_CONFIG.rho).toBeGreaterThan(0);
    expect(DEFAULT_ORACLE_CONFIG.rho).toBeLessThan(1);
  });
});

// ─────────────────────────────────────────────────────────────────────────
// Pulse integration: hint surfaces in pulse.renderPulse output
// ─────────────────────────────────────────────────────────────────────────
describe("oracle ↔ pulse integration", () => {
  it("renderPulse includes [PRECOG] hint when confidence sufficient", async () => {
    // Seed Oracle with a strong A->B pattern. End on A so the hint reads "After A".
    for (const tool of ["A", "B", "A", "B", "A", "B", "A"]) recordObservation(repo, tool);
    const { collectPulseStatus, renderPulse } = await import("../pulse.js");
    const status = collectPulseStatus(repo);
    // Force some notable so quiet-mode renders.
    status.notable.push({ level: "info", text: "force render" });
    const text = renderPulse(status, { quiet: false, repoRoot: repo, autoAck: false });
    expect(text).toContain("[PRECOG]");
    expect(text).toContain("After A");
  });
});
