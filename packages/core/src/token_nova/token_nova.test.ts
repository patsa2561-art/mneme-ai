import { describe, it, expect } from "vitest";

import {
  preemptViaVaccine,
  mirrorDedup,
  buildLineageIndex,
  fractalDecay,
  tokenizerArbitrage,
  BUILTIN_TOKENIZER_TABLE,
  applyTokenNova,
  computeSavingsReport,
  formatPulseSavingsLine,
  estimateTokens,
  type VaccineEntry,
  type ContextTurn,
  type SavingsEvent,
} from "./index.js";

describe("v1.93 TOKEN-NOVA · 1. VACCINE PRE-EMPTION", () => {
  const bank: VaccineEntry[] = [
    { pattern: "delete .mneme", strain: "destructive", refutation: "Refuse: .mneme/ is protected user state. Ask for explicit confirmation." },
    { pattern: "JWT.*5.?min.*tolerance", strain: "regret-echo", refutation: "Warning: this exact change broke prod 2024-09-07 (commit a3f9b21). Re-confirm before proceeding." },
  ];

  it("returns preempted=false when query matches no pattern", () => {
    const r = preemptViaVaccine("how do I refactor users.ts?", bank);
    expect(r.preempted).toBe(false);
    expect(r.refutation).toBeNull();
    expect(r.savedTokensEstimate).toBe(0);
  });

  it("returns preempted=true with cached refutation on substring match", () => {
    const r = preemptViaVaccine("rm -rf delete .mneme directory", bank);
    expect(r.preempted).toBe(true);
    expect(r.refutation).toContain("Refuse");
    expect(r.strain).toBe("destructive");
    expect(r.savedTokensEstimate).toBeGreaterThan(0);
  });

  it("regex pattern matches case-insensitively", () => {
    const r = preemptViaVaccine("Tighten the JWT 5-minute tolerance", bank);
    expect(r.preempted).toBe(true);
    expect(r.strain).toBe("regret-echo");
  });

  it("savedTokensEstimate includes prompt cost + avg AI reply cost", () => {
    const r = preemptViaVaccine("delete .mneme please", bank);
    expect(r.savedTokensEstimate).toBeGreaterThanOrEqual(350); // AVG_AI_REPLY_TOKENS
  });
});

describe("v1.93 TOKEN-NOVA · 2. MIRROR-MIND DEDUP", () => {
  const lineage = buildLineageIndex(new Map([
    ["e3b0c44298fc", "chromosome-abc"], // fake hash; real hash computed inside
  ]));

  it("returns identical text when nothing in lineage matches", () => {
    const r = mirrorDedup("a totally new block of context that has never been seen before in any chromosome", lineage);
    expect(r.refsInserted).toBe(0);
    expect(r.text).toContain("totally new block");
    expect(r.saved).toBe(0);
  });

  it("replaces known chunk with chromosome reference", () => {
    const known = "x".repeat(200); // 200 chars, large enough to dedup
    const { createHash } = require("node:crypto");
    const hash = createHash("sha256").update(known).digest("hex").slice(0, 12);
    const lineageWithKnown = buildLineageIndex(new Map([[hash, "chrom-xyz"]]));
    const r = mirrorDedup(known, lineageWithKnown);
    expect(r.refsInserted).toBe(1);
    expect(r.text).toContain("mneme:chromosome:chrom-xyz");
    expect(r.saved).toBeGreaterThan(0);
    expect(r.afterTokens).toBeLessThan(r.beforeTokens);
  });

  it("keeps small chunks verbatim (below MIN_CHUNK_CHARS)", () => {
    const tiny = "short";
    const r = mirrorDedup(tiny, lineage);
    expect(r.text).toBe(tiny);
    expect(r.refsInserted).toBe(0);
  });

  it("preserves structure (\\n\\n block boundaries)", () => {
    const text = ["block 1 padding ".repeat(20), "block 2 padding ".repeat(20)].join("\n\n");
    const r = mirrorDedup(text, lineage);
    expect(r.text.split("\n\n").length).toBe(2);
  });
});

describe("v1.93 TOKEN-NOVA · 3. FRACTAL CONTEXT DECAY", () => {
  it("keeps current turn (age=0) at 100%", () => {
    const turns: ContextTurn[] = [{ age: 0, text: "this is the newest turn full text".repeat(10) }];
    const r = fractalDecay(turns);
    expect(r.totalBefore).toBe(r.totalAfter);
    expect(r.saved).toBe(0);
    expect(r.turns[0]!.text).toBe(turns[0]!.text);
  });

  it("decays older turns at power-of-2 ratio", () => {
    const longText = "abcdefghij".repeat(50); // 500 chars
    const turns: ContextTurn[] = [
      { age: 0, text: longText },
      { age: 1, text: longText },
      { age: 2, text: longText },
      { age: 3, text: longText },
    ];
    const r = fractalDecay(turns, { ratio: 0.5 });
    expect(r.turns[0]!.text.length).toBe(500);
    expect(r.turns[1]!.text.length).toBeLessThanOrEqual(500 * 0.5 + 10);
    expect(r.turns[2]!.text.length).toBeLessThanOrEqual(500 * 0.25 + 10);
    expect(r.turns[3]!.text.length).toBeLessThanOrEqual(500 * 0.125 + 10);
    expect(r.saved).toBeGreaterThan(0);
  });

  it("respects minChars floor", () => {
    const turns: ContextTurn[] = [{ age: 10, text: "abc def ghi jkl mno".repeat(10) }];
    const r = fractalDecay(turns, { ratio: 0.5, minChars: 24 });
    expect(r.turns[0]!.text.length).toBeGreaterThanOrEqual(24);
  });

  it("truncates at sentence boundary when possible", () => {
    const turns: ContextTurn[] = [{ age: 1, text: "First sentence. Second sentence. Third sentence here. Fourth." }];
    const r = fractalDecay(turns, { ratio: 0.5 });
    // Should end at "." or "!" or "?" near the budget cutoff
    expect(r.turns[0]!.text).toMatch(/[.!?][\s\]]/);
  });
});

describe("v1.93 TOKEN-NOVA · 4. TOKENIZER ARBITRAGE", () => {
  it("rewrites TypeScript -> TS for Claude (saves chars)", () => {
    const r = tokenizerArbitrage("I use TypeScript for backend and TypeScript for frontend", "claude");
    expect(r.text).toContain("TS for backend");
    expect(r.text).not.toContain("TypeScript");
    expect(r.saved).toBeGreaterThan(0);
    expect(r.substitutions).toBeGreaterThanOrEqual(1);
  });

  it("returns identity when vendor not in table", () => {
    const r = tokenizerArbitrage("TypeScript code", "unknown-vendor");
    expect(r.text).toBe("TypeScript code");
    expect(r.saved).toBe(0);
  });

  it("BUILTIN_TOKENIZER_TABLE has Claude, GPT, Gemini profiles", () => {
    const vendors = BUILTIN_TOKENIZER_TABLE.map((p) => p.vendor);
    expect(vendors).toContain("claude");
    expect(vendors).toContain("gpt");
    expect(vendors).toContain("gemini");
  });

  it("each profile has at least 5 rewrites", () => {
    for (const p of BUILTIN_TOKENIZER_TABLE) {
      expect(p.rewrites.length).toBeGreaterThanOrEqual(5);
    }
  });

  it("verbose phrasing is shortened (in order to / due to the fact that)", () => {
    const r = tokenizerArbitrage("We do this in order to test, and due to the fact that it works", "claude");
    expect(r.text).toContain(" to test");
    expect(r.text).toContain("because it works");
    expect(r.saved).toBeGreaterThan(0);
  });
});

describe("v1.93 TOKEN-NOVA · FUSION (all 4 techniques)", () => {
  it("vaccine pre-empt short-circuits everything else (saves max tokens)", () => {
    const r = applyTokenNova({
      query: "delete .mneme directory",
      turns: [{ age: 0, text: "context goes here" }],
      vendor: "claude",
      vaccineBank: [{ pattern: "delete .mneme", strain: "destructive", refutation: "Refuse." }],
    });
    expect(r.preempted).toBe(true);
    expect(r.totalSaved).toBeGreaterThan(0);
    expect(r.events.length).toBe(1);
    expect(r.events[0]!.technique).toBe("vaccine-preempt");
  });

  it("stacks fractal + dedup + arbitrage when no pre-empt", () => {
    const turns: ContextTurn[] = [
      { age: 0, text: "current TypeScript implementation for the configuration".repeat(3) },
      { age: 1, text: "previous TypeScript implementation for the configuration".repeat(10) },
      { age: 2, text: "older TypeScript implementation for the configuration".repeat(10) },
    ];
    const r = applyTokenNova({
      query: "refactor users.ts",
      turns,
      vendor: "claude",
    });
    expect(r.preempted).toBe(false);
    expect(r.totalSaved).toBeGreaterThan(0);
    const techniques = r.events.map((e) => e.technique);
    expect(techniques).toContain("fractal-decay");
    expect(techniques).toContain("tokenizer-arbitrage");
  });

  it("savings ratio is between 0 and 1", () => {
    const turns: ContextTurn[] = [
      { age: 0, text: "small ctx" },
      { age: 1, text: "larger old ctx with TypeScript and configuration".repeat(20) },
    ];
    const r = applyTokenNova({ query: "x", turns, vendor: "claude" });
    expect(r.savingsRatio).toBeGreaterThanOrEqual(0);
    expect(r.savingsRatio).toBeLessThanOrEqual(1);
  });
});

describe("v1.93 TOKEN-NOVA · savings report", () => {
  const sampleEvents: SavingsEvent[] = [
    { ts: Date.now(), technique: "vaccine-preempt", before: 400, after: 0, saved: 400, vendor: "claude", id: "a" },
    { ts: Date.now(), technique: "fractal-decay", before: 800, after: 320, saved: 480, vendor: "claude", id: "b" },
    { ts: Date.now(), technique: "mirror-dedup", before: 200, after: 80, saved: 120, vendor: "gpt", id: "c" },
    { ts: Date.now(), technique: "tokenizer-arbitrage", before: 300, after: 270, saved: 30, vendor: "claude", id: "d" },
    { ts: Date.now() - 100 * 24 * 60 * 60 * 1000, technique: "vaccine-preempt", before: 9999, after: 0, saved: 9999, vendor: "claude", id: "e" }, // outside window
  ];

  it("totals savings across techniques in window", () => {
    const r = computeSavingsReport(sampleEvents, 30);
    expect(r.totalSavedTokens).toBe(400 + 480 + 120 + 30);
    expect(r.totalEvents).toBe(4); // the 100-day-old one is excluded
  });

  it("computes per-vendor breakdown", () => {
    const r = computeSavingsReport(sampleEvents, 30);
    expect(r.vendorSavings.claude).toBe(400 + 480 + 30);
    expect(r.vendorSavings.gpt).toBe(120);
  });

  it("identifies top technique", () => {
    const r = computeSavingsReport(sampleEvents, 30);
    expect(r.topTechnique).toBe("fractal-decay"); // 480 > 400 > 120 > 30
  });

  it("estimates USD saved using vendor price table", () => {
    const r = computeSavingsReport(sampleEvents, 30);
    expect(r.estimatedUsdSaved).toBeGreaterThan(0);
    // Claude: (400+480+30)/1000 * 0.003 = 0.00273
    // GPT:    120/1000 * 0.0025         = 0.0003
    // Total ~ 0.003
    expect(r.estimatedUsdSaved).toBeCloseTo(0.003, 2);
  });

  it("formatPulseSavingsLine produces a compact one-liner", () => {
    const r = computeSavingsReport(sampleEvents, 30);
    const line = formatPulseSavingsLine(r);
    expect(line).toContain("TOKEN-NOVA");
    expect(line).toContain("tokens saved");
    expect(line).toContain("$");
    expect(line).toContain("top=fractal-decay");
  });

  it("handles empty event list gracefully", () => {
    const r = computeSavingsReport([], 30);
    expect(r.totalSavedTokens).toBe(0);
    expect(r.topTechnique).toBeNull();
    expect(formatPulseSavingsLine(r)).toContain("0 tokens saved");
  });
});

describe("v1.93 TOKEN-NOVA · estimator sanity", () => {
  it("estimates ~1 token per 3.5 chars", () => {
    expect(estimateTokens("")).toBe(0);
    expect(estimateTokens("abc")).toBeGreaterThan(0);
    // 350 chars should be ~100 tokens at 1/3.5
    expect(estimateTokens("a".repeat(350))).toBe(100);
  });
});
