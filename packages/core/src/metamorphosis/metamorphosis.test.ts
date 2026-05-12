/**
 * v1.63.0 -- METAMORPHOSIS test suite.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, mkdirSync, writeFileSync, readFileSync, existsSync, appendFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  buildMirrorReport, persistMirrorReport,
  pickQuestions, recordAnswer, readAnswers,
  inferAudience, tuneFor,
  buildAlienTemplate,
  buildCarbonReport,
  metamorphosisStatus,
} from "./metamorphosis.js";

function setupRepo(): string {
  const r = mkdtempSync(join(tmpdir(), "mneme-meta-"));
  // Seed the reactor ledger so mirror + carbon reports have signal.
  const ledgerDir = join(r, ".mneme", "reactor");
  mkdirSync(ledgerDir, { recursive: true });
  const events = [
    { tokensSpent: 50, baselineTokens: 500, tokensSaved: 450, savingsRatio: 0.9, method: "cache_exact_hit", ts: new Date().toISOString() },
    { tokensSpent: 80, baselineTokens: 800, tokensSaved: 720, savingsRatio: 0.9, method: "slice_targeted", ts: new Date().toISOString() },
    { tokensSpent: 200, baselineTokens: 300, tokensSaved: 100, savingsRatio: 0.33, method: "compiled_intent_miss", ts: new Date().toISOString() },
  ];
  for (const e of events) appendFileSync(join(ledgerDir, "ledger.jsonl"), JSON.stringify(e) + "\n", "utf8");
  return r;
}
function cleanup(r: string) { try { rmSync(r, { recursive: true, force: true }); } catch { /* */ } }

// ─── Layer 1: Transparency Mirror ────────────────────────────────────

describe("v1.63 Metamorphosis L1 · Transparency Mirror", () => {
  let r: string;
  beforeEach(() => { r = setupRepo(); });
  afterEach(() => cleanup(r));

  it("builds a report from the reactor ledger", () => {
    const report = buildMirrorReport(r, 7);
    expect(report.tokensSaved).toBe(1270);
    expect(report.totalCalls).toBe(3);
    expect(report.topMethods.length).toBeGreaterThan(0);
    expect(report.plain).toContain("Mneme saved you");
  });

  it("identifies biggest waste (lowest-leverage method)", () => {
    // Add several rows of low-leverage method so it qualifies as biggestWaste.
    const ledger = join(r, ".mneme/reactor/ledger.jsonl");
    for (let i = 0; i < 3; i++) {
      appendFileSync(ledger, JSON.stringify({
        tokensSpent: 200, baselineTokens: 300, tokensSaved: 100,
        savingsRatio: 0.33, method: "compiled_intent_miss",
        ts: new Date().toISOString(),
      }) + "\n", "utf8");
    }
    const report = buildMirrorReport(r);
    expect(report.biggestWaste).not.toBeNull();
    if (report.biggestWaste) {
      expect(report.biggestWaste.ratio).toBeLessThan(0.5);
    }
  });

  it("persists the report", () => {
    const report = buildMirrorReport(r);
    const path = persistMirrorReport(r, report);
    expect(existsSync(path)).toBe(true);
    expect(existsSync(join(r, ".mneme/metamorphosis/mirror/latest.json"))).toBe(true);
  });
});

// ─── Layer 2: Interview Protocol ─────────────────────────────────────

describe("v1.63 Metamorphosis L2 · Interview Protocol", () => {
  let r: string;
  beforeEach(() => { r = setupRepo(); });
  afterEach(() => cleanup(r));

  it("picks 3 diverse questions on a fresh repo", () => {
    const qs = pickQuestions(r, 3);
    expect(qs.length).toBe(3);
    const topics = new Set(qs.map((q) => q.topic));
    expect(topics.size).toBeGreaterThanOrEqual(2);
  });

  it("skips recently-answered questions", () => {
    const qs = pickQuestions(r, 3);
    recordAnswer(r, qs[0]!, "answered already");
    const next = pickQuestions(r, 3);
    expect(next.find((q) => q.id === qs[0]!.id)).toBeUndefined();
  });

  it("recordAnswer persists + computes word count", () => {
    const qs = pickQuestions(r, 1);
    const a = recordAnswer(r, qs[0]!, "this is a five word answer");
    expect(a.wordCount).toBe(6);
    const all = readAnswers(r);
    expect(all.length).toBe(1);
  });
});

// ─── Layer 3: Audience Layer ─────────────────────────────────────────

describe("v1.63 Metamorphosis L3 · Audience Layer", () => {
  it("classifies engineer prompt", () => {
    const p = inferAudience("refactor the auth function in middleware.ts to use async/await");
    expect(p.role).toBe("engineer");
    expect(p.codeFirst).toBe(true);
  });

  it("classifies PM prompt", () => {
    const p = inferAudience("what's the sprint roadmap for Q2 jira backlog");
    expect(p.role).toBe("pm");
  });

  it("classifies executive prompt", () => {
    const p = inferAudience("show me the customer retention impact of last quarter's churn");
    expect(p.role).toBe("executive");
  });

  it("classifies security prompt", () => {
    const p = inferAudience("scan for CVE in our PCI flow + SOC2 compliance");
    expect(p.role).toBe("security");
  });

  it("classifies customer prompt", () => {
    const p = inferAudience("I forgot my password and need a refund");
    expect(p.role).toBe("customer");
  });

  it("tuneFor returns appropriate instructions per role", () => {
    const t = tuneFor({ role: "executive", verbosity: "terse", codeFirst: false, observedAt: "" });
    expect(t.toneInstructions.some((s) => /business impact/i.test(s))).toBe(true);
    expect(t.estimatedTokenAdjustment).toBeLessThan(0); // executives prefer terse
  });

  it("verbose audience increases token budget", () => {
    const t = tuneFor({ role: "engineer", verbosity: "verbose", codeFirst: true, observedAt: "" });
    expect(t.estimatedTokenAdjustment).toBeGreaterThanOrEqual(0);
  });
});

// ─── Layer 4: Alien Protocol ─────────────────────────────────────────

describe("v1.63 Metamorphosis L4 · Alien Protocol", () => {
  it("matches wisdom cards by pattern token", () => {
    const t = buildAlienTemplate("write tests for the auth middleware");
    expect(t.matchedCards.length).toBeGreaterThan(0);
    expect(t.matchedCards.some((c) => c.id.includes("test"))).toBe(true);
  });

  it("substitutes $TARGET in templates", () => {
    const t = buildAlienTemplate("find where the harmonic mean is computed");
    expect(t.template).toContain("harmonic");
  });

  it("no-match prompt yields fallback template", () => {
    const t = buildAlienTemplate("xyz qrs lmn");
    expect(t.matchedCards.length).toBe(0);
    expect(t.template).toContain("no cards matched");
  });

  it("estimatedTokens reflects template length", () => {
    const t = buildAlienTemplate("refactor the database layer");
    expect(t.estimatedTokens).toBeGreaterThan(0);
    expect(t.estimatedTokens).toBeLessThan(200);
  });
});

// ─── Layer 5: Carbon Budget ──────────────────────────────────────────

describe("v1.63 Metamorphosis L5 · Carbon Budget", () => {
  let r: string;
  beforeEach(() => { r = setupRepo(); });
  afterEach(() => cleanup(r));

  it("computes CO2 from token spend", () => {
    const c = buildCarbonReport(r);
    expect(c.co2GramsSaved).toBeGreaterThan(0);
    expect(c.equivalents.kmDriven).toBeGreaterThan(0);
    expect(c.equivalents.smartphoneCharges).toBeGreaterThan(0);
  });

  it("empty ledger -> zero CO2", () => {
    const empty = mkdtempSync(join(tmpdir(), "empty-"));
    try {
      const c = buildCarbonReport(empty);
      expect(c.co2GramsSaved).toBe(0);
    } finally {
      rmSync(empty, { recursive: true, force: true });
    }
  });
});

// ─── Status rollup ───────────────────────────────────────────────────

describe("v1.63 Metamorphosis · status rollup", () => {
  let r: string;
  beforeEach(() => { r = setupRepo(); });
  afterEach(() => cleanup(r));

  it("status reports across all 5 layers", () => {
    const s = metamorphosisStatus(r);
    expect(s.hasMirrorReport).toBe(false); // not persisted yet
    expect(s.interviewAnswered).toBe(0);
    expect(s.carbonGramsSaved).toBeGreaterThan(0);
  });
});
