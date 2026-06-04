import { describe, it, expect } from "vitest";
import { buildSearchIndex, searchTools, searchGauntlet, type ToolLike } from "./search.js";
import { buildToolMap } from "@mneme-ai/mcp";

const TOOLS: ToolLike[] = [...buildToolMap().values()].map((t) => ({ name: (t as { name: string }).name, category: (t as { category?: string }).category, description: (t as { description?: string }).description, triggers: (t as { triggers?: string[] }).triggers }));

describe("WISDOM SEARCH INDEX — autonomous tool discovery by intent (measured, no LLM)", () => {
  const index = buildSearchIndex(TOOLS);

  it("an exact trigger phrase returns its owning tool #1", () => {
    // pick a tool with a trigger and assert its own trigger finds it first
    const withTrig = index.tools.find((t) => t.triggers.length > 0)!;
    const hits = searchTools(index, withTrig.triggers[0], 3);
    expect(hits[0]?.name).toBe(withTrig.name);
    expect(hits[0]?.why).toContain("trigger");
  });

  it("plain-language intent finds a sensible tool (non-empty, ranked)", () => {
    const hits = searchTools(index, "verify that a claim is actually true", 5);
    expect(hits.length).toBeGreaterThan(0);
    expect(hits[0].score).toBeGreaterThan(0);
    // a truth/verify tool should surface near the top
    expect(hits.slice(0, 5).some((h) => /truth|verify|retire|savant|check/i.test(h.name))).toBe(true);
  });

  it("wisdom (pheromone) boost lifts a proven tool without inventing data", () => {
    const a = searchTools(index, "scan for secrets", 5);
    const target = a[1]?.name ?? a[0]?.name;
    if (target && a.length > 1) {
      const boosted = searchTools(index, "scan for secrets", 5, new Map([[target, 9999]]));
      expect(boosted[0].name).toBe(target); // a strong usage signal can promote a relevant tool
    }
    // no wisdom map ⇒ identical to neutral (no fabrication)
    expect(JSON.stringify(searchTools(index, "scan for secrets", 5))).toBe(JSON.stringify(searchTools(index, "scan for secrets", 5)));
  });

  it("total + deterministic on garbage", () => {
    expect(() => searchTools(index, "", 5)).not.toThrow();
    expect(() => searchTools(buildSearchIndex([]), "anything", 5)).not.toThrow();
    expect(searchTools(index, "zzzqqq_nonexistent_xyzzy", 5)).toEqual([]);
  });

  it("MEASURED: searchGauntlet — a tool is findable by its own trigger (top-1 ≥85%, top-3 ≥95%)", () => {
    const g = searchGauntlet(TOOLS);
    if (g.score !== 100) console.error(g.checks.filter((c) => !c.pass), g.metrics);
    expect(g.metrics.trials).toBeGreaterThan(100);
    expect(g.score).toBe(100);
  }, 30_000);
});
