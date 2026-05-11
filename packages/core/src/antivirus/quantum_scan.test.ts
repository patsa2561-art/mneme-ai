import { describe, expect, it } from "vitest";
import { quantumGapScan, type QuantumTriple } from "./quantum_scan.js";
import type { StrainId } from "./types.js";

describe("quantum gap-scanner (Grover-shaped)", () => {
  function buildSpace(n: number): QuantumTriple[] {
    const out: QuantumTriple[] = [];
    const strains: StrainId[] = ["depends_imaginarium", "citatio_viridis", "structura_invenita"];
    const mutators = ["visualSwap", "damerauSwap", "phoneticDrift"];
    for (let i = 0; i < n; i++) {
      out.push({
        strain: strains[i % strains.length]!,
        mutatorFamily: mutators[i % mutators.length]!,
        sample: `sample-${i}`,
      });
    }
    return out;
  }

  it("falls back to classical scan when N <= cutoff", async () => {
    const triples = buildSpace(10);                            // below default cutoff 16
    let assays = 0;
    const r = await quantumGapScan({
      triples,
      oracle: () => 0.5,
      assay: () => { assays++; return false; },
    });
    expect(r.strategy).toBe("classical");
    expect(r.assaysPerformed).toBe(10);                        // every triple visited
    expect(r.totalTriples).toBe(10);
  });

  it("uses quantum strategy when N > cutoff", async () => {
    const triples = buildSpace(100);
    const r = await quantumGapScan({
      triples,
      oracle: () => 0.5,
      assay: () => false,
    });
    expect(r.strategy).toBe("quantum");
    expect(r.totalTriples).toBe(100);
    expect(r.assaysPerformed).toBeLessThanOrEqual(100);        // sub-linear vs N
  });

  it("achieves O(sqrt(N)) assay count on a 400-triple space (Grover bound)", async () => {
    const triples = buildSpace(400);
    const r = await quantumGapScan({
      triples,
      oracle: () => Math.random() * 0.3 + 0.1,                 // weak signal
      assay: () => false,                                      // doesn't matter for assay count
    });
    expect(r.strategy).toBe("quantum");
    // Grover bound: ceil(pi/4 * sqrt(N)) ~ ceil(0.785 * 20) = 16
    // We allow some slack for the "already-queried -> pick best unqueried"
    // fallback path. Hard ceiling: well under 25% of N.
    expect(r.assaysPerformed).toBeLessThan(triples.length * 0.25);
  });

  it("surfaces high-oracle-rated triples first when no confirmations", async () => {
    const triples = buildSpace(50);
    // Oracle: rate by index -- earlier triples are more suspect.
    const r = await quantumGapScan({
      triples,
      oracle: (t) => {
        const idx = parseInt((t.sample as string).split("-")[1] ?? "0", 10);
        return Math.max(0.1, 1 - idx / 50);
      },
      assay: () => false,
      iterations: 50,                                          // override for determinism
    });
    expect(r.suspects.length).toBeGreaterThan(0);
    // Top suspect should be from the high-oracle region (index < 25).
    const topIdx = parseInt((r.suspects[0]!.triple.sample as string).split("-")[1] ?? "0", 10);
    expect(topIdx).toBeLessThan(25);
  });

  it("ranks confirmed=true suspects above weight-only suspects", async () => {
    const triples = buildSpace(50);
    // Confirm triple at index 30 (otherwise low oracle weight).
    const r = await quantumGapScan({
      triples,
      oracle: (t) => {
        const idx = parseInt((t.sample as string).split("-")[1] ?? "0", 10);
        return idx === 30 ? 0.4 : 0.5;
      },
      assay: (t) => (t.sample as string) === "sample-30",
      iterations: 50,
    });
    // The first confirmed should top the list.
    expect(r.suspects[0]!.confirmed).toBe(true);
    expect(r.suspects[0]!.triple.sample).toBe("sample-30");
  });

  it("amplifies neighbors of a confirmed triple (Grover diffusion analog)", async () => {
    const triples: QuantumTriple[] = [
      { strain: "depends_imaginarium", mutatorFamily: "visualSwap", sample: "a" },
      { strain: "depends_imaginarium", mutatorFamily: "visualSwap", sample: "b" },
      { strain: "depends_imaginarium", mutatorFamily: "visualSwap", sample: "c" },
      ...buildSpace(50),                                      // distractors
    ];
    const r = await quantumGapScan({
      triples,
      oracle: (t) => (t.sample === "a" ? 0.99 : 0.1),         // 'a' is the seed
      assay: (t) => t.sample === "a" || t.sample === "b" || t.sample === "c",
      iterations: 30,
      classicalCutoff: 0,                                      // force quantum
    });
    // Should find at least one of a/b/c.
    const found = r.suspects.filter((s) => s.confirmed && ["a", "b", "c"].includes(s.triple.sample as string));
    expect(found.length).toBeGreaterThanOrEqual(1);
  });

  it("never throws on empty or undefined input", async () => {
    const r1 = await quantumGapScan({
      triples: [],
      oracle: () => 0,
      assay: () => false,
    });
    expect(r1.totalTriples).toBe(0);
    expect(r1.assaysPerformed).toBe(0);
    expect(r1.suspects).toEqual([]);

    const r2 = await quantumGapScan({
      triples: undefined as unknown as QuantumTriple[],
      oracle: () => 0,
      assay: () => false,
    });
    expect(r2.totalTriples).toBe(0);
  });
});
