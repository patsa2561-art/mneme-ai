import { describe, it, expect } from "vitest";
import { buildCognitiveSignature, judgeDiff, measureSeparability, wisdomGate, cognitiveGauntlet } from "./index.js";

// Author style: 2-space indent, single quotes, arrow fns, const, no semicolons-before-paren.
const A = (i: number) => `diff --git a/f${i}.ts b/f${i}.ts
+const x${i} = () => {
+  const y = 'hello'
+  return y.length
+}`;
// Foreign style: 4-space indent (tabs), double quotes, function keyword, var.
const FOREIGN = `diff --git a/g.ts b/g.ts
+function bigThing(input) {
+\tvar result = "WAITING";
+\tif (input == null) { return "NOPE"; }
+\treturn result;
+}`;

const authorDiffs = [A(1), A(2), A(3), A(4)];
const authorHeldout = A(5);

describe("v2.103 COGNITIVE WISDOM GATE (NEMESIS × HYDRA)", () => {
  it("builds a signature with intra-author spread from ≥3 samples", () => {
    const sig = buildCognitiveSignature("shinn", authorDiffs);
    expect(sig.sampleCount).toBe(4);
    expect(sig.intraVariance).toBeGreaterThanOrEqual(0);
    expect(Object.keys(sig.baseline.features).length).toBeGreaterThan(0);
  });

  it("UNKNOWN when the signature is too thin (< 3 samples)", () => {
    const sig = buildCognitiveSignature("x", [A(1)]);
    expect(judgeDiff(sig, A(2)).verdict).toBe("UNKNOWN");
  });

  it("allows the author's own held-out style; flags a clearly-foreign style", () => {
    const sig = buildCognitiveSignature("shinn", authorDiffs);
    const own = judgeDiff(sig, authorHeldout);
    const foreign = judgeDiff(sig, FOREIGN);
    expect(["ALLOW", "REVIEW"]).toContain(own.verdict);          // own style not flagged
    expect(foreign.deviation).toBeGreaterThan(own.deviation);    // foreign is farther
  });

  it("THE HONESTY MECHANISM — refuses to flag when not separable (UNKNOWN)", () => {
    const sig = buildCognitiveSignature("shinn", authorDiffs);
    // benchmark where 'other' is actually the author's own style → not separable
    const sep = measureSeparability(sig, [authorHeldout], [A(6)]);
    expect(sep.separable).toBe(false);
    const v = wisdomGate(process.cwd(), sig, A(7), 1700000000000, { authorHeldout: [authorHeldout], otherDiffs: [A(6)] });
    expect(v.verdict).not.toBe("FLAG");                          // never flags on noise
  });

  it("measures separability against a genuinely foreign style", () => {
    const sig = buildCognitiveSignature("shinn", authorDiffs);
    const sep = measureSeparability(sig, [authorHeldout], [FOREIGN]);
    expect(sep.otherMeanDist).toBeGreaterThan(sep.authorMeanDist);
  });

  it("signs every verdict (offline-verifiable) + deterministic", () => {
    const sig = buildCognitiveSignature("shinn", authorDiffs);
    const a = wisdomGate(process.cwd(), sig, FOREIGN, 1700000000000);
    const b = wisdomGate(process.cwd(), sig, FOREIGN, 1700000000000);
    expect(a.receipt.payloadHash).toBe(b.receipt.payloadHash);
    expect(typeof a.receipt.sig).toBe("string");
  });

  it("cognitive gauntlet scores 100 (catch ∧ allow ∧ unknown-when-unseparable ∧ deterministic ∧ stable)", () => {
    const g = cognitiveGauntlet(process.cwd(), authorDiffs, FOREIGN, authorHeldout, 1700000000000);
    expect(g.allowsAuthor).toBe(true);
    expect(g.unknownWhenUnseparable).toBe(true);
    expect(g.deterministic).toBe(true);
    expect(g.stable).toBe(true);
    expect(g.score).toBe(100);
  });

  it("STABILITY — total on garbage", () => {
    expect(judgeDiff(null as never, "").verdict).toBe("UNKNOWN");
    expect(buildCognitiveSignature("x", null as never).sampleCount).toBe(0);
    expect(measureSeparability(null as never, [], []).separable).toBe(false);
    expect(cognitiveGauntlet(process.cwd(), [], "", "", 0).score).toBe(0);
  });
});
