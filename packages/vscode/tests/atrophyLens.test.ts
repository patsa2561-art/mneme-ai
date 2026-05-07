import { describe, it, expect } from "vitest";
import {
  parseFunctionDeclarations,
  formatLensTitle,
  LruCache,
  relativeToRepo,
} from "../src/lenses/atrophyLens.js";
import type { FileKnowledge } from "@mneme-ai/core/public";

describe("parseFunctionDeclarations", () => {
  it("finds top-level TypeScript functions", () => {
    const src = [
      "export function alpha() {",
      "  return 1;",
      "}",
      "function beta(x: number) {",
      "  return x;",
      "}",
    ].join("\n");
    const decls = parseFunctionDeclarations(src, "typescript");
    expect(decls.length).toBe(2);
    expect(decls[0]!.name).toBe("alpha");
    expect(decls[1]!.name).toBe("beta");
  });

  it("finds TypeScript classes", () => {
    const src = "export class Foo {}\nclass Bar {}";
    const decls = parseFunctionDeclarations(src, "typescript");
    const names = decls.map((d) => d.name).sort();
    expect(names).toEqual(["Bar", "Foo"]);
  });

  it("finds Python def and class", () => {
    const src = ["def alpha(x):", "    return x", "class Bee:", "    pass"].join("\n");
    const decls = parseFunctionDeclarations(src, "python");
    const names = decls.map((d) => d.name).sort();
    expect(names).toEqual(["Bee", "alpha"]);
  });

  it("finds Go funcs (incl. receivers) and types", () => {
    const src = [
      "func Alpha() error { return nil }",
      "func (r *Repo) Beta() error { return nil }",
      "type Foo struct { X int }",
    ].join("\n");
    const decls = parseFunctionDeclarations(src, "go");
    const names = decls.map((d) => d.name).sort();
    expect(names).toContain("Alpha");
    expect(names).toContain("Beta");
    expect(names).toContain("Foo");
  });

  it("returns no declarations for unknown languages", () => {
    expect(parseFunctionDeclarations("anything", "haskell")).toEqual([]);
  });

  it("ignores empty / oversized lines", () => {
    const big = "x".repeat(500);
    const src = `${big}\nfunction good() {}`;
    const decls = parseFunctionDeclarations(src, "typescript");
    expect(decls.map((d) => d.name)).toEqual(["good"]);
  });
});

describe("formatLensTitle", () => {
  function fk(top: { knowledge: number; days: number; touchCount?: number }, totalTouches?: number): FileKnowledge {
    const expert = {
      name: "Alice",
      email: "alice@example.com",
      knowledge: top.knowledge,
      lastTouchDaysAgo: top.days,
      touchCount: top.touchCount ?? 5,
    };
    const tier =
      top.knowledge >= 0.7 ? "safe" : top.knowledge >= 0.3 ? "warn" : "at-risk";
    return {
      filePath: "src/auth.ts",
      totalTouches: totalTouches ?? 5,
      liveExperts: [expert],
      allKnowers: [expert],
      tier,
      freshestKnowledge: top.knowledge,
    };
  }

  it("renders the fresh band with green dot and percent", () => {
    const title = formatLensTitle(fk({ knowledge: 0.95, days: 4 }));
    expect(title).toMatch(/^🟢 fresh/);
    expect(title).toContain("95%");
  });

  it("renders the fading band with the refresh suggestion", () => {
    const title = formatLensTitle(fk({ knowledge: 0.18, days: 198 }));
    expect(title).toMatch(/^🟡 fading/);
    expect(title).toContain("refresh recommended");
  });

  it("renders the ghost band with deep-history phrasing when total touches >= 2", () => {
    const title = formatLensTitle(fk({ knowledge: 0.05, days: 900 }, 4));
    expect(title).toMatch(/^🔴 ghost/);
    expect(title).toContain("deep history lost");
    expect(title).toContain("4 prior touches");
  });

  it("renders the ghost band with shallow phrasing when total touches < 2", () => {
    const title = formatLensTitle(fk({ knowledge: 0.05, days: 900 }, 1));
    expect(title).toMatch(/^🔴 ghost/);
    expect(title).toContain("only 1 prior touch");
  });

  it("returns a sensible no-history message when input is null", () => {
    const title = formatLensTitle(null);
    expect(title).toContain("no commit history");
  });

  it("returns a no-history message when allKnowers is empty", () => {
    const empty: FileKnowledge = {
      filePath: "x.ts",
      totalTouches: 0,
      liveExperts: [],
      allKnowers: [],
      tier: "at-risk",
      freshestKnowledge: 0,
    };
    const title = formatLensTitle(empty);
    expect(title).toContain("no commit history");
  });
});

describe("LruCache", () => {
  it("returns undefined for a missing key", () => {
    const c = new LruCache<string, number>(4, 60_000);
    expect(c.get("a")).toBeUndefined();
  });

  it("respects TTL — expired entries return undefined", () => {
    let now = 0;
    const c = new LruCache<string, number>(4, 100, () => now);
    c.set("a", 1);
    expect(c.get("a")).toBe(1);
    now = 1_000;
    expect(c.get("a")).toBeUndefined();
  });

  it("evicts oldest when over capacity", () => {
    const c = new LruCache<string, number>(2, 60_000);
    c.set("a", 1);
    c.set("b", 2);
    c.set("c", 3);
    expect(c.get("a")).toBeUndefined();
    expect(c.get("b")).toBe(2);
    expect(c.get("c")).toBe(3);
  });

  it("promotes on access (so recently-read items aren't evicted)", () => {
    const c = new LruCache<string, number>(2, 60_000);
    c.set("a", 1);
    c.set("b", 2);
    c.get("a");
    c.set("c", 3); // should evict b, not a
    expect(c.get("a")).toBe(1);
    expect(c.get("b")).toBeUndefined();
  });
});

describe("relativeToRepo", () => {
  it("strips the repo root and normalises slashes", () => {
    expect(relativeToRepo("D:/repo", "D:/repo/src/auth.ts")).toBe("src/auth.ts");
    expect(relativeToRepo("D:\\repo", "D:\\repo\\src\\auth.ts")).toBe("src/auth.ts");
  });

  it("returns the full path when the file is outside the repo", () => {
    expect(relativeToRepo("D:/repo", "C:/elsewhere/foo.ts")).toBe("C:/elsewhere/foo.ts");
  });
});
