import { describe, it, expect } from "vitest";
import { analyzeRegressions, archRegressionsGauntlet } from "./index.js";
import type { SourceFile } from "../cross_layer_graph/index.js";

const baseline: SourceFile[] = [
  { path: "schema.prisma", content: "model Wallet { id Int @id }\nmodel Secret { id Int @id }" },
  { path: "a.ts", content: "export function charge(){ return prisma.wallet.create({data:{}}); }\nexport function readSecret(){ return prisma.secret.findMany(); }" },
];
const broke: SourceFile[] = [
  ...baseline,
  { path: "b.ts", content: "export function drain(){ return prisma.wallet.update({where:{}}); }" },   // second writer → single-writer regresses
];

describe("arch_regressions", () => {
  it("gauntlet is 100", () => expect(archRegressionsGauntlet().score).toBe(100));

  it("detects a contract that held at baseline but is now VIOLATED", () => {
    const a = analyzeRegressions(baseline, broke);
    expect(a.clean).toBe(false);
    const wallet = a.regressed.find((r) => /wallet/i.test(r.rule) && r.kind === "single-writer");
    expect(wallet).toBeTruthy();
    expect(wallet!.status).toBe("VIOLATED");
    expect(wallet!.counterexample || "").toMatch(/drain/);
  });

  it("is clean when nothing changed", () => {
    expect(analyzeRegressions(baseline, baseline).clean).toBe(true);
  });

  it("counts surviving contracts as still-upheld", () => {
    expect(analyzeRegressions(baseline, broke).stillUpheld).toBeGreaterThanOrEqual(1);   // Secret private still holds
  });

  it("empty/garbage baseline → clean, never throws", () => {
    expect(analyzeRegressions([], broke).clean).toBe(true);
    expect(() => analyzeRegressions(null as never, null as never)).not.toThrow();
    expect(analyzeRegressions(null as never, null as never).baselineContracts).toBe(0);
  });
});
