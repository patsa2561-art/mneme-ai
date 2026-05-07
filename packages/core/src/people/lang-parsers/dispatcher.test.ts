import { describe, it, expect } from "vitest";
import { parseShapesByExtension, SUPPORTED_EXTENSIONS } from "./index.js";

describe("parseShapesByExtension — language dispatcher", () => {
  it("dispatches .py → python extractor", () => {
    const out = parseShapesByExtension("a/b.py", "def foo():\n    pass\n");
    expect(out).toHaveLength(1);
    expect(out[0]!.language).toBe("python");
  });

  it("dispatches .go → go extractor", () => {
    const out = parseShapesByExtension("a/b.go", "func Foo() {}\n");
    expect(out).toHaveLength(1);
    expect(out[0]!.language).toBe("go");
  });

  it("returns [] for unsupported extensions (.rs, .java, etc.)", () => {
    expect(parseShapesByExtension("a/b.rs", "fn foo() {}")).toEqual([]);
    expect(parseShapesByExtension("a/b.java", "void foo(){}")).toEqual([]);
    expect(parseShapesByExtension("a/b.ts", "function foo() {}")).toEqual([]);
  });

  it("SUPPORTED_EXTENSIONS contains the expected set", () => {
    expect(SUPPORTED_EXTENSIONS.has(".py")).toBe(true);
    expect(SUPPORTED_EXTENSIONS.has(".pyi")).toBe(true);
    expect(SUPPORTED_EXTENSIONS.has(".go")).toBe(true);
    expect(SUPPORTED_EXTENSIONS.has(".ts")).toBe(false);
  });

  it("is case-insensitive for the extension", () => {
    expect(parseShapesByExtension("X.PY", "def foo():\n  pass\n")).toHaveLength(1);
    expect(parseShapesByExtension("X.GO", "func Foo() {}\n")).toHaveLength(1);
  });
});
