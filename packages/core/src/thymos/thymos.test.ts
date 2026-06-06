import { describe, it, expect } from "vitest";
import { thymosGauntlet, readAffect, salience, strengthAt, imprint, attract, bondIndex } from "./index.js";
const DAY = 86_400_000, T0 = 1_000_000_000_000;
describe("THYMOS — the affective core", () => {
  it("MEASURED: thymosGauntlet = 100", () => { const g = thymosGauntlet(); if (g.score !== 100) console.error(g.checks.filter((c) => !c.pass)); expect(g.score).toBe(100); });
  it("a meaningful memory outlives a trivial one (Thai affect)", () => {
    const hi = imprint("a", "เราตกลงสถาปัตยกรรมนี้กัน สำคัญมาก", { nowMs: T0, consequence: 0.9, valence: 0.9 });
    const lo = imprint("b", "listed the folder", { nowMs: T0 });
    const later = T0 + 60 * DAY;
    expect(strengthAt(hi, later)).toBeGreaterThan(strengthAt(lo, later));
    expect(salience(hi)).toBeGreaterThan(salience(lo));
  });
  it("the core attracts what matches its vision", () => {
    const a = attract("local-first trust + memory for AI agents", ["signed memory for agents", "weekend flight deals"]);
    expect(a[0].item).toContain("memory"); expect(a[0].pulled).toBe(true);
    expect(a.find((x) => x.item.includes("flight"))!.pulled).toBe(false);
  });
  it("bond index is a measurable 0..100", () => {
    const b = bondIndex([imprint("x", "thank you, brilliant", { nowMs: T0, valence: 0.9, consequence: 0.6 })], T0);
    expect(b).toBeGreaterThanOrEqual(0); expect(b).toBeLessThanOrEqual(100);
  });
});
