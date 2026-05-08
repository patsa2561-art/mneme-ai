/**
 * Self-learning engine tests.
 *
 * Math correctness for each closed-form learning rule:
 *   - emaUpdate: weighted average converges
 *   - bayesianPosteriorMean: Beta-Binomial conjugate updates correctly
 *   - wilsonLowerBound: known reference values
 *   - learningTick: 4 channels each fire on relevant observations only
 *   - state file I/O round-trip
 *   - audit-trail capping
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  emaUpdate,
  bayesianPosteriorMean,
  wilsonLowerBound,
  learningTick,
  runLearningTick,
  writeObservations,
  readState,
  writeState,
  appendObservation,
  type Observation,
  type LearnedState,
} from "./learning.js";
import { DEFAULT_HMRA_WEIGHTS } from "../hmra/hmra.js";

let tmp: string;
beforeEach(() => {
  tmp = mkdtempSync(join(tmpdir(), "mneme-learn-"));
});
afterEach(() => {
  try { rmSync(tmp, { recursive: true, force: true }); } catch {}
});

// ──────────────────────────────────────────────────────────────────────
// Math primitives
// ──────────────────────────────────────────────────────────────────────

describe("learning — emaUpdate", () => {
  it("first sample with α=0.2 against prev=0: ~0.2 of the sample", () => {
    expect(emaUpdate(0, 1, 0.2)).toBeCloseTo(0.2, 5);
  });

  it("converges to the sample value over many iterations", () => {
    let value = 0;
    for (let i = 0; i < 100; i++) value = emaUpdate(value, 1, 0.2);
    expect(value).toBeCloseTo(1, 3);
  });

  it("preserves the prev when α=0", () => {
    expect(emaUpdate(0.7, 1, 0)).toBe(0.7);
  });

  it("becomes the sample when α=1", () => {
    expect(emaUpdate(0.7, 1, 1)).toBe(1);
  });
});

describe("learning — bayesianPosteriorMean (Beta-Binomial)", () => {
  it("uniform prior + 0 evidence → 0.5", () => {
    expect(bayesianPosteriorMean({ alpha: 1, beta: 1 }, 0, 0)).toBe(0.5);
  });

  it("uniform prior + 1 hit + 0 miss → 2/3", () => {
    expect(bayesianPosteriorMean({ alpha: 1, beta: 1 }, 1, 0)).toBeCloseTo(2 / 3, 5);
  });

  it("uniform prior + 9 hits + 1 miss → 10/12 ≈ 0.833", () => {
    expect(bayesianPosteriorMean({ alpha: 1, beta: 1 }, 9, 1)).toBeCloseTo(10 / 12, 5);
  });

  it("strong prior overrides weak evidence", () => {
    // Beta(50, 50) prior + 1 hit, 0 miss → 51 / 101 ≈ 0.505
    expect(bayesianPosteriorMean({ alpha: 50, beta: 50 }, 1, 0)).toBeCloseTo(51 / 101, 4);
  });
});

describe("learning — wilsonLowerBound", () => {
  it("returns 0 for 0 trials", () => {
    expect(wilsonLowerBound(0, 0)).toBe(0);
  });

  it("returns 0 for 0 successes", () => {
    expect(wilsonLowerBound(0, 10)).toBeCloseTo(0, 5);
  });

  it("3 of 3 successes: lower bound around 0.44 with z=1.96", () => {
    // Wilson lower bound for 3/3 ~ 0.4385
    const v = wilsonLowerBound(3, 3);
    expect(v).toBeGreaterThan(0.4);
    expect(v).toBeLessThan(0.5);
  });

  it("9 of 10 successes: lower bound around 0.60", () => {
    const v = wilsonLowerBound(9, 10);
    expect(v).toBeGreaterThan(0.55);
    expect(v).toBeLessThan(0.65);
  });

  it("monotone increasing in n with same hit rate", () => {
    // Same proportion (0.9) but more samples → tighter bound
    expect(wilsonLowerBound(9, 10)).toBeLessThan(wilsonLowerBound(900, 1000));
  });
});

// ──────────────────────────────────────────────────────────────────────
// Composite learningTick
// ──────────────────────────────────────────────────────────────────────

describe("learning — learningTick composite", () => {
  it("first tick from null → seeds default state with tickCount=1", () => {
    const next = learningTick({ observations: [], current: null });
    expect(next.tickCount).toBe(1);
    expect(next.hmraWeights).toEqual(DEFAULT_HMRA_WEIGHTS);
    expect(next.toolSuccessRates).toEqual({});
    expect(next.rulePriors).toEqual({});
    expect(next.checksum).toMatch(/^[a-f0-9]{16}$/);
  });

  it("Channel B updates per-tool success rates from tool-invocation observations", () => {
    const obs: Observation[] = Array.from({ length: 10 }, (_, i) => ({
      ts: `2026-05-08T12:00:${String(i).padStart(2, "0")}Z`,
      kind: "tool-invocation",
      subject: "mneme.memory.ask",
      outcome: "PASS",
    }));
    const next = learningTick({ observations: obs, current: null });
    expect(next.toolSuccessRates["mneme.memory.ask"]).toBeGreaterThan(0.5);
  });

  it("Channel C updates Bayesian rule priors only on rule:* observations", () => {
    const obs: Observation[] = [
      { ts: "2026-05-08T12:00:00Z", kind: "user-feedback", subject: "rule:cwe-89", outcome: "confirmed" },
      { ts: "2026-05-08T12:00:01Z", kind: "user-feedback", subject: "rule:cwe-89", outcome: "confirmed" },
      { ts: "2026-05-08T12:00:02Z", kind: "user-feedback", subject: "rule:cwe-89", outcome: "false-positive" },
    ];
    const next = learningTick({ observations: obs, current: null });
    expect(next.rulePriors["cwe-89"]).toBeDefined();
    // Beta(1,1) + 2 hit + 1 miss → posterior Beta(3, 2) → mean 0.6
    expect(bayesianPosteriorMean(next.rulePriors["cwe-89"]!, 0, 0)).toBeCloseTo(0.6, 5);
  });

  it("Channel D promotes molecules at Wilson lower ≥ 0.6 and ≥3 trials", () => {
    // 12 trials with 12 hits → Wilson lower ~0.76 → eligible
    const obs: Observation[] = [];
    for (let i = 0; i < 12; i++) {
      obs.push({ ts: `2026-05-08T12:00:${String(i).padStart(2, "0")}Z`, kind: "grader-result", subject: "molecule:expert_finder", outcome: "PASS" });
    }
    const next = learningTick({ observations: obs, current: null });
    expect(next.moleculeStats["expert_finder"]).toBeDefined();
    expect(next.moleculeStats["expert_finder"]!.trials).toBe(12);
    expect(next.moleculeStats["expert_finder"]!.hits).toBe(12);
    // Audit trail should mention the eligibility
    const audit = next.auditTrail.find((a) => a.channel === "D-molecule");
    expect(audit?.detail ?? "").toContain("expert_finder");
  });

  it("Channel D does NOT promote molecules with too few trials", () => {
    // 2 hits, 2 trials — below MOLECULE_MIN_TRIALS=3
    const obs: Observation[] = [
      { ts: "2026-05-08T12:00:00Z", kind: "grader-result", subject: "molecule:flaky", outcome: "PASS" },
      { ts: "2026-05-08T12:00:01Z", kind: "grader-result", subject: "molecule:flaky", outcome: "PASS" },
    ];
    const next = learningTick({ observations: obs, current: null });
    const audit = next.auditTrail.find((a) => a.channel === "D-molecule");
    // Either no audit entry, or the entry doesn't list flaky as eligible
    expect(audit?.detail ?? "").not.toContain("flaky");
  });

  it("audit trail capped at 50 entries", () => {
    let state: LearnedState | null = null;
    for (let i = 0; i < 60; i++) {
      const obs: Observation[] = Array.from({ length: 5 }, (_, j) => ({
        ts: `2026-05-08T${String(12 + i).padStart(2, "0")}:${String(j).padStart(2, "0")}:00Z`,
        kind: "tool-invocation",
        subject: `mneme.tool${j}`,
        outcome: "PASS",
      }));
      state = learningTick({ observations: obs, current: state });
    }
    expect(state!.auditTrail.length).toBeLessThanOrEqual(50);
  });

  it("checksum changes when state changes", () => {
    const s1 = learningTick({ observations: [], current: null });
    const s2 = learningTick({
      observations: [{ ts: "2026-05-08T13:00:00Z", kind: "tool-invocation", subject: "mneme.memory.ask", outcome: "PASS" }],
      current: s1,
    });
    expect(s2.checksum).not.toBe(s1.checksum);
  });
});

// ──────────────────────────────────────────────────────────────────────
// File I/O
// ──────────────────────────────────────────────────────────────────────

describe("learning — state file I/O", () => {
  it("readState returns null when file missing", () => {
    expect(readState(tmp)).toBe(null);
  });

  it("writeState + readState round-trip preserves the full state", () => {
    const state = learningTick({ observations: [], current: null });
    writeState(tmp, state);
    const read = readState(tmp);
    expect(read).toEqual(state);
  });

  it("appendObservation accumulates entries (capped at 1000)", async () => {
    for (let i = 0; i < 1100; i++) {
      appendObservation(tmp, {
        ts: `2026-05-08T12:00:${String(i % 60).padStart(2, "0")}Z`,
        kind: "tool-invocation",
        subject: `mneme.t${i}`,
        outcome: "PASS",
      });
    }
    const obs = (await import("./learning.js")).readObservations(tmp);
    expect(obs.length).toBe(1000);
  });

  it("runLearningTick: end-to-end — observations → state file written", async () => {
    writeObservations(tmp, [
      { ts: "2026-05-08T12:00:00Z", kind: "tool-invocation", subject: "mneme.memory.ask", outcome: "PASS" },
      { ts: "2026-05-08T12:00:01Z", kind: "tool-invocation", subject: "mneme.memory.ask", outcome: "PASS" },
    ]);
    const next = runLearningTick(tmp);
    expect(next.tickCount).toBe(1);
    expect(next.observationsLastTick).toBe(2);
    expect(existsSync(join(tmp, ".mneme", "learned-state.json"))).toBe(true);
  });
});
