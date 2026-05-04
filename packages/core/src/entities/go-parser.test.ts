import { describe, it, expect } from "vitest";
import { GoParser, findGoEntities } from "./go-parser.js";

const SAMPLE = `// Package math2 provides math utilities.
package math2

import (
	"fmt"
)

const Pi = 3.14159

type Point struct {
	X int
	Y int
}

type Shape interface {
	Area() float64
}

type Distance int

func Add(a, b int) int {
	return a + b
}

func (p *Point) String() string {
	return fmt.Sprintf("(%d, %d)", p.X, p.Y)
}

func GenericMax[T int | float64](a, b T) T {
	if a > b {
		return a
	}
	return b
}

// This // is // not // a // function — it's in a comment.
// func ShouldNotBeFound() {}

func WithRawString(name string) string {
	return ` + "`func FakeFunc() {}`" + `
}
`;

describe("findGoEntities — pure regex extraction", () => {
  it("finds top-level functions", () => {
    const out = findGoEntities(SAMPLE);
    const names = out.map((e) => e.name);
    expect(names).toContain("Add");
  });

  it("captures struct as kind=class with name preserved", () => {
    const out = findGoEntities(SAMPLE);
    const point = out.find((e) => e.name === "Point");
    expect(point?.kind).toBe("class");
    expect(point?.signature).toContain("type Point struct");
  });

  it("captures interface as kind=type", () => {
    const out = findGoEntities(SAMPLE);
    const shape = out.find((e) => e.name === "Shape");
    expect(shape?.kind).toBe("type");
    expect(shape?.signature).toContain("interface");
  });

  it("captures named type alias as kind=type", () => {
    const out = findGoEntities(SAMPLE);
    const dist = out.find((e) => e.name === "Distance");
    expect(dist?.kind).toBe("type");
  });

  it("methods are named Receiver.Method", () => {
    const out = findGoEntities(SAMPLE);
    const stringMethod = out.find((e) => e.name === "Point.String");
    expect(stringMethod).toBeDefined();
    expect(stringMethod?.kind).toBe("function");
  });

  it("supports generic functions (Go 1.18+)", () => {
    const out = findGoEntities(SAMPLE);
    const generic = out.find((e) => e.name === "GenericMax");
    expect(generic).toBeDefined();
    expect(generic?.signature).toContain("[T int | float64]");
  });

  it("ignores function-like content inside line comments", () => {
    const out = findGoEntities(SAMPLE);
    expect(out.find((e) => e.name === "ShouldNotBeFound")).toBeUndefined();
  });

  it("ignores function-like content inside raw strings", () => {
    const out = findGoEntities(SAMPLE);
    expect(out.find((e) => e.name === "FakeFunc")).toBeUndefined();
  });

  it("counts the right number of declarations on the sample", () => {
    const out = findGoEntities(SAMPLE);
    // Expected: Add, Point.String, GenericMax, WithRawString, Point, Shape, Distance = 7
    expect(out.length).toBe(7);
  });
});

describe("GoParser — file-level integration", () => {
  it("yields Entity records via parseFile", () => {
    const parser = new GoParser();
    const entities = Array.from(parser.parseFile("foo/bar.go", SAMPLE));
    expect(entities.length).toBe(7);
    for (const e of entities) {
      expect(e.language).toBe("go");
      expect(e.filePath).toBe("foo/bar.go");
      expect(e.startLine).toBeGreaterThan(0);
      expect(e.endLine).toBeGreaterThanOrEqual(e.startLine);
      expect(e.id).toMatch(/^e_[0-9a-f]{12}$/);
    }
  });

  it("reports stable ids — same input → same id", () => {
    const parser = new GoParser();
    const e1 = Array.from(parser.parseFile("foo/bar.go", SAMPLE));
    const e2 = Array.from(parser.parseFile("foo/bar.go", SAMPLE));
    expect(e1.map((e) => e.id)).toEqual(e2.map((e) => e.id));
  });

  it("declares language='go' and supports the EntityParser contract", () => {
    const parser = new GoParser();
    expect(parser.languages).toEqual(["go"]);
    expect(parser.name).toBe("go-regex");
  });
});

describe("findGoEntities — edge cases", () => {
  it("handles a file with no declarations", () => {
    expect(findGoEntities("package empty\n")).toEqual([]);
  });

  it("handles malformed files without throwing", () => {
    const out = findGoEntities("package x\nfunc Broken(");
    expect(Array.isArray(out)).toBe(true);
  });

  it("ignores function keyword inside block comments", () => {
    const src = `package x
/*
func InsideBlock() {}
*/
func Real() {}
`;
    const out = findGoEntities(src);
    expect(out.map((e) => e.name)).toEqual(["Real"]);
  });

  it("captures methods on generic receivers", () => {
    const src = `package x
type Stack[T any] struct { items []T }
func (s *Stack[T]) Push(v T) { s.items = append(s.items, v) }
`;
    const out = findGoEntities(src);
    const push = out.find((e) => e.name === "Stack.Push");
    expect(push).toBeDefined();
  });
});
