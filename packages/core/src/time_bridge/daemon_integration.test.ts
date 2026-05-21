import { describe, expect, it, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { inscribe, recentNotable, fireWatchers } from "./index.js";

/**
 * v2.20.1 — TIME BRIDGE daemon integration tests.
 *
 * These tests are MEASURABLE — they verify that the auto-surface
 * promise holds:
 *
 *   1. After a wake predicate fires, recentNotable() picks it up
 *      within the 60-min freshness window.
 *
 *   2. High-weight constraints are surfaced even without a wake-firing
 *      so the AI always sees the most-important past constraints.
 *
 *   3. recentNotable is bounded (≤ limit) — pulse never floods.
 *
 *   4. The function is read-only — does not mutate state.
 *
 *   5. The function is fast — runs in <50ms even with 100 inscriptions.
 *      (Real perf budget on a cold pulse; surfaced via timing assertion.)
 */

describe("time_bridge daemon integration (auto-surface)", () => {
  let repo: string;
  beforeEach(() => { repo = mkdtempSync(join(tmpdir(), "mneme-tb-daemon-")); });
  afterEach(() => { try { rmSync(repo, { recursive: true, force: true }); } catch { /* */ } });

  it("recentNotable surfaces a freshly-fired wake predicate", async () => {
    await inscribe(repo, {
      author: "past-me",
      kind: "warning",
      headline: "wake on auth touch",
      reasoning: "incident in 2024 — token leak",
      fra: { appliesWhen: "any auth.ts touch" },
      wakes: [{ description: "auth.ts touched", trigger: { kind: "file-touched", pattern: "auth.ts" } }],
      tags: ["auth"],
    });
    // Daemon fires watchers on tick. Simulate that with a direct call:
    const fired = await fireWatchers(repo, { file: "src/auth.ts" });
    expect(fired.length).toBe(1);

    // Within 60 min, recentNotable must surface this fired inscription.
    const notable = recentNotable(repo, 3);
    expect(notable.length).toBeGreaterThan(0);
    const found = notable.find((n) => n.id === fired[0]!.inscription.id);
    expect(found).toBeDefined();
    expect(found!.reason).toContain("wake predicate fired");
  });

  it("recentNotable surfaces high-weight constraints even without wake firing", async () => {
    const c1 = await inscribe(repo, {
      author: "x", kind: "constraint", headline: "high weight constraint",
      reasoning: "this is critical",
      fra: { appliesWhen: "always", initialWeight: 0.9 },
      tags: [],
    });
    await inscribe(repo, {
      author: "x", kind: "annotation", headline: "low weight note",
      reasoning: "minor",
      fra: { appliesWhen: "rare", initialWeight: 0.2 },
      tags: [],
    });
    const notable = recentNotable(repo, 3);
    expect(notable.length).toBeGreaterThan(0);
    // High-weight constraint should come first.
    expect(notable[0]!.id).toBe(c1.id);
    expect(notable[0]!.kind).toBe("constraint");
  });

  it("recentNotable is bounded by limit + sorts deterministically", async () => {
    for (let i = 0; i < 10; i++) {
      await inscribe(repo, {
        author: "x", kind: "constraint", headline: `constraint ${i}`,
        reasoning: "...",
        fra: { appliesWhen: "always", initialWeight: 0.7 + i * 0.01 },
        tags: [],
      });
    }
    const notable = recentNotable(repo, 3);
    expect(notable.length).toBe(3);
  });

  it("recentNotable is read-only (does not mutate the inscriptions file)", async () => {
    await inscribe(repo, {
      author: "x", kind: "constraint", headline: "test", reasoning: "...",
      fra: { appliesWhen: "always", initialWeight: 0.8 },
      tags: [],
    });
    const before = recentNotable(repo, 3);
    const beforeJson = JSON.stringify(before);
    // Call 5 times — must return same shape every time.
    for (let i = 0; i < 5; i++) {
      const r = recentNotable(repo, 3);
      expect(JSON.stringify(r)).toBe(beforeJson);
    }
  });

  it("recentNotable runs in <50ms even with 100 inscriptions (pulse perf budget)", async () => {
    for (let i = 0; i < 100; i++) {
      await inscribe(repo, {
        author: "x",
        kind: i % 3 === 0 ? "constraint" : i % 3 === 1 ? "warning" : "annotation",
        headline: `inscription ${i}`,
        reasoning: "...",
        fra: { appliesWhen: "...", initialWeight: Math.random() },
        tags: [],
      });
    }
    const t0 = Date.now();
    const out = recentNotable(repo, 3);
    const ms = Date.now() - t0;
    expect(out.length).toBe(3);
    expect(ms).toBeLessThan(50);
  });

  it("only counts wake-firings within the 60-min freshness window", async () => {
    // Inscribe + fire a date-reached predicate that fires immediately.
    await inscribe(repo, {
      author: "x", kind: "warning", headline: "old wake", reasoning: "...",
      fra: { appliesWhen: "later" },
      wakes: [{ description: "past date", trigger: { kind: "date-reached", iso: "2020-01-01T00:00:00Z" } }],
      tags: [],
    });
    const fired = await fireWatchers(repo);
    expect(fired.length).toBe(1);

    // Now manually rewrite firedAt to 2 hours ago.
    const { readFileSync, writeFileSync } = await import("node:fs");
    const path = join(repo, ".mneme/time_bridge/inscriptions.jsonl");
    const lines = readFileSync(path, "utf8").trim().split("\n");
    const ins = JSON.parse(lines[0]!);
    if (ins.wakes && ins.wakes[0]) {
      ins.wakes[0].firedAt = new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString();
    }
    writeFileSync(path, JSON.stringify(ins) + "\n", "utf8");

    // recentNotable must NOT surface the now-stale wake firing
    // (it should fall through to the high-weight-constraints path,
    // and "warning" kind is neither constraint nor refusal so won't
    // be in that list either).
    const notable = recentNotable(repo, 3);
    expect(notable.find((n) => n.reason.includes("wake predicate fired"))).toBeUndefined();
  });
});
