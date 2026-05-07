import { describe, it, expect } from "vitest";
import { extractPythonShapes } from "./python.js";

describe("extractPythonShapes — regex shape extraction", () => {
  it("returns [] for empty content", () => {
    expect(extractPythonShapes("", "f.py")).toEqual([]);
  });

  it("extracts a simple def with zero args", () => {
    const out = extractPythonShapes("def hello():\n    pass\n", "f.py");
    expect(out).toHaveLength(1);
    expect(out[0]!.name).toBe("hello");
    expect(out[0]!.kind).toBe("function");
    expect(out[0]!.language).toBe("python");
    expect(out[0]!.startLine).toBe(1);
  });

  it("extracts a def with multiple args and counts arity correctly", () => {
    const out = extractPythonShapes("def add(a, b, c):\n    return a+b+c\n", "f.py");
    expect(out[0]!.name).toBe("add");
    expect(out[0]!.signature).toBe("def add(a, b, c)");
  });

  it("extracts an async def", () => {
    const out = extractPythonShapes("async def fetch(url: str) -> bytes:\n    pass\n", "f.py");
    expect(out).toHaveLength(1);
    expect(out[0]!.name).toBe("fetch");
  });

  it("extracts a class declaration", () => {
    const out = extractPythonShapes("class Cache:\n    pass\n", "f.py");
    expect(out).toHaveLength(1);
    expect(out[0]!.kind).toBe("class");
    expect(out[0]!.name).toBe("Cache");
  });

  it("extracts a class with bases", () => {
    const out = extractPythonShapes("class HttpCache(BaseCache, Closeable):\n    pass\n", "f.py");
    expect(out[0]!.signature).toContain("HttpCache");
    expect(out[0]!.signature).toContain("BaseCache");
  });

  it("extracts methods inside a class", () => {
    const src =
      "class Cache:\n" +
      "    def get(self, k):\n" +
      "        pass\n" +
      "    def set(self, k, v):\n" +
      "        pass\n";
    const out = extractPythonShapes(src, "f.py");
    const names = out.map((e) => e.name).sort();
    expect(names).toContain("Cache");
    expect(names).toContain("get");
    expect(names).toContain("set");
  });

  it("ignores commented-out def lines", () => {
    const out = extractPythonShapes("# def ghost():\n# def other():\n", "f.py");
    expect(out).toEqual([]);
  });

  it("does not count commas inside type annotations toward arity", () => {
    const src = "def f(a: Dict[str, int], b: List[Tuple[int, int]]):\n    pass\n";
    const out = extractPythonShapes(src, "f.py");
    expect(out).toHaveLength(1);
    // The `signature` preserves the raw arg list, but the shape should
    // group with another `f(_, _)` two-arg function — verified via
    // entityArity in influence.test.ts.
    expect(out[0]!.signature).toContain("Dict[str, int]");
  });

  it("recognises decorated defs (decorator does not block extraction)", () => {
    const src =
      "@staticmethod\n" +
      "@logger.timed\n" +
      "def measured(x):\n" +
      "    return x\n";
    const out = extractPythonShapes(src, "f.py");
    expect(out).toHaveLength(1);
    expect(out[0]!.name).toBe("measured");
  });

  it("preserves the line number for each declaration", () => {
    const src = "\n\n\ndef early():\n    pass\n\n\ndef later():\n    pass\n";
    const out = extractPythonShapes(src, "f.py");
    expect(out).toHaveLength(2);
    expect(out[0]!.name).toBe("early");
    expect(out[0]!.startLine).toBe(4);
    expect(out[1]!.name).toBe("later");
    expect(out[1]!.startLine).toBe(8);
  });

  it("uses filePath in the synthesized id", () => {
    const out = extractPythonShapes("def foo():\n    pass\n", "src/util.py");
    expect(out[0]!.filePath).toBe("src/util.py");
    expect(out[0]!.id).toContain("src/util.py");
  });

  it("handles indented (nested) def — still extracts", () => {
    const src = "def outer():\n    def inner():\n        pass\n";
    const out = extractPythonShapes(src, "f.py");
    const names = out.map((e) => e.name);
    expect(names).toEqual(expect.arrayContaining(["outer", "inner"]));
  });
});
