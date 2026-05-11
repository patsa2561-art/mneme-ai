import { describe, expect, it, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { deposit, readTrails, renderPheromoneBlock } from "./ai_pheromone.js";

describe("ai_pheromone · deposit + decay + read", () => {
  let repo: string;
  beforeEach(() => { repo = mkdtempSync(join(tmpdir(), "mneme-phe-")); });
  afterEach(() => { try { rmSync(repo, { recursive: true, force: true }); } catch { /* */ } });

  it("readTrails on empty repo returns []", () => {
    expect(readTrails(repo)).toEqual([]);
  });

  it("deposit + readTrails reflects the deposit (no decay yet, fresh ts)", () => {
    deposit(repo, "claude", "src/foo.ts", 1);
    const trails = readTrails(repo);
    expect(trails).toHaveLength(1);
    expect(trails[0]!.target).toBe("src/foo.ts");
    expect(trails[0]!.touches).toBe(1);
    expect(trails[0]!.vendors).toEqual(["claude"]);
    expect(trails[0]!.strength).toBeGreaterThan(0.99); // close to 1, no decay yet
  });

  it("multiple vendors on same target are aggregated", () => {
    deposit(repo, "claude", "src/foo.ts", 1);
    deposit(repo, "cursor", "src/foo.ts", 1);
    const trails = readTrails(repo);
    expect(trails).toHaveLength(1);
    expect(trails[0]!.vendors.sort()).toEqual(["claude", "cursor"]);
    expect(trails[0]!.touches).toBe(2);
  });

  it("decay applied — old deposit (60d) on 30d half-life ≈ strength 0.25", () => {
    // monkey-patch by writing a deposit with a stale ts
    const oldTs = new Date(Date.now() - 60 * 24 * 60 * 60 * 1000).toISOString();
    require("node:fs").mkdirSync(join(repo, ".mneme"), { recursive: true });
    require("node:fs").writeFileSync(join(repo, ".mneme/ai-pheromones.jsonl"),
      JSON.stringify({ ts: oldTs, vendor: "v", target: "x", weight: 1 }) + "\n");
    const trails = readTrails(repo);
    expect(trails[0]!.strength).toBeGreaterThan(0.2);
    expect(trails[0]!.strength).toBeLessThan(0.3); // 0.5^(60/30) = 0.25
  });

  it("vendor filter narrows to one vendor's deposits", () => {
    deposit(repo, "claude", "a.ts");
    deposit(repo, "cursor", "b.ts");
    deposit(repo, "claude", "c.ts");
    const trails = readTrails(repo, { vendor: "claude" });
    expect(trails.map((t) => t.target).sort()).toEqual(["a.ts", "c.ts"]);
  });

  it("topK limits the result", () => {
    for (let i = 0; i < 30; i++) deposit(repo, "v", "f-" + i + ".ts", i + 1);
    const trails = readTrails(repo, { topK: 5 });
    expect(trails).toHaveLength(5);
    // sorted by strength desc — top should be the heaviest weight
    expect(trails[0]!.target).toBe("f-29.ts");
  });

  it("renderPheromoneBlock returns empty string on empty repo + non-empty on populated", () => {
    expect(renderPheromoneBlock(repo)).toBe("");
    deposit(repo, "v", "src/foo.ts", 1);
    const block = renderPheromoneBlock(repo);
    expect(block).toContain("PHEROMONE TRAIL");
    expect(block).toContain("src/foo.ts");
  });
});
