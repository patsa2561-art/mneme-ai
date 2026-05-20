import { describe, it, expect } from "vitest";
import { readSocratic } from "./index.js";

describe("socratic · feature detection", () => {
  it("detects Promise.all + try/catch around await", () => {
    const code = `async function f() { try { return await Promise.all([a(), b()]); } catch { return null; } }`;
    const r = readSocratic("f.js", code);
    expect(r.features).toContain("uses Promise.all");
    expect(r.features).toContain("try/catch around await");
    expect(r.hypotheses.length).toBe(3);
    expect(r.hypotheses[0]!.rank).toBe(1);
  });

  it("falls back to general hypotheses when no features fire", () => {
    const r = readSocratic("f.js", "var x = 1;");
    expect(r.hypotheses.length).toBe(3);
  });

  it("always returns exactly 3 ranked hypotheses", () => {
    const code = `
      const m = new Map();
      function f(a = 1) { if (!a) return; const x = a ? 'yes' : 'no'; return /test/.test(x); }
    `;
    const r = readSocratic("f.js", code);
    expect(r.hypotheses.length).toBe(3);
    expect(r.hypotheses.map((h) => h.rank)).toEqual([1, 2, 3]);
  });
});
