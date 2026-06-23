import { describe, it, expect } from "vitest";
import { buildIndex, discover, discoverBench, discoverGauntlet, DISCOVER_CORPUS_CAPS } from "./index.js";

describe("v3.139 · THE SINGULARITY SEARCH — find the right tool among 900+", () => {
  it("gauntlet is 100", () => expect(discoverGauntlet().score).toBe(100));

  it("★ top-3 ≥98.5% on the labeled EN+Thai corpus, sub-scan", () => {
    const b = discoverBench();
    expect(b.top3).toBeGreaterThanOrEqual(0.985);
    expect(b.top1).toBeGreaterThanOrEqual(0.8);
    expect(b.subScan).toBe(true);
    expect(b.avgTouchedRatio).toBeLessThan(1);
    expect(b.misses).toEqual([]);
  });

  it("finds the right tool from a plain sentence (EN) and a Thai no-space query", () => {
    const idx = buildIndex(DISCOVER_CORPUS_CAPS);
    expect(discover(idx, "is this report safe to send the client", 3).hits[0]!.id).toBe("mneme.vericert.certify");
    expect(discover(idx, "i'm about to send code to gpt blind the secrets", 3).hits[0]!.id).toBe("mneme.rail.traverse");
    expect(discover(idx, "ตรวจว่าจริงไหมข้อมูลนี้", 3).hits.map((h) => h.id)).toContain("mneme.truth.check");
  });

  it("only examines the candidate pocket, not the whole catalog", () => {
    const idx = buildIndex(DISCOVER_CORPUS_CAPS);
    const r = discover(idx, "spawn a sub agent", 3);
    expect(r.touched).toBeLessThan(r.total);
  });

  it("is total on hostile input", () => {
    expect(() => discover(buildIndex([]), "")).not.toThrow();
    expect(() => buildIndex(null as never)).not.toThrow();
    expect(discover(buildIndex([]), "x").hits).toEqual([]);
  });
});
