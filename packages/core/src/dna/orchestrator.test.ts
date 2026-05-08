/**
 * DNA Orchestrator integration test — wires all 8 algorithms in one
 * deterministic pipeline. Verifies invariants:
 *
 *   • A perfect candidate gets accepted
 *   • A hallucinated reference gets rejected at the AST gate
 *   • Phantom-path suggestions accompany the answer
 *   • Decisions trace covers every input candidate
 *   • Same inputs → same outputs (purity)
 */

import { describe, it, expect } from "vitest";
import { dnaSearch, type DnaSearchInput } from "./orchestrator.js";

const BASE_INPUT: DnaSearchInput = {
  queryText: "find Stripe pricing logic",
  queryEmbedding: [1, 0, 0],
  candidates: [
    {
      id: "real-canonical",
      embedding: [0.95, 0.05, 0],
      baseRelevance: 0.9,
      patternSignature: "sig-stripe-pricing",
      existsInRepo: true,
      successCount: 80,
      totalCount: 100,
      hebbianStrength: 1,
      meta: { path: "services/billing/v2/pricing.ts" },
    },
    {
      id: "hallucinated",
      embedding: [0.99, 0.01, 0], // semantically perfect
      baseRelevance: 0.99,
      patternSignature: "sig-stripe-pricing",
      existsInRepo: false, // ← lie
      successCount: 100,
      totalCount: 100,
      hebbianStrength: 1,
      meta: { path: "src/imaginary.ts" },
    },
    {
      id: "deprecated",
      embedding: [0.8, 0.2, 0],
      baseRelevance: 0.6,
      patternSignature: "sig-stripe-legacy",
      existsInRepo: true,
      successCount: 30,
      totalCount: 100,
      hebbianStrength: 0.5,
      meta: { path: "lib/legacy/stripe.ts" },
    },
  ],
  echoSignals: [
    { id: "regret-1", embedding: [0.8, 0.2, 0], label: "old stripe pattern" },
    { id: "decision-1", embedding: [0.95, 0.05, 0], label: "v2 stripe pattern" },
  ],
  canonicalPatterns: [
    {
      id: "stripe-v2",
      canonicalLocation: "services/billing/v2/",
      embedding: [0.95, 0.05, 0],
      label: "Stripe v2 pattern",
      upvotes: 50,
      downvotes: 2,
    },
  ],
  federationVotes: {
    "sig-stripe-pricing": { upvotes: 100, downvotes: 5 },
    "sig-stripe-legacy": { upvotes: 5, downvotes: 50 },
  },
  regretEmbeddings: [[0.8, 0.2, 0]], // matches "deprecated" → penalty
  semanticThreshold: 0.6,
  confidenceThreshold: 0.3,
};

describe("DNA Orchestrator — happy path", () => {
  it("accepts the real canonical result, rejects hallucinated", () => {
    const r = dnaSearch(BASE_INPUT);
    expect(r.accepted.map((a) => a.id)).toContain("real-canonical");
    expect(r.accepted.map((a) => a.id)).not.toContain("hallucinated");
    expect(r.stats.rejectedAtAst).toBeGreaterThanOrEqual(1);
  });

  it("returns phantom-path suggestions", () => {
    const r = dnaSearch(BASE_INPUT);
    expect(r.phantomSuggestions.length).toBeGreaterThan(0);
    expect(r.phantomSuggestions[0]!.canonicalLocation).toContain("billing/v2");
  });

  it("trace contains every stage's output", () => {
    const r = dnaSearch(BASE_INPUT);
    expect(r.trace.afterRepulsion.length).toBe(BASE_INPUT.candidates.length);
    expect(r.trace.afterTribal.length).toBe(BASE_INPUT.candidates.length);
    expect(r.trace.sniperDecisions.length).toBe(BASE_INPUT.candidates.length);
  });

  it("stats match the actual decisions", () => {
    const r = dnaSearch(BASE_INPUT);
    const accepted = r.trace.sniperDecisions.filter((d) => d.outcome === "accepted").length;
    const rejAst = r.trace.sniperDecisions.filter(
      (d) => d.outcome === "rejected" && d.failedGate === "ast-existence",
    ).length;
    expect(r.stats.accepted).toBe(accepted);
    expect(r.stats.rejectedAtAst).toBe(rejAst);
  });
});

describe("DNA Orchestrator — invariants", () => {
  it("strict mode (default): no hallucinated reference EVER appears in accepted", () => {
    const r = dnaSearch(BASE_INPUT);
    for (const a of r.accepted) {
      const orig = BASE_INPUT.candidates.find((c) => c.id === a.id);
      expect(orig?.existsInRepo).toBe(true);
    }
  });

  it("deterministic across runs", () => {
    const r1 = dnaSearch(BASE_INPUT);
    const r2 = dnaSearch(BASE_INPUT);
    expect(r1.stats).toEqual(r2.stats);
    expect(r1.accepted.map((a) => a.id)).toEqual(r2.accepted.map((a) => a.id));
  });

  it("empty candidates → empty accepted but no crash", () => {
    const r = dnaSearch({ ...BASE_INPUT, candidates: [] });
    expect(r.accepted).toEqual([]);
    expect(r.stats.candidates).toBe(0);
  });

  it("permissive thresholds → more candidates accepted", () => {
    const strict = dnaSearch({ ...BASE_INPUT, semanticThreshold: 0.9, confidenceThreshold: 0.9 });
    const lax = dnaSearch({ ...BASE_INPUT, semanticThreshold: 0.1, confidenceThreshold: 0 });
    expect(lax.accepted.length).toBeGreaterThanOrEqual(strict.accepted.length);
  });
});

describe("DNA Orchestrator — quantum + time-travel optional layers", () => {
  it("works without quantum/time-travel inputs", () => {
    const r = dnaSearch(BASE_INPUT);
    expect(r.trace.afterQuantum).toBeUndefined();
    expect(r.timeTravel).toEqual([]);
  });

  it("includes time-travel results when matches provided", () => {
    const r = dnaSearch({
      ...BASE_INPUT,
      timeTravelMatches: [
        {
          commitHash: "a1b2",
          timestamp: "2024-01-01T00:00:00Z",
          path: "src/auth.ts",
          line: 1,
          snippet: "x",
          baseRelevance: 0.5,
          ageDays: 365,
        },
      ],
      queryAgeDays: 365,
    });
    expect(r.timeTravel.length).toBe(1);
  });

  it("quantum rerank triggers when tensors provided", () => {
    const r = dnaSearch({
      ...BASE_INPUT,
      quantumTensors: BASE_INPUT.candidates.map((c) => ({ id: c.id, matrix: [[1, 0], [0, 1]] })),
      quantumQueryFeatures: [1, 1],
      quantumIntentVector: [0.5, 0.5],
    });
    expect(r.trace.afterQuantum).toBeDefined();
    expect(r.trace.afterQuantum!.length).toBe(BASE_INPUT.candidates.length);
  });
});
