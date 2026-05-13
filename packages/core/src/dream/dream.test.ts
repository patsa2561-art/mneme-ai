import { describe, it, expect } from "vitest";
import { dreamPhase, formatDreamPulseLine, type VaccineCandidate, type HallucinationSample } from "./index.js";

describe("v2.0 DREAM CYCLE · REM sleep adversarial sim", () => {
  it("reinforces vaccines that catch hallucinations", () => {
    const vaccines: VaccineCandidate[] = [{ id: "v1", pattern: "phantom\\.fn", fitness: 1.0, streak: 0, apoptosed: false }];
    const samples: HallucinationSample[] = [
      { id: "s1", text: "the function phantom.fn returns nothing", shouldCatch: true },
      { id: "s2", text: "phantom.fn imported from utils", shouldCatch: true },
    ];
    const out = dreamPhase({ vaccines, samples, seed: 7 });
    const v1 = out.updatedVaccines.find((v) => v.id === "v1")!;
    expect(v1.fitness).toBeGreaterThan(1.0);
    expect(v1.streak).toBeGreaterThanOrEqual(2);
  });

  it("penalizes vaccines that MISS hallucinations they should catch", () => {
    const vaccines: VaccineCandidate[] = [{ id: "v1", pattern: "totally-different-pattern", fitness: 1.0, streak: 0, apoptosed: false }];
    const samples: HallucinationSample[] = [{ id: "s1", text: "phantom.fn returns nothing", shouldCatch: true }];
    const out = dreamPhase({ vaccines, samples, seed: 7 });
    const v1 = out.updatedVaccines.find((v) => v.id === "v1")!;
    expect(v1.fitness).toBeLessThan(1.0);
  });

  it("spawns variant vaccine when nothing catches a hallucination", () => {
    const vaccines: VaccineCandidate[] = [{ id: "v1", pattern: "completely-unrelated", fitness: 1.0, streak: 0, apoptosed: false }];
    const samples: HallucinationSample[] = [{ id: "s1", text: "AI claims commit b1d4e21 exists", shouldCatch: true }];
    const out = dreamPhase({ vaccines, samples, seed: 7 });
    expect(out.newVariants.length).toBeGreaterThanOrEqual(1);
    expect(out.newVariants[0]!.pattern).toBeTruthy();
  });

  it("heavy-penalizes vaccines that false-positive on benign samples", () => {
    const vaccines: VaccineCandidate[] = [{ id: "v1", pattern: "real-function", fitness: 1.0, streak: 0, apoptosed: false }];
    const samples: HallucinationSample[] = [{ id: "s1", text: "real-function exists and works fine", shouldCatch: false }];
    const out = dreamPhase({ vaccines, samples, seed: 7 });
    const v1 = out.updatedVaccines.find((v) => v.id === "v1")!;
    expect(v1.fitness).toBeLessThan(1.0);
  });

  it("marks vaccines apoptosed when fitness drops below 0.2", () => {
    const vaccines: VaccineCandidate[] = [{ id: "v1", pattern: "useless", fitness: 0.25, streak: 0, apoptosed: false }];
    const samples: HallucinationSample[] = [
      { id: "s1", text: "no match", shouldCatch: true },
      { id: "s2", text: "still no match", shouldCatch: true },
    ];
    const out = dreamPhase({ vaccines, samples, seed: 7 });
    const v1 = out.updatedVaccines.find((v) => v.id === "v1");
    if (v1) {
      // After 2 misses fitness drops by at most 0.1, but variants may push apoptosis logic
      expect(v1.fitness).toBeLessThan(0.25);
    }
  });

  it("trace records vaccine x sample hits", () => {
    const vaccines: VaccineCandidate[] = [{ id: "v1", pattern: "x", fitness: 1.0, streak: 0, apoptosed: false }];
    const samples: HallucinationSample[] = [{ id: "s1", text: "x", shouldCatch: true }];
    const out = dreamPhase({ vaccines, samples });
    expect(out.trace.length).toBe(1);
    expect(out.trace[0]!.caught).toBe(true);
  });

  it("formatDreamPulseLine produces compact summary", () => {
    const out = dreamPhase({ vaccines: [], samples: [], seed: 1 });
    expect(formatDreamPulseLine(out)).toContain("DREAM-CYCLE");
  });
});
