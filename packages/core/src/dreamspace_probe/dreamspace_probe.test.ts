import { describe, it, expect } from "vitest";
import {
  latencyScore,
  outputShapeEntropy,
  errorRate,
  utilityScore,
  aggregateFitness,
  finaliseProbe,
  runProbeBattery,
  verifyProbeReport,
  formatProbeLine,
  type ProbeRun,
  type ProbeInput,
} from "./index.js";

const SECRET = "probe-test-secret-997744";

function run(opts: Partial<ProbeRun> = {}): ProbeRun {
  return {
    inputLabel: "x",
    inputSource: "synthetic",
    latencyMs: 10,
    ok: true,
    result: { ok: true },
    ...opts,
  };
}

describe("v2.19.27 PROBE · latencyScore", () => {
  it("1.0 when within budget (100ms default)", () => {
    expect(latencyScore(50)).toBe(1.0);
    expect(latencyScore(100)).toBe(1.0);
  });
  it("exponential decay past budget (half at +200ms)", () => {
    expect(latencyScore(300)).toBeCloseTo(0.5, 5);
    expect(latencyScore(500)).toBeCloseTo(0.25, 5);
  });
  it("custom budget + half-life respected", () => {
    expect(latencyScore(50, 30, 20)).toBeCloseTo(Math.pow(0.5, (50 - 30) / 20), 5);
  });
});

describe("v2.19.27 PROBE · outputShapeEntropy", () => {
  it("empty results -> 0", () => {
    expect(outputShapeEntropy([])).toBe(0);
  });
  it("identical shapes -> 0 entropy (flat output)", () => {
    expect(outputShapeEntropy([{ a: 1 }, { a: 2 }, { a: 3 }])).toBe(0);
  });
  it("diverse shapes -> high entropy", () => {
    const ent = outputShapeEntropy([
      { a: 1 }, { b: 1 }, [1, 2, 3], "string", 42, null,
    ]);
    expect(ent).toBeGreaterThan(0.5);
  });
  it("array length buckets distinguish small/med/large", () => {
    const e = outputShapeEntropy([[], [1, 2], new Array(20).fill(0), new Array(200).fill(0)]);
    expect(e).toBeGreaterThan(0.5);
  });
});

describe("v2.19.27 PROBE · errorRate", () => {
  it("zero runs -> 0", () => {
    expect(errorRate([])).toBe(0);
  });
  it("all errors -> 1.0", () => {
    expect(errorRate([run({ ok: false }), run({ ok: false })])).toBe(1.0);
  });
  it("half errors -> 0.5", () => {
    expect(errorRate([run({ ok: true }), run({ ok: false })])).toBe(0.5);
  });
});

describe("v2.19.27 PROBE · utilityScore", () => {
  it("all useful results -> 1.0", () => {
    expect(utilityScore([run({ result: { x: 1 } }), run({ result: "hello" })])).toBe(1.0);
  });
  it("empty / null / undefined treated as useless", () => {
    expect(utilityScore([
      run({ result: null }), run({ result: undefined }),
      run({ result: "" }), run({ result: [] }), run({ result: {} }),
    ])).toBe(0);
  });
  it("errored runs don't count as useful", () => {
    expect(utilityScore([run({ ok: false }), run({ ok: true, result: { x: 1 } })])).toBe(0.5);
  });
});

describe("v2.19.27 PROBE · aggregateFitness (geometric mean of 4 scores)", () => {
  it("all perfect -> 1.0", () => {
    expect(aggregateFitness({ latencyScore: 1, outputEntropy: 1, errorRate: 0, utilityScore: 1 })).toBeCloseTo(1, 5);
  });
  it("any zero (or near-zero) drags geometric mean toward floor", () => {
    // errorRate=1 -> (1-errorRate)=0 -> clamped to FITNESS_MIN=0.001
    // 4th root of (1 * 0.001 * 1 * 1) ≈ 0.178; much lower than balanced 0.5
    const f = aggregateFitness({ latencyScore: 1, outputEntropy: 1, errorRate: 1, utilityScore: 1 });
    expect(f).toBeLessThan(0.2);
    expect(f).toBeLessThan(aggregateFitness({ latencyScore: 0.5, outputEntropy: 0.5, errorRate: 0.5, utilityScore: 0.5 }));
  });
  it("balanced mid -> ~0.5", () => {
    const f = aggregateFitness({ latencyScore: 0.5, outputEntropy: 0.5, errorRate: 0.5, utilityScore: 0.5 });
    expect(f).toBeCloseTo(0.5, 1);
  });
});

describe("v2.19.27 PROBE · finaliseProbe (pure aggregator)", () => {
  it("produces HMAC-signed report with all 4 metrics + fitness", () => {
    const r = finaliseProbe({
      toolName: "mneme.x",
      runs: [run({ latencyMs: 50, result: { a: 1 } }), run({ latencyMs: 70, result: { b: 2 } })],
      probedAt: 1_000_000,
      secret: SECRET,
    });
    expect(r.metrics.latencyScore).toBe(1.0);
    expect(r.metrics.errorRate).toBe(0);
    expect(r.metrics.utilityScore).toBe(1.0);
    expect(r.metrics.outputEntropy).toBeGreaterThan(0);
    expect(verifyProbeReport(r, SECRET)).toBe(true);
  });

  it("counts synthetic + real inputs separately", () => {
    const r = finaliseProbe({
      toolName: "mneme.x",
      runs: [
        run({ inputSource: "synthetic" }), run({ inputSource: "synthetic" }),
        run({ inputSource: "real" }),
      ],
      probedAt: 0,
      secret: SECRET,
    });
    expect(r.syntheticInputs).toBe(2);
    expect(r.realInputs).toBe(1);
    expect(r.totalInputs).toBe(3);
  });

  it("verify rejects tampered fitness", () => {
    const r = finaliseProbe({ toolName: "x", runs: [run()], probedAt: 0, secret: SECRET });
    expect(verifyProbeReport({ ...r, metrics: { ...r.metrics, fitnessScore: 0.99 } }, SECRET)).toBe(false);
  });

  it("MEASURED 100% determinism: same input -> same sig (30 trials)", () => {
    const input = {
      toolName: "mneme.x",
      runs: [run({ latencyMs: 50 }), run({ latencyMs: 70 })],
      probedAt: 1_000_000,
      secret: SECRET,
    };
    const firstSig = finaliseProbe(input).sig;
    let allEqual = true;
    for (let i = 0; i < 30; i++) {
      if (finaliseProbe(input).sig !== firstSig) { allEqual = false; break; }
    }
    expect(allEqual).toBe(true);
  });
});

describe("v2.19.27 PROBE · runProbeBattery (real invoke)", () => {
  it("invokes each input + measures latency + catches errors", async () => {
    const inputs: ProbeInput[] = [
      { label: "axiom:1", source: "synthetic", args: { x: 1 } },
      { label: "axiom:2", source: "synthetic", args: { x: 2 } },
      { label: "real:1", source: "real", args: { x: 3 } },
    ];
    const invoke = async (_t: string, args: Record<string, unknown>) => ({ doubled: (args["x"] as number) * 2 });
    const r = await runProbeBattery({ toolName: "mneme.double", inputs, invoke, secret: SECRET });
    expect(r.runs.length).toBe(3);
    expect(r.runs.every((x) => x.ok)).toBe(true);
    expect(r.syntheticInputs).toBe(2);
    expect(r.realInputs).toBe(1);
    expect(r.metrics.errorRate).toBe(0);
    expect(r.metrics.utilityScore).toBe(1);
  });

  it("captures errors with messages without crashing the battery", async () => {
    const inputs: ProbeInput[] = [{ label: "x", source: "synthetic", args: {} }];
    const invoke = async () => { throw new Error("kaboom"); };
    const r = await runProbeBattery({ toolName: "mneme.broken", inputs, invoke, secret: SECRET });
    expect(r.runs[0]!.ok).toBe(false);
    expect(r.runs[0]!.errorMessage).toBe("kaboom");
    expect(r.metrics.errorRate).toBe(1);
  });

  it("slow tool incurs latency penalty", async () => {
    const inputs: ProbeInput[] = [{ label: "x", source: "synthetic", args: {} }];
    const invoke = async () => {
      await new Promise((res) => setTimeout(res, 250));
      return "done";
    };
    const r = await runProbeBattery({ toolName: "mneme.slow", inputs, invoke, secret: SECRET });
    expect(r.metrics.latencyScore).toBeLessThan(1);
  });
});

describe("v2.19.27 PROBE · formatter", () => {
  it("formatProbeLine includes all 4 metric percentages", () => {
    const r = finaliseProbe({ toolName: "mneme.x", runs: [run()], probedAt: 0, secret: SECRET });
    const line = formatProbeLine(r);
    expect(line).toContain("PROBE mneme.x");
    expect(line).toContain("fitness=");
    expect(line).toContain("lat=");
    expect(line).toContain("ent=");
    expect(line).toContain("err=");
    expect(line).toContain("util=");
  });
});
