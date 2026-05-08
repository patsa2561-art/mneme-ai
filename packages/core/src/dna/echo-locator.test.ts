import { describe, it, expect } from "vitest";
import { echoSignature, echoMatch, type EchoSignal } from "./echo-locator.js";

const SIGNALS: EchoSignal[] = [
  { id: "regret-1", embedding: [1, 0, 0], label: "JWT rollback" },
  { id: "regret-2", embedding: [0, 1, 0], label: "PII leak in logs" },
  { id: "decision-1", embedding: [0, 0, 1], label: "use Postgres over Mongo" },
];

describe("A4. Echo-Locator — signature", () => {
  it("identifies the strongest signal", () => {
    const sig = echoSignature({ targetEmbedding: [1, 0, 0], signals: SIGNALS });
    expect(sig.strongest?.id).toBe("regret-1");
    expect(sig.strongest?.strength).toBeGreaterThan(0);
  });

  it("orthogonal target → zero strength on all signals", () => {
    const sig = echoSignature({ targetEmbedding: [1, 1, 1], signals: SIGNALS });
    // Target is equally aligned with all 3 → strengths should be identical
    expect(sig.strengths.length).toBe(3);
    const strengths = sig.strengths.map((s) => s.strength);
    expect(strengths[0]).toBeCloseTo(strengths[1]!, 5);
  });

  it("Hebbian co-activation boosts matching signal", () => {
    const noBoost = echoSignature({ targetEmbedding: [1, 0, 0], signals: SIGNALS });
    const boosted = echoSignature({
      targetEmbedding: [1, 0, 0],
      signals: SIGNALS,
      coActivations: { "regret-1": 100 },
    });
    expect(boosted.strongest!.strength).toBeGreaterThan(noBoost.strongest!.strength);
  });

  it("empty signals → empty signature, null strongest", () => {
    const sig = echoSignature({ targetEmbedding: [1, 0], signals: [] });
    expect(sig.strengths).toEqual([]);
    expect(sig.strongest).toBeNull();
  });

  it("stable order: deterministic across runs", () => {
    const a = echoSignature({ targetEmbedding: [0.5, 0.5, 0], signals: SIGNALS });
    const b = echoSignature({ targetEmbedding: [0.5, 0.5, 0], signals: SIGNALS });
    expect(a.strengths.map((s) => s.id)).toEqual(b.strengths.map((s) => s.id));
  });
});

describe("A4. Echo-Locator — match", () => {
  it("matches files by signature similarity", () => {
    const querySig = echoSignature({ targetEmbedding: [1, 0, 0], signals: SIGNALS });
    const candA = echoSignature({ targetEmbedding: [0.9, 0.1, 0], signals: SIGNALS });
    const candB = echoSignature({ targetEmbedding: [0, 0, 1], signals: SIGNALS });
    const matches = echoMatch({
      querySignature: querySig,
      candidates: [
        { fileId: "fileA", signature: candA },
        { fileId: "fileB", signature: candB },
      ],
    });
    expect(matches[0]!.fileId).toBe("fileA"); // closer signature
    expect(matches[0]!.similarity).toBeGreaterThan(matches[1]!.similarity);
  });

  it("empty candidates → empty matches", () => {
    const querySig = echoSignature({ targetEmbedding: [1, 0], signals: [] });
    expect(echoMatch({ querySignature: querySig, candidates: [] })).toEqual([]);
  });
});
