import { describe, it, expect } from "vitest";
import { buildStele, steleDelta, verifyStele, steleMerkleRoot, steleGauntlet, type SteleEntry } from "./index.js";

const base: SteleEntry[] = [
  { name: "mneme.a", version: "1.0.0", summary: "alpha" },
  { name: "mneme.b", version: "1.0.0", summary: "beta" },
  { name: "mneme.c", version: "1.0.0", summary: "gamma" },
];

describe("v2.137 · STELE — signed, merkle, delta-syncable capability inscription", () => {
  it("gauntlet is 100", () => {
    expect(steleGauntlet().score).toBe(100);
  });

  it("root is a 64-hex merkle fingerprint, order-independent", () => {
    const r = buildStele(base).root;
    expect(r).toMatch(/^[0-9a-f]{64}$/);
    expect(buildStele([...base].reverse()).root).toBe(r);
  });

  it("editing OR adding a capability changes the root (tamper-evident)", () => {
    const r0 = buildStele(base).root;
    expect(buildStele(base.map((e) => e.name === "mneme.b" ? { ...e, summary: "edited" } : e)).root).not.toBe(r0);
    expect(buildStele([...base, { name: "mneme.d", summary: "new" }]).root).not.toBe(r0);
  });

  it("a held-up-to-date agent gets a 0-token delta (roots match)", () => {
    const s = buildStele(base);
    const held = Object.fromEntries(s.leaves.map((l) => [l.name, l.hash]));
    const d = steleDelta(base, s.root, held);
    expect(d.upToDate).toBe(true);
    expect(d.deltaTokenEstimate).toBe(0);
    expect(d.added.length + d.changed.length + d.removed.length).toBe(0);
  });

  it("delta returns ONLY added/changed/removed (O(delta), not O(all))", () => {
    const s0 = buildStele(base);
    const held = Object.fromEntries(s0.leaves.map((l) => [l.name, l.hash]));
    const current = [
      { name: "mneme.b", version: "1.0.0", summary: "beta v2" }, // changed
      { name: "mneme.c", version: "1.0.0", summary: "gamma" },   // unchanged
      { name: "mneme.d", version: "2.0.0", summary: "delta" },   // added
      // mneme.a removed
    ];
    const d = steleDelta(current, s0.root, held);
    expect(d.added.map((e) => e.name)).toContain("mneme.d");
    expect(d.changed.map((e) => e.name)).toContain("mneme.b");
    expect(d.removed).toContain("mneme.a");
    // the unchanged 'mneme.c' is NOT re-sent
    expect(d.added.concat(d.changed).map((e) => e.name)).not.toContain("mneme.c");
    expect(d.deltaTokenEstimate).toBeLessThan(d.fullTokenEstimate);
  });

  it("detects a tampered held leaf (wrong hash for an unchanged entry)", () => {
    const s = buildStele(base);
    const held = { ...Object.fromEntries(s.leaves.map((l) => [l.name, l.hash])), "mneme.c": "deadbeef" };
    const d = steleDelta(base, "stale", held);
    expect(d.changed.map((e) => e.name)).toContain("mneme.c");
  });

  it("verifyStele catches a stale/tampered held root", () => {
    const r0 = buildStele(base).root;
    expect(verifyStele(base, r0).ok).toBe(true);
    expect(verifyStele([...base, { name: "mneme.z", summary: "z" }], r0).ok).toBe(false);
  });

  it("is deterministic + total on hostile input", () => {
    expect(() => buildStele(null as never)).not.toThrow();
    expect(() => steleDelta(undefined as never, null as never, null as never)).not.toThrow();
    expect(() => steleMerkleRoot(null as never)).not.toThrow();
    expect(buildStele([]).root).toBe("");
  });
});
