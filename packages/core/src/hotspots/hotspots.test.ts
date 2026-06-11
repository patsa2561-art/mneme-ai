import { describe, it, expect } from "vitest";
import { buildCrossLayerGraph } from "../cross_layer_graph/index.js";
import { fileCoupling, rankHotspots, hotspotsGauntlet } from "./index.js";

const g = buildCrossLayerGraph([
  { path: "schema.prisma", content: "model Wallet { id Int @id }\nmodel Note { id Int @id }" },
  { path: "money.ts", content: "router.post(\"/pay\", pay);\nexport function pay(){ return charge(); }\nexport function charge(){ return prisma.wallet.create({data:{}}); }" },
  { path: "util.ts", content: "export function fmt(s){ return s.trim(); }" },
]);

describe("hotspots", () => {
  it("gauntlet is 100", () => expect(hotspotsGauntlet().score).toBe(100));

  it("fileCoupling counts cross-layer edges per file", () => {
    const fc = fileCoupling(g);
    expect(fc.find((f) => f.file === "money.ts")!.couplingEdges).toBeGreaterThanOrEqual(1);
    expect(fc.some((f) => f.file === "util.ts" && f.couplingEdges > 0)).toBe(false);
  });

  it("ranks churn × coupling; the file with both is #1 CRITICAL", () => {
    const r = rankHotspots(fileCoupling(g), { "money.ts": 12, "util.ts": 30, "schema.prisma": 0 });
    expect(r[0].file).toBe("money.ts");
    expect(r[0].band).toBe("CRITICAL");
  });

  it("excludes high-churn-but-uncoupled and coupled-but-unchanged files", () => {
    const r = rankHotspots(fileCoupling(g), { "money.ts": 12, "util.ts": 30, "schema.prisma": 0 });
    expect(r.some((h) => h.file === "util.ts")).toBe(false);      // churns but not coupled
    expect(r.some((h) => h.file === "schema.prisma")).toBe(false); // coupled-ish but 0 churn
  });

  it("never throws on garbage", () => {
    expect(() => fileCoupling(null as never)).not.toThrow();
    expect(() => rankHotspots(null as never, null as never)).not.toThrow();
  });
});
