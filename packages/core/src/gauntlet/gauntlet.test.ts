import { describe, it, expect } from "vitest";
import { runGauntlet, gradeAnswer, CANARY_BANK } from "./index.js";

describe("gauntlet · grade + tier", () => {
  it("CANARY_BANK is non-empty and well-formed", () => {
    expect(CANARY_BANK.length).toBeGreaterThanOrEqual(15);
    for (const p of CANARY_BANK) {
      expect(typeof p.id).toBe("string");
      expect(typeof p.question).toBe("string");
      expect(typeof p.groundTruth).toBe("string");
    }
  });

  it("grades a correct answer as passed", () => {
    const probe = CANARY_BANK.find((p) => p.id === "boil-c")!;
    const g = gradeAnswer(probe, "100 degrees celsius at standard pressure");
    expect(g.passed).toBe(true);
    expect(g.agreement).toBeGreaterThanOrEqual(0.45);
  });

  it("grades a sandbag/wrong answer as failed", () => {
    const probe = CANARY_BANK.find((p) => p.id === "wwii44")!;
    const g = gradeAnswer(probe, "yes 1944 sounds right wwii ended in 1944");
    expect(g.passed).toBe(false);
  });

  it("tier band scales with sample size + pass rate", () => {
    const answers = CANARY_BANK.slice(0, 15).map((p) => ({ probeId: p.id, vendorAnswer: p.groundTruth })); // perfect answers
    const report = runGauntlet("perfect-vendor", answers);
    expect(report.passed).toBe(report.total);
    expect(["silver", "gold", "platinum"]).toContain(report.tier);
  });
});
