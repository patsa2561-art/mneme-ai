import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { renderPyramid, singleSection, stripAnsi } from "./pyramid.js";

beforeEach(() => {
  process.env.NO_COLOR = "1";
});
afterEach(() => {
  delete process.env.NO_COLOR;
});

describe("renderPyramid — tier ordering", () => {
  it("renders headline first", () => {
    const out = renderPyramid({
      headline: "📰 Test headline",
      sections: [],
      widthOverride: 80,
    });
    const stripped = stripAnsi(out);
    const lines = stripped.split("\n").filter((l) => l.trim().length > 0);
    expect(lines[0]).toContain("Test headline");
  });

  it("orders sections by tier: lede → key-facts → body → sources", () => {
    const out = renderPyramid({
      headline: "Hi",
      sections: [
        singleSection("body", "Body Section", ["body line"]),
        singleSection("lede", "Lede Section", ["lede line"]),
        singleSection("sources", "Sources Section", ["sources line"]),
        singleSection("key-facts", "Facts Section", ["key fact"]),
      ],
      widthOverride: 80,
    });
    const stripped = stripAnsi(out);
    const ledeIdx = stripped.indexOf("Lede Section");
    const factsIdx = stripped.indexOf("Facts Section");
    const bodyIdx = stripped.indexOf("Body Section");
    const sourcesIdx = stripped.indexOf("Sources Section");
    expect(ledeIdx).toBeGreaterThan(-1);
    expect(ledeIdx).toBeLessThan(factsIdx);
    expect(factsIdx).toBeLessThan(bodyIdx);
    expect(bodyIdx).toBeLessThan(sourcesIdx);
  });

  it("renders sections regardless of caller order", () => {
    const a = renderPyramid({
      headline: "Hi",
      sections: [
        singleSection("lede", "L", ["x"]),
        singleSection("body", "B", ["y"]),
      ],
      widthOverride: 80,
    });
    const b = renderPyramid({
      headline: "Hi",
      sections: [
        singleSection("body", "B", ["y"]),
        singleSection("lede", "L", ["x"]),
      ],
      widthOverride: 80,
    });
    expect(a).toEqual(b);
  });
});

describe("renderPyramid — details collapse", () => {
  it("collapses details tier with marker by default", () => {
    const out = renderPyramid({
      headline: "Hi",
      sections: [
        singleSection("details", "Detail", ["a", "b", "c"]),
      ],
      widthOverride: 80,
    });
    const stripped = stripAnsi(out);
    expect(stripped).toContain("more line");
    expect(stripped).toContain("--verbose");
    // Content should NOT be present
    expect(stripped).not.toContain("Detail");
  });

  it("renders details fully when verbose=true", () => {
    const out = renderPyramid({
      headline: "Hi",
      sections: [singleSection("details", "Detail", ["a", "b", "c"])],
      verbose: true,
      widthOverride: 80,
    });
    const stripped = stripAnsi(out);
    expect(stripped).toContain("Detail");
    expect(stripped).toContain("a");
    expect(stripped).toContain("b");
    expect(stripped).toContain("c");
    expect(stripped).not.toContain("--verbose");
  });

  it("uses singular form when only 1 detail line", () => {
    const out = renderPyramid({
      headline: "Hi",
      sections: [singleSection("details", undefined, ["only one"])],
      widthOverride: 80,
    });
    const stripped = stripAnsi(out);
    expect(stripped).toMatch(/1 more line/);
  });

  it("omits details section entirely when no details given", () => {
    const out = renderPyramid({
      headline: "Hi",
      sections: [singleSection("body", "B", ["x"])],
      widthOverride: 80,
    });
    const stripped = stripAnsi(out);
    expect(stripped).not.toContain("--verbose");
    expect(stripped).not.toContain("more line");
  });
});

describe("renderPyramid — width adaptation", () => {
  it("wraps long lines to widthOverride", () => {
    const longLine = "x".repeat(120);
    const out = renderPyramid({
      headline: "Hi",
      sections: [singleSection("body", undefined, [longLine])],
      widthOverride: 50,
    });
    const stripped = stripAnsi(out);
    for (const line of stripped.split("\n")) {
      expect(line.length).toBeLessThanOrEqual(60); // 50 + small slack for indent
    }
  });

  it("uses default 72 width when no override and no TTY columns", () => {
    const orig = process.stdout.columns;
    Object.defineProperty(process.stdout, "columns", {
      value: undefined,
      configurable: true,
    });
    try {
      const out = renderPyramid({
        headline: "Hi",
        sections: [
          singleSection(
            "body",
            undefined,
            ["word ".repeat(50).trim()],
          ),
        ],
      });
      const stripped = stripAnsi(out);
      for (const line of stripped.split("\n")) {
        expect(line.length).toBeLessThanOrEqual(80);
      }
    } finally {
      Object.defineProperty(process.stdout, "columns", {
        value: orig,
        configurable: true,
      });
    }
  });

  it("clamps absurdly small widths to a minimum", () => {
    // Should not throw and should produce something readable.
    expect(() =>
      renderPyramid({
        headline: "headline",
        sections: [singleSection("body", undefined, ["a b c d e"])],
        widthOverride: 1,
      }),
    ).not.toThrow();
  });
});

describe("renderPyramid — whyShown footer", () => {
  it("appends a 'why am I seeing this?' footer when provided", () => {
    const out = renderPyramid({
      headline: "Hi",
      sections: [],
      whyShown: "shown because forensics found 3 anomalies",
      widthOverride: 80,
    });
    const stripped = stripAnsi(out);
    expect(stripped).toContain("shown because forensics found 3 anomalies");
  });

  it("omits the footer line when whyShown is undefined", () => {
    const out = renderPyramid({
      headline: "Hi",
      sections: [],
      widthOverride: 80,
    });
    const stripped = stripAnsi(out);
    expect(stripped).not.toMatch(/ⓘ/);
  });
});

describe("singleSection helper", () => {
  it("returns a properly shaped PyramidSection", () => {
    const s = singleSection("lede", "Title", ["a", "b"]);
    expect(s.tier).toBe("lede");
    expect(s.title).toBe("Title");
    expect(s.lines).toEqual(["a", "b"]);
  });

  it("accepts undefined title", () => {
    const s = singleSection("body", undefined, ["x"]);
    expect(s.title).toBeUndefined();
  });
});

describe("stripAnsi", () => {
  it("strips colour escape codes", () => {
    const ansi = "\x1b[31mred\x1b[0m";
    expect(stripAnsi(ansi)).toBe("red");
  });

  it("returns plain strings unchanged", () => {
    expect(stripAnsi("plain")).toBe("plain");
  });
});
