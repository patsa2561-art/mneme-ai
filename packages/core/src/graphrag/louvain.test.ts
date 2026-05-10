import { describe, expect, it } from "vitest";
import { louvain } from "./louvain.js";
import type { KnowledgeGraph } from "./types.js";

describe("Louvain community detection", () => {
  it("returns empty result on empty graph", () => {
    const r = louvain({ nodes: [], edges: [], builtAt: "x", source: "test" });
    expect(r.communities.length).toBe(0);
    expect(r.modularity).toBe(0);
  });

  it("two cleanly-separated cliques produce 2 communities", () => {
    const g: KnowledgeGraph = {
      nodes: [
        { id: "a1", kind: "file", label: "a1.ts" }, { id: "a2", kind: "file", label: "a2.ts" }, { id: "a3", kind: "file", label: "a3.ts" },
        { id: "b1", kind: "file", label: "b1.ts" }, { id: "b2", kind: "file", label: "b2.ts" }, { id: "b3", kind: "file", label: "b3.ts" },
      ],
      edges: [
        // clique A
        { from: "a1", to: "a2", kind: "co-edits", weight: 5 },
        { from: "a2", to: "a3", kind: "co-edits", weight: 5 },
        { from: "a1", to: "a3", kind: "co-edits", weight: 5 },
        // clique B
        { from: "b1", to: "b2", kind: "co-edits", weight: 5 },
        { from: "b2", to: "b3", kind: "co-edits", weight: 5 },
        { from: "b1", to: "b3", kind: "co-edits", weight: 5 },
        // weak bridge (won't merge)
        { from: "a1", to: "b1", kind: "co-edits", weight: 0.1 },
      ],
      builtAt: "x", source: "test",
    };
    const r = louvain(g);
    expect(r.communities.length).toBeGreaterThanOrEqual(2);
    expect(r.modularity).toBeGreaterThan(0);
    // each clique should be in the same community
    const aCommunity = r.communities.find((c) => c.members.includes("a1"));
    expect(aCommunity?.members).toContain("a2");
    expect(aCommunity?.members).toContain("a3");
  });

  it("singletons are dropped (only communities with >=2 members)", () => {
    const g: KnowledgeGraph = {
      nodes: [
        { id: "x1", kind: "file", label: "x1" }, { id: "x2", kind: "file", label: "x2" },
        { id: "alone", kind: "file", label: "alone" },
      ],
      edges: [{ from: "x1", to: "x2", kind: "co-edits", weight: 3 }],
      builtAt: "x", source: "test",
    };
    const r = louvain(g);
    for (const c of r.communities) expect(c.members.length).toBeGreaterThanOrEqual(2);
  });

  it("modularity is in [-0.5, 1] for any partition", () => {
    const g: KnowledgeGraph = {
      nodes: [
        { id: "n1", kind: "file", label: "n1" }, { id: "n2", kind: "file", label: "n2" },
        { id: "n3", kind: "file", label: "n3" }, { id: "n4", kind: "file", label: "n4" },
      ],
      edges: [
        { from: "n1", to: "n2", kind: "co-edits", weight: 1 },
        { from: "n3", to: "n4", kind: "co-edits", weight: 1 },
      ],
      builtAt: "x", source: "test",
    };
    const r = louvain(g);
    expect(r.modularity).toBeGreaterThanOrEqual(-0.5);
    expect(r.modularity).toBeLessThanOrEqual(1);
  });

  it("auto-labels communities from filename tokens", () => {
    const g: KnowledgeGraph = {
      nodes: [
        { id: "f:auth/login.ts", kind: "file", label: "login.ts" },
        { id: "f:auth/logout.ts", kind: "file", label: "logout.ts" },
        { id: "f:auth/refresh.ts", kind: "file", label: "refresh.ts" },
      ],
      edges: [
        { from: "f:auth/login.ts", to: "f:auth/logout.ts", kind: "co-edits", weight: 3 },
        { from: "f:auth/logout.ts", to: "f:auth/refresh.ts", kind: "co-edits", weight: 3 },
        { from: "f:auth/login.ts", to: "f:auth/refresh.ts", kind: "co-edits", weight: 3 },
      ],
      builtAt: "x", source: "test",
    };
    const r = louvain(g);
    expect(r.communities.length).toBeGreaterThan(0);
    expect(r.communities[0]!.label.length).toBeGreaterThan(0);
  });
});
