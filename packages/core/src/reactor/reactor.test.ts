/**
 * v1.62.0 -- TOKEN NUCLEAR REACTOR test suite.
 *
 * Every test pins a before/after token claim. The "80% reduction" goal
 * is verified by assertion, not by marketing.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, writeFileSync, mkdirSync, existsSync, readFileSync } from "node:fs";
import { execSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  estimateTokens, metricsOf, totalSavings,
  lookupAnswer, storeAnswer, cacheStats,
  refineIntent,
  sliceFile,
  tryRecipe,
  stampShard, shardEnvelope,
  fuseToolCalls,
  shouldTruncate,
  issueCert, verifyCert,
  compressContext,
  startConversation, recordTurn, turnDiff,
  summarize, persistSummary, recallSummary,
  precogConstraints,
} from "./index.js";

function setupRepo(): string {
  return mkdtempSync(join(tmpdir(), "mneme-reactor-"));
}
function cleanup(r: string) { try { rmSync(r, { recursive: true, force: true }); } catch { /* */ } }

// ─── Measurement primitives ──────────────────────────────────────────

describe("v1.62 Reactor · measurement", () => {
  it("estimateTokens uses char/4 heuristic", () => {
    expect(estimateTokens("abcd")).toBe(1);
    expect(estimateTokens("a".repeat(400))).toBe(100);
    expect(estimateTokens("")).toBe(0);
    expect(estimateTokens(null)).toBe(0);
  });

  it("metricsOf floors savings at 0", () => {
    const m = metricsOf(500, 100, "test"); // spent > baseline
    expect(m.tokensSaved).toBe(0);
    expect(m.savingsRatio).toBe(0);
  });

  it("metricsOf computes ratio correctly", () => {
    const m = metricsOf(200, 1000, "test");
    expect(m.tokensSaved).toBe(800);
    expect(m.savingsRatio).toBeCloseTo(0.8, 4);
  });
});

// ─── Layer 1: Cache ──────────────────────────────────────────────────

describe("v1.62 Layer 1 · Pre-computed answer cache", () => {
  let r: string;
  beforeEach(() => { r = setupRepo(); });
  afterEach(() => cleanup(r));

  it("miss returns hit=false", () => {
    const res = lookupAnswer(r, "what does foo do");
    expect(res.hit).toBe(false);
  });

  it("exact match hits + saves >= 80% of baseline", () => {
    storeAnswer(r, "what does the harmonic mean function do", "It returns the harmonic mean over a numeric array.");
    const res = lookupAnswer(r, "what does the harmonic mean function do");
    expect(res.hit).toBe(true);
    expect(res.matchType).toBe("exact");
    expect(res.metrics.savingsRatio).toBeGreaterThan(0.8);
  });

  it("semantic match (Jaccard >= 0.8) hits", () => {
    storeAnswer(r, "what does the harmonic mean function compute", "It returns the harmonic mean.");
    const res = lookupAnswer(r, "what does the harmonic mean function do");
    expect(res.hit).toBe(true);
    if (res.hit) {
      expect(res.matchType).toBeDefined();
      expect(res.metrics.savingsRatio).toBeGreaterThan(0.8);
    }
  });

  it("cacheStats reports active entries", () => {
    storeAnswer(r, "q1", "a1");
    storeAnswer(r, "q2", "a2");
    const s = cacheStats(r);
    expect(s.totalEntries).toBe(2);
    expect(s.activeEntries).toBe(2);
  });
});

// ─── Layer 2: Intent compiler ────────────────────────────────────────

describe("v1.62 Layer 2 · Intent compiler", () => {
  it("classifies tight prompts as tight", () => {
    const r = refineIntent("show me the runACGV function in file packages/core/src/squadron/acgv.ts:65");
    expect(r.vagueness).toBe("tight");
  });

  it("classifies 'explain how X works' as vague/very-vague + suggests alternatives", () => {
    const r = refineIntent("explain how auth works");
    expect(["vague", "very-vague"]).toContain(r.vagueness);
    expect(r.alternatives.length).toBeGreaterThan(0);
  });

  it("vague prompts yield >= 80% reduction via alternative routing", () => {
    const r = refineIntent("explain how auth works");
    expect(r.metrics.savingsRatio).toBeGreaterThan(0.8);
  });

  it("'who owns this code' routes to mneme.passport", () => {
    const r = refineIntent("who owns the auth code right now");
    const passportAlt = r.alternatives.find((a) => a.suggestedTool === "mneme.passport");
    expect(passportAlt).toBeDefined();
  });
});

// ─── Layer 3: Compiled intent / recipes ──────────────────────────────

describe("v1.62 Layer 3 · Compiled intent recipes", () => {
  it("matches structured-logger recipe", () => {
    const r = tryRecipe("add a structured logger to auth middleware");
    expect(r.matched).toBe(true);
    expect(r.recipeId).toBe("structured-logger");
    expect(r.metrics.savingsRatio).toBeGreaterThan(0.7);
  });

  it("matches vitest skeleton recipe", () => {
    const r = tryRecipe("write unit tests for harmonic mean function");
    expect(r.matched).toBe(true);
    expect(r.recipeId).toBe("vitest-skeleton");
  });

  it("no match returns matched=false + 0 savings", () => {
    const r = tryRecipe("philosophical question about life");
    expect(r.matched).toBe(false);
    expect(r.metrics.savingsRatio).toBe(0);
  });
});

// ─── Layer 4: Shard cache ────────────────────────────────────────────

describe("v1.62 Layer 4 · Shard cache", () => {
  let r: string;
  beforeEach(() => { r = setupRepo(); });
  afterEach(() => cleanup(r));

  it("first stamp records the shard", () => {
    const s = stampShard(r, "some large prompt content " + "x".repeat(500));
    expect(s.id).toMatch(/^[0-9a-f]{16}$/);
    expect(s.reuseCount).toBe(0);
  });

  it("re-stamping increments reuseCount", () => {
    const content = "shard content " + "y".repeat(500);
    stampShard(r, content);
    const s2 = stampShard(r, content);
    expect(s2.reuseCount).toBe(1);
  });

  it("shardEnvelope on reused content yields >= 90% savings", () => {
    const content = "background context " + "z".repeat(2000);
    shardEnvelope(r, content); // first emit
    const e2 = shardEnvelope(r, content); // reuse
    expect(e2.metrics.savingsRatio).toBeGreaterThan(0.9);
  });
});

// ─── Layer 5: Semantic diff / file slicing ───────────────────────────

describe("v1.62 Layer 5 · Semantic diff", () => {
  let r: string;
  beforeEach(() => {
    r = setupRepo();
    mkdirSync(join(r, "src"), { recursive: true });
    const body = [
      "/**",
      " * Module that computes harmonic mean.",
      " */",
      "export const X = 1;",
      "",
      ...Array.from({ length: 200 }, (_, i) => `// padding line ${i}`),
      "",
      "export function harmonicMean(xs: number[]): number {",
      "  if (xs.some((x) => x <= 0)) return 0;",
      "  return xs.length / xs.reduce((a, b) => a + 1 / b, 0);",
      "}",
      "",
      ...Array.from({ length: 200 }, (_, i) => `// trailing line ${i}`),
    ].join("\n");
    writeFileSync(join(r, "src", "harmonic.ts"), body);
  });
  afterEach(() => cleanup(r));

  it("targeted slice on 'harmonicMean' returns >= 80% reduction", () => {
    const s = sliceFile(r, "src/harmonic.ts", "what does harmonicMean do");
    expect(s.ok).toBe(true);
    expect(s.metrics.savingsRatio).toBeGreaterThan(0.8);
    expect(s.slice).toContain("harmonicMean");
  });

  it("slice includes file purpose comment", () => {
    const s = sliceFile(r, "src/harmonic.ts", "harmonicMean");
    expect(s.filePurpose).toContain("harmonic");
  });

  it("non-existent file returns ok=false", () => {
    const s = sliceFile(r, "src/missing.ts", "anything");
    expect(s.ok).toBe(false);
  });
});

// ─── Layer 6: Atomic tool fusion ─────────────────────────────────────

describe("v1.62 Layer 6 · Atomic tool fusion", () => {
  it("recognizes spawn+verify fusion", () => {
    const r = fuseToolCalls([
      { name: "mneme.bot.spawn", args: { claim: "x" } },
      { name: "mneme.truth.check", args: { claim: "x" } },
    ]);
    expect(r.fusable).toBe(true);
    expect(r.fusedName).toContain("atomic");
    expect(r.metrics.savingsRatio).toBeGreaterThanOrEqual(0.5);
  });

  it("recognizes triple-tool audit fusion", () => {
    const r = fuseToolCalls([
      { name: "mneme.bot.spawn", args: {} },
      { name: "mneme.truth.check", args: {} },
      { name: "mneme.oracle.forecast", args: {} },
    ]);
    expect(r.fusable).toBe(true);
    expect(r.metrics.savingsRatio).toBeGreaterThan(0.6);
  });

  it("rejects single-tool 'sequence'", () => {
    const r = fuseToolCalls([{ name: "mneme.bot.spawn", args: {} }]);
    expect(r.fusable).toBe(false);
  });
});

// ─── Layer 7: Streaming truncation ───────────────────────────────────

describe("v1.62 Layer 7 · Streaming truncation", () => {
  it("closed code-block signals stop", () => {
    const c = shouldTruncate("```ts\nfunction x() {}\n```", 200);
    expect(c.confidence).toBeGreaterThan(0.3);
  });

  it("partial mid-stream does NOT signal stop", () => {
    const c = shouldTruncate("the answer is partly written", 200);
    expect(c.shouldStop).toBe(false);
  });

  it("budget exhaustion forces stop", () => {
    const big = "x".repeat(2000);
    const c = shouldTruncate(big, 50, { maxTokens: 100 });
    expect(c.shouldStop).toBe(true);
  });
});

// ─── Layer 8: Certificate ────────────────────────────────────────────

describe("v1.62 Layer 8 · Certificate token", () => {
  let r: string;
  beforeEach(() => { r = setupRepo(); });
  afterEach(() => cleanup(r));

  it("issued cert verifies on the same machine", () => {
    const c = issueCert(r, "claim X", "FUSION", 0.95);
    const v = verifyCert(r, c);
    expect(v.valid).toBe(true);
  });

  it("tampered cert fails verify", () => {
    const c = issueCert(r, "claim", "FUSION", 0.95);
    const tampered = { ...c, verdict: "BLACK_HOLE" };
    expect(verifyCert(r, tampered).valid).toBe(false);
  });

  it("expired cert fails verify", () => {
    const c = issueCert(r, "claim", "FUSION", 0.95, { ttlHours: 0 });
    // Backdate the expiresAt to definitely-expired
    const expired = { ...c, expiresAt: new Date(Date.now() - 1000).toISOString() };
    const v = verifyCert(r, expired);
    expect(v.valid).toBe(false);
  });

  it("valid cert reuse saves >= 80% vs re-verification", () => {
    const c = issueCert(r, "claim", "FUSION", 0.95);
    const v = verifyCert(r, c);
    expect(v.metrics.savingsRatio).toBeGreaterThan(0.8);
  });
});

// ─── Layer 9: Context compression ────────────────────────────────────

describe("v1.62 Layer 9 · Embeddings-as-context compression", () => {
  it("compresses background prose by >= 80%", () => {
    const chunks = [
      "Long background paragraph about ".repeat(50),
      "Another verbose context section here ".repeat(50),
    ];
    const c = compressContext(chunks);
    expect(c.metrics.savingsRatio).toBeGreaterThan(0.8);
  });

  it("handles empty input", () => {
    const c = compressContext([]);
    expect(c.spentTokens).toBeGreaterThanOrEqual(0);
  });
});

// ─── Layer 10: Turn-diff conversation memory ─────────────────────────

describe("v1.62 Layer 10 · Turn-diff protocol", () => {
  let r: string;
  beforeEach(() => { r = setupRepo(); });
  afterEach(() => cleanup(r));

  it("startConversation + recordTurn + turnDiff", () => {
    const c = startConversation(r);
    for (let i = 0; i < 10; i++) {
      recordTurn(r, c.id, `user msg ${i}`.repeat(20), `ai resp ${i}`.repeat(20));
    }
    const d = turnDiff(r, c.id, "new user message");
    expect(d.fullHistoryTokens).toBeGreaterThan(d.diffTokens);
    expect(d.metrics.savingsRatio).toBeGreaterThan(0.8);
  });

  it("unknown conversation returns degraded diff", () => {
    const d = turnDiff(r, "no-such-id", "hello");
    expect(d.diff).toContain("hello");
  });
});

// ─── Layer 11: Summary debt ──────────────────────────────────────────

describe("v1.62 Layer 11 · Summary debt", () => {
  let r: string;
  beforeEach(() => { r = setupRepo(); });
  afterEach(() => cleanup(r));

  it("summarize compresses >= 80%", () => {
    const content = "This is a long passage. ".repeat(200);
    const { summary, metrics } = summarize(content);
    expect(metrics.savingsRatio).toBeGreaterThan(0.8);
    expect(summary.summary.length).toBeLessThan(content.length);
  });

  it("persist + recall round trip", () => {
    const { summary } = summarize("Long content " + "x".repeat(500));
    persistSummary(r, summary);
    const got = recallSummary(r, summary.id);
    expect(got).not.toBeNull();
    expect(got!.id).toBe(summary.id);
  });
});

// ─── Layer 12: Precog regret ─────────────────────────────────────────

describe("v1.62 Layer 12 · Precog regret", () => {
  it("identifies React-component prompts as high-risk", () => {
    const r = precogConstraints("generate a typescript React component for user profile");
    expect(r.riskScore).toBeGreaterThan(0.3);
    expect(r.injectedConstraints.length).toBeGreaterThan(0);
  });

  it("regex prompts get constraint hint", () => {
    const r = precogConstraints("write a regex for email validation");
    expect(r.injectedConstraints.length).toBeGreaterThan(0);
  });

  it("benign prompt has zero risk + no constraints", () => {
    const r = precogConstraints("say hello");
    expect(r.riskScore).toBe(0);
    expect(r.injectedConstraints.length).toBe(0);
  });
});

// ─── Ledger rollup ───────────────────────────────────────────────────

describe("v1.62 Reactor · ledger rollup", () => {
  let r: string;
  beforeEach(() => { r = setupRepo(); });
  afterEach(() => cleanup(r));

  it("ledger captures multiple layers + computes overall savings", () => {
    // Run a few layers that hit savings.
    storeAnswer(r, "test question", "test answer");
    lookupAnswer(r, "test question"); // exact hit, records savings
    const content = "background " + "x".repeat(1000);
    shardEnvelope(r, content); // first emit
    shardEnvelope(r, content); // reuse, records savings
    const s = totalSavings(r);
    expect(s.totalCalls).toBeGreaterThanOrEqual(2);
    expect(s.totalSaved).toBeGreaterThan(0);
    expect(s.overallRatio).toBeGreaterThan(0);
    expect(Object.keys(s.byMethod).length).toBeGreaterThan(0);
  });

  it("empty ledger returns zeros", () => {
    const s = totalSavings(r);
    expect(s.totalCalls).toBe(0);
    expect(s.totalSaved).toBe(0);
  });
});

// ─── COMBINED SUPER-NOVA ATOM ────────────────────────────────────────
//
// The "molecular fusion" test: run a realistic user workflow through
// every layer + assert combined savings >= 80% vs naive baseline.

describe("v1.62 Reactor · SUPER-NOVA ATOM combined workflow", () => {
  let r: string;
  beforeEach(() => {
    r = setupRepo();
    mkdirSync(join(r, "src"), { recursive: true });
    // Build a realistic-shaped file with newlines + a targeted auth function buried inside.
    const filler = Array.from({ length: 400 }, (_, i) => `// padding line ${i} -- lorem ipsum dolor sit amet`).join("\n");
    const body = [
      "/** auth middleware -- validates JWTs and attaches user to req */",
      "import { jwt } from './jwt';",
      filler,
      "",
      "export function authMiddleware(req, res, next) {",
      "  const token = req.headers.authorization?.split(' ')[1];",
      "  if (!token) return res.status(401).end();",
      "  req.user = jwt.verify(token);",
      "  next();",
      "}",
      "",
      filler,
    ].join("\n");
    writeFileSync(join(r, "src", "x.ts"), body);
  });
  afterEach(() => cleanup(r));

  it("full workflow: intent + slice + recipe + cache + ledger >= 80% savings", () => {
    const userPrompt = "explain how auth middleware works";
    // Layer 2: refine
    const intent = refineIntent(userPrompt);
    expect(intent.metrics.savingsRatio).toBeGreaterThan(0.5);
    // Layer 5: slice the auth file instead of full read
    const slice = sliceFile(r, "src/x.ts", "auth middleware");
    expect(slice.metrics.savingsRatio).toBeGreaterThan(0.5);
    // Layer 3: try a recipe (no match expected here, but check shape)
    const recipe = tryRecipe(userPrompt);
    // Layer 1: store + retrieve
    storeAnswer(r, userPrompt, "Auth middleware validates JWTs and attaches user to req.");
    const cached = lookupAnswer(r, userPrompt);
    expect(cached.hit).toBe(true);

    // Combined savings tally.
    const allRatios = [intent.metrics.savingsRatio, slice.metrics.savingsRatio, cached.metrics.savingsRatio];
    const avg = allRatios.reduce((a, b) => a + b, 0) / allRatios.length;
    expect(avg).toBeGreaterThan(0.8);

    // Ledger rollup.
    const s = totalSavings(r);
    expect(s.overallRatio).toBeGreaterThan(0.8);
  });
});
