import { describe, it, expect } from "vitest";
import { analyzeTestGap, changeTestGap, buildCoverage, testGapGauntlet } from "./index.js";
import { buildCrossLayerGraph } from "../cross_layer_graph/index.js";

const base = [
  { path: "schema.prisma", content: "model Wallet { id Int @id }" },
  { path: "auth.ts", content: "export function register(uid){ return createUserWallet(uid); }\nexport function createUserWallet(uid){ return prisma.wallet.create({data:{uid}}); }" },
];

describe("test_gap", () => {
  it("gauntlet is 100", () => expect(testGapGauntlet().score).toBe(100));

  it("flags an untested keystone, clears it once a test mentions it", () => {
    const noTest = analyzeTestGap(base);
    expect(noTest.uncoveredKeystones.some((k) => k.node.name === "createUserWallet")).toBe(true);
    const withTest = analyzeTestGap([...base, { path: "auth.test.ts", content: "test('w', () => createUserWallet(1));" }]);
    expect(withTest.uncoveredKeystones.some((k) => k.node.name === "createUserWallet")).toBe(false);
    expect(withTest.coveredKeystones).toBe(withTest.totalKeystones);
  });

  it("changeTestGap: a diff editing an untested keystone → GAP naming it", () => {
    const diff = "--- a/auth.ts\n+++ b/auth.ts\n@@ -1,1 +1,2 @@ export function createUserWallet(uid){\n+x\n";
    const cg = changeTestGap(base, diff);
    expect(cg.verdict).toBe("GAP");
    expect(cg.untestedKeystones).toContain("createUserWallet");
    const tested = changeTestGap([...base, { path: "auth.test.ts", content: "createUserWallet(1)" }], diff);
    expect(tested.untestedKeystones).toEqual([]);
  });

  it("coverage oracle: only scans test files, not prod code", () => {
    // createUserWallet appears in prod auth.ts but NOT in any test → uncovered
    const cov = buildCoverage(base);
    const g = buildCrossLayerGraph(base);
    const fn = g.nodes.find((n) => n.type === "function" && n.name === "createUserWallet")!;
    expect(cov.covered(fn)).toBe(false);
    expect(cov.testFileCount).toBe(0);
  });

  it("never throws on garbage", () => {
    expect(() => analyzeTestGap(null as never)).not.toThrow();
    expect(() => changeTestGap(null as never, "x")).not.toThrow();
  });
});
