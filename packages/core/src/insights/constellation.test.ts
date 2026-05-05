import { describe, it, expect } from "vitest";
import { buildConstellation, renderConstellationAscii } from "./constellation.js";
import type { Commit } from "../types.js";

function mk(p: { hash: string; date: string; subject: string; author: string; files?: string[] }): Commit {
  return {
    hash: p.hash,
    shortHash: p.hash.slice(0, 7),
    authorName: p.author,
    authorEmail: p.author.toLowerCase() + "@x.com",
    authorDate: p.date,
    committerDate: p.date,
    subject: p.subject,
    body: "",
    files: p.files ?? [],
    parents: [],
  };
}

describe("buildConstellation", () => {
  it("returns empty constellation for no commits", () => {
    const c = buildConstellation([]);
    expect(c.fileStars).toHaveLength(0);
    expect(c.authorOrbitals).toHaveLength(0);
    expect(c.fileEdges).toHaveLength(0);
  });

  it("builds file stars sorted by weight descending", () => {
    const commits = [
      ...Array.from({ length: 5 }, (_, i) =>
        mk({ hash: `a${i}`, date: `2024-01-${(i + 1).toString().padStart(2, "0")}`, subject: "x", author: "Alice", files: ["src/hot.ts"] }),
      ),
      ...Array.from({ length: 2 }, (_, i) =>
        mk({ hash: `b${i}`, date: `2024-01-${(i + 1).toString().padStart(2, "0")}`, subject: "x", author: "Alice", files: ["src/cool.ts"] }),
      ),
    ];
    const c = buildConstellation(commits);
    expect(c.fileStars[0]!.filePath).toBe("src/hot.ts");
    expect(c.fileStars[0]!.weight).toBe(5);
  });

  it("filters out files below minFileTouches", () => {
    const commits = [
      mk({ hash: "a1", date: "2024-01-01", subject: "x", author: "Alice", files: ["src/rare.ts"] }),
    ];
    const c = buildConstellation(commits, { minFileTouches: 2 });
    expect(c.fileStars).toHaveLength(0);
  });

  it("builds author orbitals sorted by weight desc", () => {
    const commits = [
      ...Array.from({ length: 5 }, (_, i) =>
        mk({ hash: `a${i}`, date: `2024-01-${(i + 1).toString().padStart(2, "0")}`, subject: "x", author: "Alice", files: ["src/x.ts"] }),
      ),
      ...Array.from({ length: 3 }, (_, i) =>
        mk({ hash: `b${i}`, date: `2024-01-${(i + 1).toString().padStart(2, "0")}`, subject: "x", author: "Bob", files: ["src/x.ts"] }),
      ),
    ];
    const c = buildConstellation(commits);
    expect(c.authorOrbitals[0]!.author).toBe("Alice");
    expect(c.authorOrbitals[0]!.weight).toBe(5);
  });

  it("creates co-edit edges between files committed together", () => {
    const commits = [
      mk({ hash: "a1", date: "2024-01-01", subject: "x", author: "Alice", files: ["src/a.ts", "src/b.ts"] }),
      mk({ hash: "a2", date: "2024-01-02", subject: "x", author: "Alice", files: ["src/a.ts", "src/b.ts"] }),
    ];
    const c = buildConstellation(commits);
    const edge = c.fileEdges.find(
      (e) => (e.fileA === "src/a.ts" && e.fileB === "src/b.ts") || (e.fileA === "src/b.ts" && e.fileB === "src/a.ts"),
    );
    expect(edge).toBeDefined();
    expect(edge!.coEdits).toBe(2);
  });

  it("file edges always have fileA < fileB alphabetically", () => {
    const commits = [
      mk({ hash: "a1", date: "2024-01-01", subject: "x", author: "Alice", files: ["src/z.ts", "src/a.ts"] }),
      mk({ hash: "a2", date: "2024-01-02", subject: "x", author: "Alice", files: ["src/z.ts", "src/a.ts"] }),
    ];
    const c = buildConstellation(commits);
    for (const e of c.fileEdges) {
      expect(e.fileA.localeCompare(e.fileB)).toBeLessThan(0);
    }
  });

  it("clusterCount counts distinct top-level directories", () => {
    const commits = [
      mk({ hash: "a1", date: "2024-01-01", subject: "x", author: "A", files: ["src/auth/x.ts", "src/auth/y.ts"] }),
      mk({ hash: "a2", date: "2024-01-02", subject: "x", author: "A", files: ["src/auth/x.ts"] }),
      mk({ hash: "b1", date: "2024-01-03", subject: "x", author: "B", files: ["packages/x.ts"] }),
      mk({ hash: "b2", date: "2024-01-04", subject: "x", author: "B", files: ["packages/x.ts"] }),
    ];
    const c = buildConstellation(commits);
    expect(c.clusterCount).toBeGreaterThanOrEqual(2);
  });

  it("renderConstellationAscii produces non-empty string with key sections", () => {
    const commits = [
      mk({ hash: "a1", date: "2024-01-01", subject: "x", author: "Alice", files: ["src/a.ts", "src/b.ts"] }),
      mk({ hash: "a2", date: "2024-01-02", subject: "x", author: "Alice", files: ["src/a.ts", "src/b.ts"] }),
    ];
    const c = buildConstellation(commits);
    const ascii = renderConstellationAscii(c);
    expect(ascii).toContain("Brightest stars");
    expect(ascii).toContain("Closest orbitals");
    expect(ascii).toContain("co-edit");
  });

  it("respects maxStars cap", () => {
    const commits: Commit[] = [];
    for (let i = 0; i < 50; i++) {
      commits.push(
        mk({
          hash: `c${i}`,
          date: `2024-01-${((i % 28) + 1).toString().padStart(2, "0")}`,
          subject: "x",
          author: "A",
          files: [`src/f${i}.ts`, `src/f${i}.ts`], // touched twice so it survives min filter
        }),
      );
    }
    const c = buildConstellation(commits, { maxStars: 10 });
    expect(c.fileStars.length).toBeLessThanOrEqual(10);
  });
});
