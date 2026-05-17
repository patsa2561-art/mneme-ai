import { describe, it, expect } from "vitest";
import {
  patternSignature,
  buildCapabilityMap,
  verifyCapabilityMap,
  queryCapability,
  computeMapStats,
  formatMapLine,
  type ProbeRunForMap,
} from "./index.js";

const SECRET = "cartographer-test-secret-997744";

function probe(toolName: string, args: Record<string, unknown>, quality: number, ts = 1, label = "x"): ProbeRunForMap {
  return { toolName, inputLabel: label, inputArgs: args, ok: true, qualityForThisRun: quality, probedAt: ts };
}

describe("v2.19.27 CARTOGRAPHER · patternSignature", () => {
  it("object: sorted key names, lowercased", () => {
    expect(patternSignature({ Name: "x", count: 1 })).toBe("obj:count,name");
    expect(patternSignature({ count: 1, name: "x" })).toBe("obj:count,name");
  });
  it("empty object distinguished", () => {
    expect(patternSignature({})).toBe("obj:empty");
  });
  it("array: bucketed by size", () => {
    expect(patternSignature([])).toBe("arr:empty");
    expect(patternSignature([1, 2])).toBe("arr:lensmall");
    expect(patternSignature(new Array(20).fill(0))).toBe("arr:lenmed");
    expect(patternSignature(new Array(100).fill(0))).toBe("arr:lenlarge");
  });
  it("scalar types distinguished", () => {
    expect(patternSignature("hi")).toBe("str:lensmall");
    expect(patternSignature("x".repeat(50))).toBe("str:lenlarge");
    expect(patternSignature(42)).toBe("number");
    expect(patternSignature(null)).toBe("null");
  });
});

describe("v2.19.27 CARTOGRAPHER · buildCapabilityMap (aggregation)", () => {
  it("groups probes by (tool, patternSig); EWMA merges multiple probes", () => {
    const m = buildCapabilityMap({
      probes: [
        probe("mneme.x", { a: 1 }, 0.5, 1),
        probe("mneme.x", { a: 2 }, 1.0, 2),    // same pattern obj:a -> EWMA
        probe("mneme.x", { b: 1 }, 0.8, 3),    // different pattern obj:b
        probe("mneme.y", { a: 1 }, 0.3, 4),    // different tool
      ],
      builtAt: 0,
      blendWeight: 0.5,
      secret: SECRET,
    });
    // 3 unique cells: (x, obj:a), (x, obj:b), (y, obj:a)
    expect(m.cells.length).toBe(3);
    const xa = m.cells.find((c) => c.toolName === "mneme.x" && c.patternSig === "obj:a")!;
    expect(xa.sampleCount).toBe(2);
    // EWMA with w=0.5: start 0.5 then blend with 1.0 -> 0.75
    expect(xa.quality).toBeCloseTo(0.75, 5);
  });

  it("cells sorted by patternSig asc, quality desc, toolName asc", () => {
    const m = buildCapabilityMap({
      probes: [
        probe("c", { z: 1 }, 0.5, 1),
        probe("a", { a: 1 }, 0.9, 2),
        probe("b", { a: 1 }, 0.7, 3),
      ],
      builtAt: 0,
      secret: SECRET,
    });
    // obj:a then obj:z; within obj:a, quality desc -> a (0.9) before b (0.7)
    expect(m.cells.map((c) => `${c.patternSig}/${c.toolName}`)).toEqual([
      "obj:a/a", "obj:a/b", "obj:z/c",
    ]);
  });

  it("HMAC sig verifies; rejects tamper", () => {
    const m = buildCapabilityMap({ probes: [probe("x", {}, 0.5)], builtAt: 0, secret: SECRET });
    expect(verifyCapabilityMap(m, SECRET)).toBe(true);
    expect(verifyCapabilityMap({ ...m, totalProbes: 999 }, SECRET)).toBe(false);
  });

  it("MEASURED 100% determinism: same input -> same map sig (30 trials)", () => {
    const input = {
      probes: [probe("x", { a: 1 }, 0.5, 1), probe("x", { a: 2 }, 0.7, 2)],
      builtAt: 1_000_000,
      secret: SECRET,
    };
    const firstSig = buildCapabilityMap(input).sig;
    let allEqual = true;
    for (let i = 0; i < 30; i++) {
      if (buildCapabilityMap(input).sig !== firstSig) { allEqual = false; break; }
    }
    expect(allEqual).toBe(true);
  });
});

describe("v2.19.27 CARTOGRAPHER · queryCapability (REFLEX's entry point)", () => {
  it("returns tools sorted by quality desc for matching pattern", () => {
    const m = buildCapabilityMap({
      probes: [
        probe("low.tool", { a: 1 }, 0.3),
        probe("high.tool", { a: 1 }, 0.9),
        probe("mid.tool", { a: 1 }, 0.6),
      ],
      builtAt: 0,
      secret: SECRET,
    });
    const out = queryCapability({ map: m, args: { a: 1 } });
    expect(out.map((c) => c.toolName)).toEqual(["high.tool", "mid.tool", "low.tool"]);
  });

  it("minQuality threshold filters", () => {
    const m = buildCapabilityMap({
      probes: [probe("x", { a: 1 }, 0.3), probe("y", { a: 1 }, 0.9)],
      builtAt: 0,
      secret: SECRET,
    });
    const out = queryCapability({ map: m, args: { a: 1 }, minQuality: 0.5 });
    expect(out.length).toBe(1);
    expect(out[0]!.toolName).toBe("y");
  });

  it("topN respected", () => {
    const m = buildCapabilityMap({
      probes: [probe("a", {}, 0.9), probe("b", {}, 0.8), probe("c", {}, 0.7)],
      builtAt: 0,
      secret: SECRET,
    });
    const out = queryCapability({ map: m, args: {}, topN: 2 });
    expect(out.length).toBe(2);
  });

  it("unknown pattern -> empty result", () => {
    const m = buildCapabilityMap({
      probes: [probe("x", { a: 1 }, 0.5)],
      builtAt: 0,
      secret: SECRET,
    });
    expect(queryCapability({ map: m, args: { totally: "different" } })).toEqual([]);
  });
});

describe("v2.19.27 CARTOGRAPHER · stats + formatter", () => {
  it("computeMapStats reports totals + meanQuality + highQ + singleProbe", () => {
    const m = buildCapabilityMap({
      probes: [
        probe("a", {}, 0.9), // highQ + single
        probe("b", { x: 1 }, 0.5),
        probe("c", { y: 1 }, 0.8), // highQ + single
      ],
      builtAt: 0,
      secret: SECRET,
    });
    const s = computeMapStats(m);
    expect(s.totalCells).toBe(3);
    expect(s.uniqueTools).toBe(3);
    expect(s.highQualityCells).toBe(2);
    expect(s.singleProbeCells).toBe(3);
    expect(s.meanQuality).toBeCloseTo((0.9 + 0.5 + 0.8) / 3, 5);
  });

  it("formatMapLine includes cell + tool + pattern counts + meanQ", () => {
    const m = buildCapabilityMap({ probes: [probe("x", {}, 0.5)], builtAt: 0, secret: SECRET });
    const line = formatMapLine(computeMapStats(m));
    expect(line).toContain("CARTOGRAPHER");
    expect(line).toContain("cells");
    expect(line).toContain("meanQ");
  });
});
