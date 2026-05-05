import { describe, it, expect } from "vitest";
import { buildExportBundle, renderExportMarkdown } from "./export-bundle.js";
import type { Commit } from "../types.js";

const NOW = new Date("2026-05-05").getTime();

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

describe("buildExportBundle", () => {
  it("returns bundle with empty sections for empty commits", () => {
    const b = buildExportBundle([], { nowMs: NOW });
    expect(b.repo.totalCommits).toBe(0);
    expect(b.topAuthorsDna).toHaveLength(0);
  });

  it("includes top author DNA strands", () => {
    const commits = [
      mk({ hash: "a1", date: "2026-04-01", subject: "x", author: "Alice", files: ["x.ts"] }),
      mk({ hash: "a2", date: "2026-04-02", subject: "x", author: "Alice", files: ["x.ts"] }),
      mk({ hash: "b1", date: "2026-04-03", subject: "x", author: "Bob", files: ["x.ts"] }),
    ];
    const b = buildExportBundle(commits, { nowMs: NOW, topAuthors: 2 });
    expect(b.topAuthorsDna).toHaveLength(2);
    expect(b.topAuthorsDna[0]!.author).toBe("alice@x.com");
  });

  it("repo summary reflects commit range", () => {
    const commits = [
      mk({ hash: "a1", date: "2024-01-01", subject: "x", author: "Alice" }),
      mk({ hash: "a2", date: "2025-06-01", subject: "x", author: "Bob" }),
    ];
    const b = buildExportBundle(commits);
    expect(b.repo.fromDate).toBe("2024-01-01");
    expect(b.repo.toDate).toBe("2025-06-01");
    expect(b.repo.totalAuthors).toBe(2);
    expect(b.repo.totalCommits).toBe(2);
  });

  it("renderExportMarkdown produces a non-empty document with all sections", () => {
    const commits = Array.from({ length: 8 }, (_, i) =>
      mk({
        hash: `a${i}`,
        date: `2026-04-${(i + 1).toString().padStart(2, "0")}`,
        subject: `feat: x${i}`,
        author: i % 2 === 0 ? "Alice" : "Bob",
        files: [`src/x${i}.ts`],
      }),
    );
    const b = buildExportBundle(commits, { nowMs: NOW });
    const md = renderExportMarkdown(b);
    expect(md).toContain("# Mneme — Codebase Bundle");
    expect(md).toContain("## 📊 Team Health");
    expect(md).toContain("## 📈 Drift trajectory");
    expect(md).toContain("## 📖 Chronicle");
    expect(md).toContain("## 🧬 Top contributors");
    expect(md).toContain("## 🕸 Author network");
    expect(md).toContain("## 🧠 Semantic commit clusters");
    expect(md).toContain("## 🔮 Oracle predictions");
    expect(md).toContain("## 🌌 Constellation");
    expect(md).toContain("## 👻 Ghost code");
  });

  it("bundle includes drift, chronicle, oracle, constellation, clusters, network, manage, ghost", () => {
    const commits = [
      mk({ hash: "a1", date: "2026-04-01", subject: "feat: caching", author: "Alice", files: ["x.ts"] }),
      mk({ hash: "a2", date: "2026-04-02", subject: "feat: caching", author: "Alice", files: ["x.ts"] }),
      mk({ hash: "b1", date: "2026-04-03", subject: "fix bug", author: "Bob", files: ["x.ts"] }),
    ];
    const b = buildExportBundle(commits, { nowMs: NOW });
    expect(b.drift).toBeDefined();
    expect(b.chronicle).toBeDefined();
    expect(b.oracle).toBeDefined();
    expect(b.constellation).toBeDefined();
    expect(b.clusters).toBeDefined();
    expect(b.network).toBeDefined();
    expect(b.manage).toBeDefined();
    expect(b.ghost).toBeDefined();
  });

  it("respects topAuthors cap", () => {
    const commits = [
      mk({ hash: "a1", date: "2026-04-01", subject: "x", author: "Alice", files: ["x.ts"] }),
      mk({ hash: "b1", date: "2026-04-02", subject: "x", author: "Bob", files: ["x.ts"] }),
      mk({ hash: "c1", date: "2026-04-03", subject: "x", author: "Carol", files: ["x.ts"] }),
    ];
    const b = buildExportBundle(commits, { topAuthors: 2 });
    expect(b.topAuthorsDna.length).toBeLessThanOrEqual(2);
  });
});
