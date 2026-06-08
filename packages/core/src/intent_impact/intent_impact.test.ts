import { describe, it, expect } from "vitest";
import { buildCrossLayerGraph } from "../cross_layer_graph/index.js";
import { intentImpactMismatch, intentImpactGauntlet } from "./index.js";

const g = buildCrossLayerGraph([
  { path: "schema.prisma", content: "model Payment { id Int @id }" },
  { path: "pay.ts", content: "export function register(){ return charge(); }\nexport function charge(){ return prisma.payment.create({data:{}}); }" },
]);
const diff = "--- a/pay.ts\n+++ b/pay.ts\n@@ -1,1 +1,2 @@ export function charge(){\n+x\n";

describe("intent_impact", () => {
  it("gauntlet is 100", () => expect(intentImpactGauntlet().score).toBe(100));

  it("trivial message + heavy impact → MISMATCH (HIGH, names the keystone)", () => {
    const r = intentImpactMismatch(g, diff, "chore: cleanup formatting");
    expect(r.mismatch).toBe(true);
    expect(r.severity).toBe("HIGH");
    expect(r.keystonesHit).toContain("charge");
  });

  it("a message that NAMES the impacted table is consistent", () => {
    expect(intentImpactMismatch(g, diff, "fix: correct the payment charge").mismatch).toBe(false);
  });

  it("a non-trivial message is never a mismatch", () => {
    expect(intentImpactMismatch(g, diff, "feat: rework billing").mismatch).toBe(false);
  });

  it("trivial message with NO cross-layer impact is consistent (no false alarm)", () => {
    const g2 = buildCrossLayerGraph([{ path: "util.ts", content: "export function fmt(s){ return s.trim(); }" }]);
    const d2 = "--- a/util.ts\n+++ b/util.ts\n@@ -1,1 +1,2 @@ export function fmt(s){\n+x\n";
    expect(intentImpactMismatch(g2, d2, "chore: format").mismatch).toBe(false);
  });

  it("never throws on garbage", () => {
    expect(() => intentImpactMismatch(null as never, "x", "y")).not.toThrow();
  });
});
