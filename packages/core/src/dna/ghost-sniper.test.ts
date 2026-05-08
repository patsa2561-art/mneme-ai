import { describe, it, expect } from "vitest";
import { ghostSniperVerify, snipeOne, type GhostSniperCandidate } from "./ghost-sniper.js";

const PERFECT: GhostSniperCandidate = {
  id: "perfect",
  reference: "src/billing.ts:42",
  existsInRepo: true,
  semanticSimilarity: 0.95,
  successCount: 80,
  totalCount: 100,
  hebbianStrength: 1,
};

const HALLUCINATED: GhostSniperCandidate = {
  id: "halluc",
  reference: "src/imaginary.ts:1",
  existsInRepo: false, // ← gate 1 fail
  semanticSimilarity: 0.99,
  successCount: 100,
  totalCount: 100,
  hebbianStrength: 1,
};

const LOW_SEMANTIC: GhostSniperCandidate = {
  id: "low-sem",
  reference: "src/x.ts",
  existsInRepo: true,
  semanticSimilarity: 0.3, // ← gate 2 fail
  successCount: 100,
  totalCount: 100,
  hebbianStrength: 1,
};

const LOW_CONFIDENCE: GhostSniperCandidate = {
  id: "low-conf",
  reference: "src/y.ts",
  existsInRepo: true,
  semanticSimilarity: 0.9,
  successCount: 1, // few trials
  totalCount: 5,   // → Wilson LB low
  hebbianStrength: 0.1,
};

describe("A8. Ghost-Sniper — gate 1 (AST existence)", () => {
  it("rejects hallucinated references", () => {
    const r = ghostSniperVerify([HALLUCINATED]);
    expect(r.accepted).toHaveLength(0);
    expect(r.decisions[0]!.outcome).toBe("rejected");
    if (r.decisions[0]!.outcome !== "rejected") return;
    expect(r.decisions[0]!.failedGate).toBe("ast-existence");
    expect(r.stats.rejectedAtAst).toBe(1);
  });

  it("never returns 'almost accepted' as fallback (no lying)", () => {
    const r = ghostSniperVerify([HALLUCINATED, HALLUCINATED]);
    expect(r.accepted).toEqual([]);
  });
});

describe("A8. Ghost-Sniper — gate 2 (semantic match)", () => {
  it("rejects below semantic threshold", () => {
    const r = ghostSniperVerify([LOW_SEMANTIC]);
    expect(r.accepted).toHaveLength(0);
    if (r.decisions[0]!.outcome !== "rejected") throw new Error();
    expect(r.decisions[0]!.failedGate).toBe("semantic-match");
    expect(r.stats.rejectedAtSemantic).toBe(1);
  });

  it("respects custom semanticThreshold", () => {
    // Lower threshold should accept the previously-rejected candidate
    const r = ghostSniperVerify([LOW_SEMANTIC], { semanticThreshold: 0.2, confidenceThreshold: 0 });
    expect(r.accepted.length).toBe(1);
  });
});

describe("A8. Ghost-Sniper — gate 3 (confidence)", () => {
  it("rejects below confidence threshold", () => {
    const r = ghostSniperVerify([LOW_CONFIDENCE]);
    if (r.decisions[0]!.outcome !== "rejected") throw new Error();
    expect(r.decisions[0]!.failedGate).toBe("confidence");
    expect(r.stats.rejectedAtConfidence).toBe(1);
  });

  it("custom confidenceThreshold can let it through", () => {
    const r = ghostSniperVerify([LOW_CONFIDENCE], { confidenceThreshold: 0 });
    expect(r.accepted.length).toBe(1);
  });
});

describe("A8. Ghost-Sniper — perfect candidate accepted", () => {
  it("perfect candidate passes all 3 gates", () => {
    const r = ghostSniperVerify([PERFECT]);
    expect(r.accepted.length).toBe(1);
    expect(r.accepted[0]!.id).toBe("perfect");
    expect(r.accepted[0]!.confidence).toBeGreaterThan(0);
    expect(r.accepted[0]!.score).toBeGreaterThan(0);
  });
});

describe("A8. Ghost-Sniper — mixed candidates", () => {
  it("accepted only contains those that passed all gates", () => {
    const r = ghostSniperVerify([PERFECT, HALLUCINATED, LOW_SEMANTIC, LOW_CONFIDENCE]);
    expect(r.accepted).toHaveLength(1);
    expect(r.accepted[0]!.id).toBe("perfect");
    expect(r.stats.total).toBe(4);
    expect(r.stats.accepted).toBe(1);
    expect(r.stats.rejectedAtAst + r.stats.rejectedAtSemantic + r.stats.rejectedAtConfidence).toBe(3);
  });

  it("decisions[] preserves order + transparency for all candidates", () => {
    const r = ghostSniperVerify([PERFECT, HALLUCINATED, LOW_SEMANTIC]);
    expect(r.decisions).toHaveLength(3);
    const ids = r.decisions.map((d) => d.id);
    expect(ids).toContain("perfect");
    expect(ids).toContain("halluc");
    expect(ids).toContain("low-sem");
  });
});

describe("A8. Ghost-Sniper — snipeOne (one-shot)", () => {
  it("returns the single highest-confidence accepted result", () => {
    const better: GhostSniperCandidate = { ...PERFECT, id: "better", semanticSimilarity: 0.99 };
    const worse: GhostSniperCandidate = { ...PERFECT, id: "worse", semanticSimilarity: 0.7 };
    const r = snipeOne([worse, better]);
    expect(r?.id).toBe("better");
  });

  it("returns null when nothing passes (no fallback to lies)", () => {
    const r = snipeOne([HALLUCINATED, LOW_SEMANTIC, LOW_CONFIDENCE]);
    expect(r).toBeNull();
  });

  it("empty input → null", () => {
    expect(snipeOne([])).toBeNull();
  });
});

describe("A8. Ghost-Sniper — invariants", () => {
  it("never accepts a non-existent reference (the hallucination invariant)", () => {
    const many: GhostSniperCandidate[] = [];
    for (let i = 0; i < 50; i++) {
      many.push({
        id: `h${i}`,
        reference: `imaginary${i}.ts`,
        existsInRepo: false,
        semanticSimilarity: 0.99,
        successCount: 100,
        totalCount: 100,
        hebbianStrength: 1,
      });
    }
    const r = ghostSniperVerify(many);
    expect(r.accepted).toEqual([]);
  });

  it("deterministic across runs", () => {
    const a = ghostSniperVerify([PERFECT, LOW_SEMANTIC]);
    const b = ghostSniperVerify([PERFECT, LOW_SEMANTIC]);
    expect(a).toEqual(b);
  });
});
