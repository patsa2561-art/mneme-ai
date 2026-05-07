import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { flash } from "./flash.js";
import { stripAnsi } from "./pyramid.js";

beforeEach(() => {
  process.env.NO_COLOR = "1";
});
afterEach(() => {
  delete process.env.NO_COLOR;
});

describe("flash — every type returns exactly 3 lines", () => {
  for (const t of ["list", "table", "verdict", "metric", "narrative"] as const) {
    it(`${t}: produces 3 lines`, () => {
      const lines = flash({ type: t, data: {} });
      expect(lines).toHaveLength(3);
    });
  }

  it("list: includes count + top item + others count", () => {
    const lines = flash({ type: "list", data: { items: ["a", "b", "c"], top: "a" } }).map(stripAnsi);
    expect(lines[0]).toContain("3");
    expect(lines[1]).toContain("a");
    expect(lines[2]).toContain("2"); // others = 3 - 1
  });

  it("list: tolerates raw array as data", () => {
    const lines = flash({ type: "list", data: ["x", "y"] }).map(stripAnsi);
    expect(lines[0]).toContain("2");
  });

  it("table: shows rows × cols", () => {
    const lines = flash({ type: "table", data: { rows: 4, cols: 3, topRow: "header" } }).map(stripAnsi);
    expect(lines[0]).toContain("4×3");
    expect(lines[1]).toContain("header");
  });

  it("verdict: leads with headline, then severity, then next step", () => {
    const lines = flash({
      type: "verdict",
      data: { headline: "all clear", severity: "info", next: "ship" },
    }).map(stripAnsi);
    expect(lines[0]).toContain("all clear");
    expect(lines[1]).toContain("info");
    expect(lines[2]).toContain("ship");
  });

  it("metric: shows value + trend + delta", () => {
    const lines = flash({
      type: "metric",
      data: { value: "42", trend: "up", delta: "+5%" },
    }).map(stripAnsi);
    expect(lines[0]).toContain("42");
    expect(lines[1]).toContain("up");
    expect(lines[2]).toContain("+5%");
  });

  it("narrative: takes the first ~3 sentences", () => {
    const text = "First. Second. Third. Fourth.";
    const lines = flash({ type: "narrative", data: text }).map(stripAnsi);
    expect(lines[0]).toContain("First");
    expect(lines[1]).toContain("Second");
    expect(lines[2]).toContain("Third");
  });

  it("narrative: pads to 3 lines on short input", () => {
    const lines = flash({ type: "narrative", data: "Only one." });
    expect(lines).toHaveLength(3);
  });

  it("never throws on bizarre input", () => {
    expect(() => flash({ type: "list", data: null })).not.toThrow();
    expect(() => flash({ type: "verdict", data: undefined })).not.toThrow();
    expect(() => flash({ type: "metric", data: 42 })).not.toThrow();
  });
});
