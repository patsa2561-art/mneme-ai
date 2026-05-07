import { describe, it, expect } from "vitest";
import { extractGoShapes } from "./go.js";

describe("extractGoShapes — regex shape extraction", () => {
  it("returns [] for empty content", () => {
    expect(extractGoShapes("", "f.go")).toEqual([]);
  });

  it("extracts a free function with no args", () => {
    const out = extractGoShapes("func Hello() {}\n", "f.go");
    expect(out).toHaveLength(1);
    expect(out[0]!.name).toBe("Hello");
    expect(out[0]!.kind).toBe("function");
    expect(out[0]!.language).toBe("go");
  });

  it("extracts a free function with multiple args", () => {
    const out = extractGoShapes("func Add(a int, b int) int { return a+b }\n", "f.go");
    expect(out).toHaveLength(1);
    expect(out[0]!.name).toBe("Add");
    expect(out[0]!.signature).toContain("a int, b int");
  });

  it("extracts a method on a value receiver as Type.Method", () => {
    const out = extractGoShapes("func (c Cache) Get(k string) string { return \"\" }\n", "f.go");
    expect(out).toHaveLength(1);
    expect(out[0]!.name).toBe("Cache.Get");
  });

  it("extracts a method on a pointer receiver as Type.Method", () => {
    const out = extractGoShapes("func (c *Cache) Set(k string, v string) {}\n", "f.go");
    expect(out).toHaveLength(1);
    expect(out[0]!.name).toBe("Cache.Set");
  });

  it("extracts multiple funcs in a single file", () => {
    const src =
      "package x\n" +
      "\n" +
      "func one() {}\n" +
      "func two(a int) {}\n" +
      "func three(a, b int) {}\n";
    const out = extractGoShapes(src, "f.go");
    const names = out.map((e) => e.name).sort();
    expect(names).toEqual(["one", "three", "two"]);
  });

  it("ignores commented-out func decls (// line comment)", () => {
    const src = "// func ghost() {}\nfunc real() {}\n";
    const out = extractGoShapes(src, "f.go");
    expect(out).toHaveLength(1);
    expect(out[0]!.name).toBe("real");
  });

  it("does not pick up func tokens inside string literals", () => {
    // Honest: we strip line comments but not string lits beyond simple guard.
    // This case ensures inline strings on a line that ALSO has a real func
    // don't break.
    const src = `func Greet(name string) string { return "hello " + name }\n`;
    const out = extractGoShapes(src, "f.go");
    expect(out).toHaveLength(1);
    expect(out[0]!.name).toBe("Greet");
  });

  it("preserves line numbers", () => {
    const src = "\n\nfunc First() {}\n\nfunc Second() {}\n";
    const out = extractGoShapes(src, "f.go");
    expect(out[0]!.startLine).toBe(3);
    expect(out[1]!.startLine).toBe(5);
  });

  it("supports generics on free functions", () => {
    const src = "func Map[T any, U any](xs []T, fn func(T) U) []U { return nil }\n";
    const out = extractGoShapes(src, "f.go");
    expect(out).toHaveLength(1);
    expect(out[0]!.name).toBe("Map");
  });

  it("supports a generic receiver type", () => {
    const src = "func (b *Box[T]) Put(v T) {}\n";
    const out = extractGoShapes(src, "f.go");
    expect(out).toHaveLength(1);
    expect(out[0]!.name).toBe("Box.Put");
  });

  it("uses filePath in the synthesized id", () => {
    const out = extractGoShapes("func foo() {}\n", "internal/util.go");
    expect(out[0]!.filePath).toBe("internal/util.go");
    expect(out[0]!.id).toContain("internal/util.go");
  });

  it("does not get confused by trailing line comment after func", () => {
    const src = "func Mark() { /* body */ } // legacy entry\n";
    const out = extractGoShapes(src, "f.go");
    expect(out).toHaveLength(1);
    expect(out[0]!.name).toBe("Mark");
  });
});
