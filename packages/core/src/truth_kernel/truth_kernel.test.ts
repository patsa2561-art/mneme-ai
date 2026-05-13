import { describe, it, expect } from "vitest";
import { checkTruth, calibrateWeights, formatTruthKernelPulseLine, type SensorAdapter } from "./index.js";

function makeSensor(id: string, verdict: "TRUE" | "FALSE" | "UNCERTAIN" | "INAPPLICABLE", confidence: number, weight = 1): SensorAdapter {
  return { id, weight, run: () => ({ sensor: id, verdict, confidence }) };
}

describe("v2.6 TRUTH KERNEL · fusion", () => {
  it("two confident TRUE sensors → ACCEPTED with high pTrue", async () => {
    const r = await checkTruth({
      claim: "the sky is blue",
      sensors: [makeSensor("flash", "TRUE", 0.9), makeSensor("apoptosis", "TRUE", 0.85)],
    });
    expect(r.verdict).toBe("ACCEPTED");
    expect(r.pTrue).toBeGreaterThan(0.9);
    expect(r.disagreement).toBeLessThan(0.05);
  });

  it("two confident FALSE sensors → REJECTED with low pTrue", async () => {
    const r = await checkTruth({
      claim: "the sky is green",
      sensors: [makeSensor("flash", "FALSE", 0.9), makeSensor("apoptosis", "FALSE", 0.9)],
    });
    expect(r.verdict).toBe("REJECTED");
    expect(r.pTrue).toBeLessThan(0.1);
  });

  it("conflicting sensors → DISPUTED with high disagreement", async () => {
    const r = await checkTruth({
      claim: "ambiguous claim",
      sensors: [makeSensor("flash", "TRUE", 0.9), makeSensor("apoptosis", "FALSE", 0.9)],
    });
    expect(r.verdict).toBe("DISPUTED");
    expect(r.disagreement).toBeGreaterThan(0.5);
    expect(r.outlierSensor).toBeDefined();
  });

  it("all UNCERTAIN sensors → INCONCLUSIVE", async () => {
    const r = await checkTruth({
      claim: "x",
      sensors: [makeSensor("a", "UNCERTAIN", 0), makeSensor("b", "UNCERTAIN", 0)],
    });
    expect(r.verdict).toBe("INCONCLUSIVE");
    expect(r.pTrue).toBeCloseTo(0.5, 2);
  });

  it("INAPPLICABLE sensors are excluded from fusion", async () => {
    const r = await checkTruth({
      claim: "x",
      sensors: [makeSensor("a", "TRUE", 0.95), makeSensor("b", "INAPPLICABLE", 0)],
    });
    expect(r.verdict).toBe("ACCEPTED");
    expect(r.pTrue).toBeGreaterThan(0.9);
  });

  it("higher-weight sensor dominates the fused verdict", async () => {
    const r = await checkTruth({
      claim: "tie-breaker test",
      sensors: [makeSensor("trustworthy", "TRUE", 0.9, 2.0), makeSensor("flaky", "FALSE", 0.9, 0.2)],
    });
    expect(r.verdict).toBe("ACCEPTED");
    expect(r.pTrue).toBeGreaterThan(0.5);
    expect(r.dominantSensor).toBe("trustworthy");
  });

  it("empty sensor list → INCONCLUSIVE", async () => {
    const r = await checkTruth({ claim: "x", sensors: [] });
    expect(r.verdict).toBe("INCONCLUSIVE");
  });

  it("crashing sensor degrades to UNCERTAIN gracefully", async () => {
    const crashy: SensorAdapter = {
      id: "crashy",
      run: () => { throw new Error("kaboom"); },
    };
    const r = await checkTruth({
      claim: "x",
      sensors: [makeSensor("ok", "TRUE", 0.9), crashy],
    });
    // Crashy sensor is non-informational → ok sensor drives the verdict.
    expect(r.verdict).toBe("ACCEPTED");
    const crashOut = r.sensorOutputs.find((o) => o.sensor === "crashy");
    expect(crashOut?.verdict).toBe("UNCERTAIN");
  });

  it("slow sensor times out without blocking the kernel", async () => {
    const slow: SensorAdapter = {
      id: "slow",
      run: () => new Promise((resolve) => setTimeout(() => resolve({ sensor: "slow", verdict: "TRUE", confidence: 1 }), 200)),
    };
    const r = await checkTruth({
      claim: "x",
      sensors: [makeSensor("fast", "TRUE", 0.9), slow],
      perSensorTimeoutMs: 50,
    });
    const slowOut = r.sensorOutputs.find((o) => o.sensor === "slow");
    expect(slowOut?.verdict).toBe("UNCERTAIN");
    expect(r.verdict).toBe("ACCEPTED"); // fast sensor still drives the verdict
  });
});

describe("v2.6 TRUTH KERNEL · calibration", () => {
  it("perfectly-accurate sensor gets weight 2.0", () => {
    const history = Array.from({ length: 10 }, () => ({ sensor: "perfect", verdictWasCorrect: true }));
    const w = calibrateWeights(history);
    expect(w.get("perfect")).toBe(2.0);
  });

  it("50%-accurate sensor gets weight 1.0", () => {
    const history = [
      ...Array.from({ length: 5 }, () => ({ sensor: "average", verdictWasCorrect: true })),
      ...Array.from({ length: 5 }, () => ({ sensor: "average", verdictWasCorrect: false })),
    ];
    const w = calibrateWeights(history);
    expect(w.get("average")).toBeCloseTo(1.0, 2);
  });

  it("always-wrong sensor gets weight floor 0.1", () => {
    const history = Array.from({ length: 10 }, () => ({ sensor: "wrong", verdictWasCorrect: false }));
    const w = calibrateWeights(history);
    expect(w.get("wrong")).toBe(0.1);
  });

  it("empty history → empty weight map", () => {
    expect(calibrateWeights([]).size).toBe(0);
  });
});

describe("v2.6 TRUTH KERNEL · pulse", () => {
  it("formatTruthKernelPulseLine produces a compact summary", async () => {
    const r = await checkTruth({
      claim: "x",
      sensors: [makeSensor("a", "TRUE", 0.9)],
    });
    const line = formatTruthKernelPulseLine(r);
    expect(line).toContain("TRUTH-KERNEL");
    expect(line).toContain("ACCEPTED");
    expect(line).toContain("pTrue=");
  });
});
