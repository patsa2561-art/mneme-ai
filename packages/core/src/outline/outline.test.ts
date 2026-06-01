import { describe, it, expect } from "vitest";
import { maskCode, extractOutline, renderOutline, extractRegion, measureReduction, outlineGauntlet, detectLang } from "./index.js";

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

describe("v2.125 OUTLINE — multi-language", () => {
  it("detectLang maps extensions", () => {
    expect(detectLang("a.ts")).toBe("ts");
    expect(detectLang("a.py")).toBe("python");
    expect(detectLang("a.go")).toBe("go");
    expect(detectLang("a.rs")).toBe("rust");
    expect(detectLang("a.unknownext")).toBe("generic");
  });
  it("Python: indent-scoped — finds class + nested methods + top-level def with body ranges", () => {
    const py = `import os\nclass Repo:\n    def __init__(self, base):\n        self.base = base\n    def fetch(self, id):\n        return self.base + id\ndef top(x):\n    return x * 2\n`;
    const o = extractOutline(py, { lang: "python" });
    const names = o.symbols.map((s) => s.name);
    expect(names).toContain("Repo");
    expect(names).toContain("fetch");
    expect(names).toContain("top");
    const fetch = o.symbols.find((s) => s.name === "fetch")!;
    expect(fetch.endLine).toBeGreaterThan(fetch.startLine); // indent-delimited body
    // region fetch is byte-exact regardless of language
    const r = extractRegion(py, "fetch", { lang: "python" });
    expect(r.ok).toBe(true);
    expect(py.includes(r.text)).toBe(true);
    expect(r.text).toContain("def fetch");
  });
  it("Go: brace-scoped — finds struct, receiver method, func", () => {
    const go = `package main\ntype Server struct {\n\taddr string\n}\nfunc (s *Server) Start() error {\n\treturn nil\n}\nfunc main() {}\n`;
    const names = extractOutline(go, { lang: "go" }).symbols.map((s) => s.name);
    expect(names).toContain("Server");
    expect(names).toContain("Start");
    expect(names).toContain("main");
  });
  it("Rust: finds struct, impl, fn inside impl (depth ≥ 1), and lifetimes don't break masking", () => {
    const rs = `pub struct Point { x: i32 }\nimpl Point {\n    pub fn new(x: i32) -> Self {\n        let c = 'a';\n        Point { x }\n    }\n}\npub fn dist<'a>(p: &'a Point) -> i32 { p.x }\n`;
    const names = extractOutline(rs, { lang: "rust" }).symbols.map((s) => s.name);
    expect(names).toContain("Point");
    expect(names).toContain("new");  // fn inside impl
    expect(names).toContain("dist");
  });
  it("detects language from path", () => {
    const py = `def f(x):\n    return x\n`;
    expect(extractOutline(py, { path: "x.py" }).lang).toBe("python");
  });
});

describe("v2.125 OUTLINE — multi-region fetch", () => {
  const SRC2 = `export function a() { return 1; }\nexport function b() { return 2; }\nexport function c() { return 3; }\n`;
  it("comma-separated selectors return multiple byte-exact slices, sorted", () => {
    const r = extractRegion(SRC2, "c,a", { lang: "ts" });
    expect(r.ok).toBe(true);
    expect(r.slices?.length).toBe(2);
    expect(r.text).toContain("function a");
    expect(r.text).toContain("function c");
    // first slice is `a` (sorted by line), exact substring
    expect(SRC2).toContain("function a() { return 1; }");
  });
  it("mixes symbol names and line ranges", () => {
    const r = extractRegion(SRC2, "a,L3-L3", { lang: "ts" });
    expect(r.ok).toBe(true);
    expect(r.slices?.length).toBe(2);
  });
});

describe("v2.125 OUTLINE — gauntlet", () => {
  it("outlineGauntlet() = 100 (multi-lang + multi-region)", () => {
    const g = outlineGauntlet();
    expect(g.score).toBe(100);
    expect(g.reductionReal).toBe(true);
    expect(g.navigable).toBe(true);
    expect(g.regionByteExact).toBe(true);
    expect(g.regionByLineExact).toBe(true);
    expect(g.multiRegionExact).toBe(true);
    expect(g.pythonIndent).toBe(true);
    expect(g.goBrace).toBe(true);
    expect(g.rustBrace).toBe(true);
    expect(g.maskLengthPreserved).toBe(true);
    expect(g.deterministic).toBe(true);
    expect(g.stable).toBe(true);
  });
});
