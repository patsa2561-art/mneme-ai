/**
 * QSAC Tech 2 — Causal Claim Graph tests.
 */
import { describe, expect, it } from "vitest";
import {
  ClaimGraphBuilder,
  propagateBeliefs,
  buildStandardAuditGraph,
  getPosterior,
} from "./claim-graph.js";
import { distribution } from "./superposition.js";

const cleanPass = distribution({ pass: 0.95, warn: 0.04, fail: 0.005, skipped: 0.005 });
const cleanFail = distribution({ pass: 0.05, warn: 0.10, fail: 0.83, skipped: 0.02 });
const skipped = distribution({ pass: 0, warn: 0, fail: 0, skipped: 1 });

describe("ClaimGraphBuilder", () => {
  it("builds a graph with axes + edges", () => {
    const g = new ClaimGraphBuilder()
      .addAxis("a", "A", cleanPass)
      .addAxis("b", "B", cleanFail)
      .link("a", "b", "supports", 0.5)
      .build();
    expect(g.nodes.size).toBe(2);
    expect(g.edges).toHaveLength(1);
  });
});

describe("propagateBeliefs — convergence + stability", () => {
  it("converges on a graph with no edges (each posterior == prior)", () => {
    const g = new ClaimGraphBuilder()
      .addAxis("a", "A", cleanPass)
      .addAxis("b", "B", cleanFail)
      .build();
    const r = propagateBeliefs(g);
    expect(r.converged).toBe(true);
    expect(getPosterior(g, "a").pass).toBeCloseTo(cleanPass.pass, 3);
    expect(getPosterior(g, "b").fail).toBeCloseTo(cleanFail.fail, 3);
  });

  it("converges quickly on small graphs", () => {
    const g = buildStandardAuditGraph({
      axes: {
        behavioralParity: cleanPass,
        apiContractDrift: cleanPass,
        testPassRate: cleanPass,
        perfRegression: cleanPass,
        aiNarrative: cleanPass,
      },
    });
    const r = propagateBeliefs(g);
    expect(r.converged).toBe(true);
    expect(r.iterations).toBeLessThan(20);
  });

  it("axis_api fail propagates support → axis_tests posterior shifts", () => {
    const g = buildStandardAuditGraph({
      axes: {
        behavioralParity: cleanPass,
        apiContractDrift: cleanFail,    // ← the bad axis
        testPassRate: cleanPass,         // ← clean prior
        perfRegression: cleanPass,
        aiNarrative: cleanPass,
      },
    });
    propagateBeliefs(g);
    const testsPosterior = getPosterior(g, "axis_tests");
    // Tests prior was strong pass; api-fail-supports-tests should pull tests' fail mass UP slightly
    expect(testsPosterior.fail).toBeGreaterThan(cleanPass.fail);
  });
});

describe("Causal contradiction detection — the 'AI lied' scenario", () => {
  it("narrative claims 'no API change' but api axis fails → narrative posterior collapses", () => {
    const narrativeClaim = distribution({ pass: 0.9, warn: 0.08, fail: 0.01, skipped: 0.01 });
    const g = buildStandardAuditGraph({
      axes: {
        behavioralParity: cleanPass,
        apiContractDrift: cleanFail, // api actually broke
        testPassRate: cleanPass,
        perfRegression: cleanPass,
        aiNarrative: cleanPass,
      },
      narrative: { claimsNoApiChange: narrativeClaim },
    });
    propagateBeliefs(g);
    const narrativePosterior = getPosterior(g, "nar_no_api");
    // Contradicting evidence (api fails) should pull narrative claim
    // away from pass — the lie is detected.
    expect(narrativePosterior.pass).toBeLessThan(narrativeClaim.pass);
  });

  it("narrative claims 'all tests pass' but tests fail → narrative posterior shifts", () => {
    const narrative = distribution({ pass: 0.95, warn: 0.04, fail: 0.005, skipped: 0.005 });
    const g = buildStandardAuditGraph({
      axes: {
        behavioralParity: cleanPass,
        apiContractDrift: cleanPass,
        testPassRate: cleanFail,
        perfRegression: cleanPass,
        aiNarrative: cleanPass,
      },
      narrative: { claimsAllTestsPass: narrative },
    });
    propagateBeliefs(g);
    const narrativePosterior = getPosterior(g, "nar_all_tests_pass");
    expect(narrativePosterior.pass).toBeLessThan(narrative.pass);
  });
});

describe("Standard graph — gate aggregation", () => {
  it("all-pass axes yield gate posterior = pass", () => {
    const g = buildStandardAuditGraph({
      axes: {
        behavioralParity: cleanPass,
        apiContractDrift: cleanPass,
        testPassRate: cleanPass,
        perfRegression: cleanPass,
        aiNarrative: cleanPass,
      },
    });
    propagateBeliefs(g);
    const gate = getPosterior(g, "gate_overall");
    expect(gate.collapsed).toBe("pass");
  });

  it("one fail axis pulls gate confidence down", () => {
    const g = buildStandardAuditGraph({
      axes: {
        behavioralParity: cleanPass,
        apiContractDrift: cleanPass,
        testPassRate: cleanFail,
        perfRegression: cleanPass,
        aiNarrative: cleanPass,
      },
    });
    propagateBeliefs(g);
    const gate = getPosterior(g, "gate_overall");
    // Confidence drops
    const gateConfidence = gate.confidence;
    expect(gateConfidence).toBeLessThan(0.95);
  });

  it("all-skipped → gate is skipped", () => {
    const g = buildStandardAuditGraph({
      axes: {
        behavioralParity: skipped,
        apiContractDrift: skipped,
        testPassRate: skipped,
        perfRegression: skipped,
        aiNarrative: skipped,
      },
    });
    propagateBeliefs(g);
    const gate = getPosterior(g, "gate_overall");
    expect(gate.collapsed).toBe("skipped");
  });
});
