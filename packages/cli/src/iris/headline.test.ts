import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, existsSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  HEADLINE_SYSTEM_PROMPT,
  clearHeadlineCache,
  extractiveHeadline,
  generateHeadline,
  sanitizeHeadline,
} from "./headline.js";
import type { HeadlineEnricher } from "./headline.js";

let tmpDir: string;

beforeEach(() => {
  tmpDir = mkdtempSync(join(tmpdir(), "mneme-iris-headline-test-"));
});
afterEach(() => {
  if (existsSync(tmpDir)) rmSync(tmpDir, { recursive: true, force: true });
});

// ─── extractiveHeadline ────────────────────────────────────────────────

describe("extractiveHeadline — fallback per command type", () => {
  it("forensics: leads with critical count when present", () => {
    expect(extractiveHeadline("forensics", { criticalCount: 3, topSubject: "verify alice@bank.com" }))
      .toMatch(/3 critical anomalies/);
  });

  it("forensics: high count when no criticals", () => {
    expect(extractiveHeadline("forensics", { criticalCount: 0, highCount: 2 }))
      .toMatch(/2 high-severity findings/);
  });

  it("forensics: clean when nothing found", () => {
    expect(extractiveHeadline("forensics", {})).toMatch(/Clean forensics scan/);
  });

  it("guard: blocked count first", () => {
    expect(extractiveHeadline("guard", { blockedCount: 2 })).toMatch(/2 changes blocked/);
  });

  it("guard: warned when not blocked", () => {
    expect(extractiveHeadline("guard", { warnedCount: 1 })).toMatch(/1 warning/);
  });

  it("guard: clean by default", () => {
    expect(extractiveHeadline("guard", {})).toMatch(/Guard passed/);
  });

  it("status: includes commits + duration when present", () => {
    expect(extractiveHeadline("status", { commitsIndexed: 5000, durationMs: 12000 }))
      .toContain("5,000 commits");
  });

  it("ask: includes confidence + evidence count", () => {
    expect(extractiveHeadline("ask", { confidence: "high", evidenceCount: 3 }))
      .toMatch(/high confidence, 3 citations/);
  });

  it("insight: shows top insight when given", () => {
    expect(extractiveHeadline("insight", { count: 4, topInsight: "ownership drift" }))
      .toContain("ownership drift");
  });

  it("quant: includes metric + value", () => {
    expect(extractiveHeadline("quant", { metric: "MTBF", value: "7d", trend: "up" }))
      .toMatch(/MTBF 7d/);
  });

  it("do: action — result", () => {
    expect(extractiveHeadline("do", { action: "indexed", result: "5k commits" }))
      .toMatch(/indexed.*5k commits/);
  });

  it("generic: falls back to provided summary", () => {
    expect(extractiveHeadline("generic", { summary: "All systems nominal" }))
      .toBe("All systems nominal");
  });

  it("generic: hardcoded fallback when nothing useful given", () => {
    expect(extractiveHeadline("generic", {})).toBe("Command completed");
  });
});

// ─── sanitizeHeadline ───────────────────────────────────────────────────

describe("sanitizeHeadline", () => {
  it("strips wrapping double-quotes", () => {
    expect(sanitizeHeadline('"hello world"')).toBe("hello world");
  });

  it("strips wrapping single-quotes", () => {
    expect(sanitizeHeadline("'hello'")).toBe("hello");
  });

  it("takes only the first non-empty line", () => {
    expect(sanitizeHeadline("first\nsecond")).toBe("first");
  });

  it("ignores leading blank lines", () => {
    expect(sanitizeHeadline("\n\nactual headline")).toBe("actual headline");
  });

  it("caps very long input at 140 chars", () => {
    const huge = "x".repeat(500);
    expect(sanitizeHeadline(huge).length).toBeLessThanOrEqual(140);
  });

  it("strips a leading emoji prefix", () => {
    expect(sanitizeHeadline("🚀 ship it")).toBe("ship it");
  });
});

// ─── generateHeadline — fallback path ──────────────────────────────────

describe("generateHeadline — extractive fallback", () => {
  it("returns extractive headline when no enricher provided", async () => {
    const out = await generateHeadline({
      commandType: "forensics",
      data: { criticalCount: 1, topSubject: "x" },
    });
    expect(out).toMatch(/1 critical anomaly/);
  });

  it("never throws even on empty data", async () => {
    const out = await generateHeadline({ commandType: "generic", data: {} });
    expect(typeof out).toBe("string");
    expect(out.length).toBeGreaterThan(0);
  });
});

// ─── generateHeadline — LLM path ───────────────────────────────────────

describe("generateHeadline — LLM enricher", () => {
  it("uses the enricher's text when present", async () => {
    const enricher: HeadlineEnricher = {
      name: "test",
      async enrich() {
        return { text: "5 anomalies — fix alice now" };
      },
    };
    const out = await generateHeadline({
      commandType: "forensics",
      data: { criticalCount: 5 },
      enricher,
      repoRoot: tmpDir,
    });
    expect(out).toBe("5 anomalies — fix alice now");
  });

  it("falls back to extractive on timeout", async () => {
    const enricher: HeadlineEnricher = {
      name: "slow",
      async enrich() {
        await new Promise((r) => setTimeout(r, 200));
        return { text: "too late" };
      },
    };
    const out = await generateHeadline({
      commandType: "forensics",
      data: { criticalCount: 2 },
      enricher,
      timeoutMs: 20,
      repoRoot: tmpDir,
    });
    expect(out).toMatch(/2 critical anomalies/);
  });

  it("falls back to extractive when enricher throws", async () => {
    const enricher: HeadlineEnricher = {
      name: "broken",
      async enrich() {
        throw new Error("network down");
      },
    };
    const out = await generateHeadline({
      commandType: "guard",
      data: { blockedCount: 1 },
      enricher,
    });
    expect(out).toMatch(/1 change blocked/);
  });

  it("falls back when enricher returns empty text", async () => {
    const enricher: HeadlineEnricher = {
      name: "empty",
      async enrich() {
        return { text: "" };
      },
    };
    const out = await generateHeadline({
      commandType: "ask",
      data: { confidence: "high", evidenceCount: 2 },
      enricher,
    });
    expect(out).toMatch(/high confidence/);
  });

  it("caches a successful headline + reuses on second call", async () => {
    let calls = 0;
    const enricher: HeadlineEnricher = {
      name: "counter",
      async enrich() {
        calls++;
        return { text: "cached headline result" };
      },
    };
    const data = { criticalCount: 9 };
    const a = await generateHeadline({
      commandType: "forensics",
      data,
      enricher,
      repoRoot: tmpDir,
    });
    const b = await generateHeadline({
      commandType: "forensics",
      data,
      enricher,
      repoRoot: tmpDir,
    });
    expect(a).toBe("cached headline result");
    expect(b).toBe("cached headline result");
    expect(calls).toBe(1);
  });

  it("ignores expired cache (>7d old)", async () => {
    let calls = 0;
    const enricher: HeadlineEnricher = {
      name: "v",
      async enrich() {
        calls++;
        return { text: "fresh-" + calls };
      },
    };
    const data = { x: 1 };
    const t0 = Date.parse("2024-01-01T00:00:00.000Z");
    const t1 = t0 + 8 * 24 * 60 * 60 * 1000; // 8 days later — expired

    await generateHeadline({
      commandType: "generic",
      data,
      enricher,
      repoRoot: tmpDir,
      nowMs: t0,
    });
    const second = await generateHeadline({
      commandType: "generic",
      data,
      enricher,
      repoRoot: tmpDir,
      nowMs: t1,
    });
    expect(calls).toBe(2);
    expect(second).toBe("fresh-2");
  });

  it("clearHeadlineCache wipes the cache file", () => {
    // Trigger creation by writing a cached headline
    return generateHeadline({
      commandType: "generic",
      data: { x: 1 },
      enricher: {
        name: "n",
        async enrich() {
          return { text: "cached" };
        },
      },
      repoRoot: tmpDir,
    }).then(() => {
      const path = join(tmpDir, ".mneme", "iris-headlines.json");
      expect(existsSync(path)).toBe(true);
      const raw = readFileSync(path, "utf8");
      expect(raw).toContain("cached");
      clearHeadlineCache(tmpDir);
      expect(existsSync(path)).toBe(false);
    });
  });
});

// ─── system prompt is verbatim ─────────────────────────────────────────

describe("HEADLINE_SYSTEM_PROMPT", () => {
  it("contains required rules", () => {
    expect(HEADLINE_SYSTEM_PROMPT).toContain("12 words");
    expect(HEADLINE_SYSTEM_PROMPT).toContain("Past tense");
    expect(HEADLINE_SYSTEM_PROMPT).toContain("imperative");
  });
});
