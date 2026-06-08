import { describe, it, expect } from "vitest";
import { buildCrossLayerGraph } from "../cross_layer_graph/index.js";
import { onboardingPath, onboardingGauntlet } from "./index.js";

const g = buildCrossLayerGraph([
  { path: "schema.prisma", content: "model User { id Int @id }\nmodel Wallet { id Int @id }\nmodel Log { id Int @id }" },
  { path: "routes.ts", content: "router.post(\"/register\", registerHandler);\nrouter.get(\"/log\", logHandler);" },
  { path: "h.ts", content: "// feature: signup bonus\nexport function registerHandler(req,res){ prisma.user.create({data:{}}); return createWallet(); }\nexport function createWallet(){ return prisma.wallet.create({data:{}}); }\nexport function logHandler(){ return prisma.log.findMany(); }" },
  { path: "PRD.md", content: "## Feature: signup bonus" },
]);

describe("onboarding", () => {
  it("gauntlet is 100", () => expect(onboardingGauntlet().score).toBe(100));

  it("builds a flow per endpoint: handler → callees → tables → rules", () => {
    const p = onboardingPath(g);
    const reg = p.flows.find((f) => f.entry === "/register")!;
    expect(reg.steps).toContain("registerHandler");
    expect(reg.steps).toContain("createWallet");          // followed the call chain
    expect(reg.tables.sort()).toEqual(["User", "Wallet"]);
    expect(reg.rules).toContain("signup bonus");
  });

  it("orders sensitive flows first", () => {
    const p = onboardingPath(g);
    expect(p.flows[0].entry).toBe("/register");           // touches User+Wallet (sensitive) → before /log
    expect(p.flows[0].sensitive).toBe(true);
  });

  it("never throws on garbage", () => {
    expect(() => onboardingPath(null as never)).not.toThrow();
    expect(onboardingPath({ nodes: [], edges: [] }).flows).toEqual([]);
  });
});
