import { describe, it, expect } from "vitest";
import { buildNetwork } from "./network.js";
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

describe("buildNetwork", () => {
  it("returns empty for empty input", () => {
    const n = buildNetwork([]);
    expect(n.nodes).toHaveLength(0);
    expect(n.edges).toHaveLength(0);
    expect(n.silos).toHaveLength(0);
  });

  it("filters out authors below minAuthorCommits", () => {
    const commits = [
      mk({ hash: "a1", date: "2024-01-01", subject: "x", author: "Alice", files: ["a.ts"] }),
      mk({ hash: "b1", date: "2024-01-02", subject: "x", author: "Bob", files: ["b.ts"] }),
    ];
    const n = buildNetwork(commits, { minAuthorCommits: 3 });
    expect(n.nodes).toHaveLength(0);
  });

  it("creates an edge between authors who touched the same files", () => {
    const commits = [
      mk({ hash: "a1", date: "2024-01-01", subject: "auth work", author: "Alice", files: ["src/auth.ts"] }),
      mk({ hash: "a2", date: "2024-01-02", subject: "auth work", author: "Alice", files: ["src/auth.ts"] }),
      mk({ hash: "b1", date: "2024-01-03", subject: "auth fix", author: "Bob", files: ["src/auth.ts"] }),
      mk({ hash: "b2", date: "2024-01-04", subject: "auth tweak", author: "Bob", files: ["src/auth.ts"] }),
    ];
    const n = buildNetwork(commits, { minAuthorCommits: 2 });
    const edge = n.edges.find(
      (e) => (e.authorA === "Alice" && e.authorB === "Bob") || (e.authorA === "Bob" && e.authorB === "Alice"),
    );
    expect(edge).toBeDefined();
    expect(edge!.axes.coEdit).toBeGreaterThan(0);
  });

  it("co-topic axis fires when authors share commit vocabulary", () => {
    const commits = [
      mk({ hash: "a1", date: "2024-01-01", subject: "rewrite payment processor", author: "Alice", files: ["a.ts"] }),
      mk({ hash: "a2", date: "2024-01-02", subject: "rewrite payment validation", author: "Alice", files: ["b.ts"] }),
      mk({ hash: "b1", date: "2024-01-03", subject: "rewrite payment retry", author: "Bob", files: ["c.ts"] }),
      mk({ hash: "b2", date: "2024-01-04", subject: "rewrite payment receipts", author: "Bob", files: ["d.ts"] }),
    ];
    const n = buildNetwork(commits, { minAuthorCommits: 2, minEdgeWeight: 0 });
    const edge = n.edges[0];
    expect(edge).toBeDefined();
    expect(edge!.axes.coTopic).toBeGreaterThan(0);
    expect(edge!.sharedTerms).toContain("payment");
  });

  it("centrality is highest for the most-connected author", () => {
    const commits = [
      // Alice connected to both Bob and Carol via shared files
      mk({ hash: "a1", date: "2024-01-01", subject: "x", author: "Alice", files: ["src/x.ts", "src/y.ts"] }),
      mk({ hash: "a2", date: "2024-01-02", subject: "x", author: "Alice", files: ["src/x.ts", "src/y.ts"] }),
      mk({ hash: "b1", date: "2024-01-03", subject: "x", author: "Bob", files: ["src/x.ts"] }),
      mk({ hash: "b2", date: "2024-01-04", subject: "x", author: "Bob", files: ["src/x.ts"] }),
      mk({ hash: "c1", date: "2024-01-05", subject: "x", author: "Carol", files: ["src/y.ts"] }),
      mk({ hash: "c2", date: "2024-01-06", subject: "x", author: "Carol", files: ["src/y.ts"] }),
    ];
    const n = buildNetwork(commits, { minAuthorCommits: 2, minEdgeWeight: 0 });
    expect(n.nodes[0]!.author).toBe("Alice");
    expect(n.nodes[0]!.centrality).toBeGreaterThanOrEqual(n.nodes[1]!.centrality);
  });

  it("detects silos when groups have no inter-group edges above threshold", () => {
    const commits = [
      mk({ hash: "a1", date: "2024-01-01", subject: "auth", author: "Alice", files: ["src/auth/x.ts"] }),
      mk({ hash: "a2", date: "2024-01-02", subject: "auth", author: "Alice", files: ["src/auth/x.ts"] }),
      mk({ hash: "b1", date: "2024-01-01", subject: "auth", author: "Bob", files: ["src/auth/x.ts"] }),
      mk({ hash: "b2", date: "2024-01-02", subject: "auth", author: "Bob", files: ["src/auth/x.ts"] }),
      mk({ hash: "c1", date: "2024-01-01", subject: "payments", author: "Carol", files: ["src/pay/y.ts"] }),
      mk({ hash: "c2", date: "2024-01-02", subject: "payments", author: "Carol", files: ["src/pay/y.ts"] }),
      mk({ hash: "d1", date: "2024-01-01", subject: "payments", author: "Dave", files: ["src/pay/y.ts"] }),
      mk({ hash: "d2", date: "2024-01-02", subject: "payments", author: "Dave", files: ["src/pay/y.ts"] }),
    ];
    const n = buildNetwork(commits, { minAuthorCommits: 2 });
    expect(n.silos.length).toBeGreaterThanOrEqual(1);
  });

  it("edges sorted by weight descending", () => {
    const commits = [
      mk({ hash: "a1", date: "2024-01-01", subject: "auth", author: "Alice", files: ["x.ts"] }),
      mk({ hash: "a2", date: "2024-01-02", subject: "auth", author: "Alice", files: ["x.ts"] }),
      mk({ hash: "b1", date: "2024-01-03", subject: "auth", author: "Bob", files: ["x.ts"] }),
      mk({ hash: "b2", date: "2024-01-04", subject: "auth", author: "Bob", files: ["x.ts"] }),
      mk({ hash: "c1", date: "2024-01-05", subject: "different", author: "Carol", files: ["y.ts"] }),
      mk({ hash: "c2", date: "2024-01-06", subject: "different", author: "Carol", files: ["y.ts"] }),
    ];
    const n = buildNetwork(commits, { minAuthorCommits: 2, minEdgeWeight: 0 });
    for (let i = 1; i < n.edges.length; i++) {
      expect(n.edges[i - 1]!.weight).toBeGreaterThanOrEqual(n.edges[i]!.weight);
    }
  });
});
