import { describe, it, expect } from "vitest";
import { detectParadoxes } from "./paradox.js";
import type { ExtractedDecision } from "./decisions.js";

const dec = (
  date: string,
  summary: string,
  hash = `h${date.replace(/-/g, "")}`,
  kind: ExtractedDecision["kind"] = "switched",
): ExtractedDecision => ({
  commitHash: hash,
  shortHash: hash.slice(0, 7),
  date,
  author: "alice",
  summary,
  kind,
  confidence: 0.9,
});

describe("detectParadoxes — basic flip detection", () => {
  it("detects a clean ABA flip (Redis → in-memory → Redis)", () => {
    const decisions = [
      dec("2024-03-15", "decided to use Redis for caching"),
      dec("2024-08-20", "switched from Redis to in-memory cache"),
      dec("2025-02-10", "switched from in-memory back to Redis"),
    ];
    const paradoxes = detectParadoxes(decisions);
    expect(paradoxes.length).toBeGreaterThanOrEqual(1);
    const redis = paradoxes.find((p) => /redis|cache/i.test(p.topic));
    expect(redis).toBeDefined();
    expect(redis!.flips).toBeGreaterThanOrEqual(1);
    expect(redis!.chain).toHaveLength(3);
  });

  it("does NOT flip on continuous progress (different targets each time)", () => {
    const decisions = [
      dec("2024-01-01", "adopted React"),
      dec("2024-06-01", "switched from React to Solid"),
      dec("2024-12-01", "switched from Solid to Svelte"),
    ];
    // Each decision picks a NEW target — no return to React. No flip.
    const paradoxes = detectParadoxes(decisions);
    const ui = paradoxes.find((p) => /react|solid|svelte/i.test(p.topic));
    expect(ui?.flips ?? 0).toBe(0);
  });

  it("returns empty array when there are fewer than 2 decisions", () => {
    expect(detectParadoxes([])).toEqual([]);
    expect(detectParadoxes([dec("2024-01-01", "decided")])).toEqual([]);
  });

  it("requires at least 3 decisions to count as a flip-flop chain", () => {
    const decisions = [
      dec("2024-01-01", "use Redis cache"),
      dec("2024-06-01", "switched from Redis to in-memory cache"),
    ];
    expect(detectParadoxes(decisions)).toEqual([]);
  });
});

describe("detectParadoxes — span and metadata", () => {
  it("computes spanMonths between first and last decision", () => {
    const decisions = [
      dec("2024-01-01", "use Redis cache"),
      dec("2024-06-01", "switched from Redis to memcache"),
      dec("2025-01-01", "back to Redis cache"),
    ];
    const p = detectParadoxes(decisions)[0]!;
    expect(p.spanMonths).toBeGreaterThan(11);
    expect(p.spanMonths).toBeLessThan(13);
  });

  it("attaches a question that prompts an ADR for repeated reversals", () => {
    const decisions = [
      dec("2024-01-01", "passport oauth"),
      dec("2024-06-01", "switched from passport to custom auth"),
      dec("2025-01-01", "switched back to passport"),
    ];
    const p = detectParadoxes(decisions)[0]!;
    expect(p.question.toLowerCase()).toMatch(/reversal|adr|mistake|context/);
  });
});

describe("detectParadoxes — sort order", () => {
  it("sorts paradoxes by flip count desc, then by span", () => {
    const decisions = [
      // topic A: 2 flips (ABABA-ish)
      dec("2024-01-01", "use Redis cache fast"),
      dec("2024-04-01", "switched from Redis cache to memcached fast"),
      dec("2024-08-01", "back to Redis cache"),
      dec("2024-12-01", "memcached cache again"),
      dec("2025-04-01", "Redis cache again"),
      // topic B: 1 flip
      dec("2024-02-01", "use webpack bundler"),
      dec("2024-07-01", "switched from webpack bundler to vite bundler"),
      dec("2024-12-01", "back to webpack bundler"),
    ];
    const paradoxes = detectParadoxes(decisions);
    expect(paradoxes[0]!.flips).toBeGreaterThanOrEqual(paradoxes[paradoxes.length - 1]!.flips);
  });
});
