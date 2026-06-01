import { describe, it, expect } from "vitest";
import { maskCode, extractOutline, renderOutline, extractRegion, measureReduction, outlineGauntlet } from "./index.js";

const SRC = `import { x } from "y";

/** Adds two numbers. */
export function add(a: number, b: number): number {
  const s = "a } brace { in a string";
  return a + b; // trailing } comment
}

export class Svc {
  private base = "/api";
  async go(id: string): Promise<string> {
    if (!id) { return ""; }
    return this.base + id;
  }
}

export const T = { a: 1 };
type V = "ok" | "no";
`;

describe("v2.124 OUTLINE — maskCode", () => {
  it("preserves length and newline count", () => {
    const m = maskCode(SRC);
    expect(m.length).toBe(SRC.length);
    expect(m.split("\n").length).toBe(SRC.split("\n").length);
  });
  it("blanks braces inside strings/comments so they don't break counting", () => {
    const m = maskCode(`const s = "}{}{"; // }`);
    expect(m).not.toContain("}{}{");
  });
  it("is total on non-string", () => {
    expect(maskCode(null as never)).toBe("");
  });
});

describe("v2.124 OUTLINE — extractOutline (structural map)", () => {
  const o = extractOutline(SRC);
  it("maps every top-level symbol with line ranges", () => {
    const names = o.symbols.map((s) => s.name);
    expect(names).toContain("add");
    expect(names).toContain("Svc");
    expect(names).toContain("T");
    expect(names).toContain("V");
  });
  it("captures the JSDoc summary", () => {
    expect(o.symbols.find((s) => s.name === "add")?.doc).toMatch(/Adds two numbers/);
  });
  it("gives a function a multi-line body range (brace-matched past string braces)", () => {
    const add = o.symbols.find((s) => s.name === "add")!;
    expect(add.endLine).toBeGreaterThan(add.startLine);
    expect(add.bodyLines).toBeGreaterThan(0);
  });
  it("is deterministic + total", () => {
    expect(JSON.stringify(extractOutline(SRC))).toBe(JSON.stringify(extractOutline(SRC)));
    expect(() => extractOutline(null as never)).not.toThrow();
    expect(extractOutline(null as never).symbolCount).toBe(0);
  });
});

describe("v2.124 OUTLINE — extractRegion (byte-exact)", () => {
  it("a symbol region is a byte-exact substring of the source", () => {
    const r = extractRegion(SRC, "add");
    expect(r.ok).toBe(true);
    expect(SRC.includes(r.text)).toBe(true);
    expect(r.text).toContain("function add");
    expect(r.text).toContain("return a + b;");
  });
  it("a line range returns exactly those lines", () => {
    const lines = SRC.split("\n");
    const r = extractRegion(SRC, "L1-L1");
    expect(r.ok).toBe(true);
    expect(r.text).toBe(lines[0]);
  });
  it("unknown selector → ok:false, never throws", () => {
    expect(extractRegion(SRC, "doesNotExist").ok).toBe(false);
    expect(() => extractRegion(null as never, null as never)).not.toThrow();
  });
});

describe("v2.124 OUTLINE — measured reduction", () => {
  it("outline is materially smaller than the raw source", () => {
    const rendered = renderOutline(extractOutline(SRC), { path: "s.ts" });
    const m = measureReduction(SRC.length, rendered.length);
    expect(m.charsAfter).toBeLessThan(m.charsBefore);
    expect(m.reductionPct).toBeGreaterThan(0);
    expect(m.note).toMatch(/≈chars\/4|labelled/i);
  });
  it("reduction% is exact char math", () => {
    const m = measureReduction(1000, 250);
    expect(m.reductionPct).toBe(75);
  });
});

describe("v2.124 OUTLINE — gauntlet", () => {
  it("outlineGauntlet() = 100", () => {
    const g = outlineGauntlet();
    expect(g.score).toBe(100);
    expect(g.reductionReal).toBe(true);
    expect(g.navigable).toBe(true);
    expect(g.regionByteExact).toBe(true);
    expect(g.regionByLineExact).toBe(true);
    expect(g.maskLengthPreserved).toBe(true);
    expect(g.deterministic).toBe(true);
    expect(g.stable).toBe(true);
  });
});
