import { describe, expect, it } from "vitest";
import { CURATED_DEFAULT_TOOLS, listCuratedNames, curatedByCategory } from "./curated_tools.js";

describe("curated_tools (v1.42.5 #16 fix)", () => {
  it("ships exactly 20 entries (the headline number in user-facing copy)", () => {
    expect(CURATED_DEFAULT_TOOLS.length).toBe(20);
  });

  it("every entry has name + why + valid category", () => {
    const validCategories = new Set(["intro", "memory", "audit", "people", "insights", "quality", "lab", "system"]);
    for (const t of CURATED_DEFAULT_TOOLS) {
      expect(t.name).toMatch(/^mneme\.[a-z_]+(\.[a-z_]+)*$/);
      expect(t.why.length).toBeGreaterThan(20);     // not a placeholder
      expect(validCategories.has(t.category)).toBe(true);
    }
  });

  it("listCuratedNames returns 20 unique tool names", () => {
    const names = listCuratedNames();
    expect(names.length).toBe(20);
    expect(new Set(names).size).toBe(20);   // no duplicates
  });

  it("curatedByCategory groups + every category has at least 1 tool", () => {
    const grouped = curatedByCategory();
    for (const [cat, tools] of Object.entries(grouped)) {
      expect(tools.length).toBeGreaterThan(0);
      for (const t of tools) expect(t.category).toBe(cat);
    }
  });

  it("each curated entry's name uses the canonical mneme.<category>.<verb> shape", () => {
    for (const t of CURATED_DEFAULT_TOOLS) {
      const parts = t.name.split(".");
      expect(parts[0]).toBe("mneme");
      expect(parts.length).toBeGreaterThanOrEqual(2);
    }
  });
});
