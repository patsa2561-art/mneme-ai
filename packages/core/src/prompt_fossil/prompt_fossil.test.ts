import { describe, it, expect } from "vitest";
import {
  mintFossil,
  lookupFossil,
  renderDiffPrompt,
  verifyChain,
  emptyStore,
  fossilStats,
} from "./index.js";

const SECRET = "fossil-test-secret-99";

function vec(seed: number, len = 8): number[] {
  // Deterministic pseudo-random embedding for tests.
  const out: number[] = [];
  let s = seed;
  for (let i = 0; i < len; i++) {
    s = (s * 9301 + 49297) % 233280;
    out.push((s / 233280) - 0.5);
  }
  return out;
}

describe("v2.19.40 PROMPT FOSSIL · mint + reuse path", () => {
  it("REUSE when similarity >= 0.95 and fresh", () => {
    const store = emptyStore(SECRET);
    const emb = vec(1, 16);
    mintFossil(store, {
      promptSkeleton: "list mneme MCP tools",
      embedding: emb,
      answer: "699 tools",
      vendor: "haiku",
      model: "claude-haiku-4-5",
      costTokens: 200,
      nowMs: Date.now(),
    });
    const r = lookupFossil(store, emb, "list mneme MCP tools", { nowMs: Date.now() });
    expect(r.action).toBe("reuse");
    expect(r.estTokensSaved).toBe(200);
  });

  it("DIFF when similarity in [0.85, 0.95)", () => {
    const store = emptyStore(SECRET);
    const emb = vec(2, 16);
    mintFossil(store, {
      promptSkeleton: "explain reflex cache",
      embedding: emb,
      answer: "REFLEX uses 5-min TTL",
      vendor: "opus", model: "claude-opus-4-7", costTokens: 500,
    });
    const similar = emb.map((v, i) => v + (i === 0 ? 0.15 : 0));
    const r = lookupFossil(store, similar, "explain reflex cache details");
    expect(["diff", "reuse"]).toContain(r.action);
    if (r.action === "diff") {
      expect(r.diffPrompt).toBeDefined();
      expect(r.diffPrompt!.toLowerCase()).toContain("diff");
    }
  });

  it("MISS when below diff threshold", () => {
    const store = emptyStore(SECRET);
    mintFossil(store, {
      promptSkeleton: "explain reflex cache",
      embedding: vec(10, 16),
      answer: "...",
      vendor: "opus", model: "opus", costTokens: 500,
    });
    const r = lookupFossil(store, vec(99, 16), "something completely unrelated");
    expect(r.action).toBe("miss");
    expect(r.estTokensSaved).toBe(0);
  });

  it("REUSE fails (downgrades) when fossil is older than maxFreshAgeMs", () => {
    const store = emptyStore(SECRET);
    const emb = vec(3, 16);
    const old = Date.now() - 30 * 24 * 60 * 60 * 1000; // 30 days
    mintFossil(store, {
      promptSkeleton: "stale prompt", embedding: emb, answer: "stale answer",
      vendor: "haiku", model: "h", costTokens: 100, nowMs: old,
    });
    const r = lookupFossil(store, emb, "stale prompt", {
      maxFreshAgeMs: 7 * 24 * 60 * 60 * 1000, nowMs: Date.now(),
    });
    expect(r.action).toBe("diff");
  });

  it("REUSE fails (downgrades) when cited file volatility above threshold", () => {
    const store = emptyStore(SECRET);
    const emb = vec(4, 16);
    mintFossil(store, {
      promptSkeleton: "explain X", embedding: emb, answer: "...",
      filesTouched: ["packages/core/src/foo.ts"],
      vendor: "haiku", model: "h", costTokens: 100,
    });
    const r = lookupFossil(store, emb, "explain X", {
      fileVolatility: { "packages/core/src/foo.ts": 5 },
      volatilityDecayThreshold: 3,
    });
    expect(r.action).toBe("diff");
  });

  it("empty store returns MISS gracefully", () => {
    const store = emptyStore(SECRET);
    const r = lookupFossil(store, vec(7, 16), "anything");
    expect(r.action).toBe("miss");
  });
});

describe("v2.19.40 PROMPT FOSSIL · diff prompt rendering", () => {
  it("diff prompt contains both the old answer and the new request", () => {
    const fossil = {
      id: "abc", mintedAtMs: 0,
      promptSkeleton: "old prompt", embedding: [], answer: "old answer",
      filesTouched: [], vendor: "v", model: "m", costTokens: 0, successScore: 1,
      prevSig: "", sig: "",
    };
    const out = renderDiffPrompt("new prompt", fossil);
    expect(out).toContain("old prompt");
    expect(out).toContain("old answer");
    expect(out).toContain("new prompt");
    expect(out.toLowerCase()).toContain("delta");
  });
});

describe("v2.19.40 PROMPT FOSSIL · chain integrity (HMAC)", () => {
  it("chain verifies after multiple mints", () => {
    const store = emptyStore(SECRET);
    for (let i = 0; i < 10; i++) {
      mintFossil(store, {
        promptSkeleton: `p${i}`, embedding: vec(i, 8), answer: `a${i}`,
        vendor: "h", model: "m", costTokens: 10 * i,
      });
    }
    const v = verifyChain(store);
    expect(v.ok).toBe(true);
  });

  it("tampered fossil breaks the chain", () => {
    const store = emptyStore(SECRET);
    mintFossil(store, { promptSkeleton: "p", embedding: vec(1, 8), answer: "a", vendor: "h", model: "m", costTokens: 10 });
    mintFossil(store, { promptSkeleton: "q", embedding: vec(2, 8), answer: "b", vendor: "h", model: "m", costTokens: 20 });
    // Tamper with the first fossil's answer.
    store.fossils[0]!.answer = "tampered";
    const v = verifyChain(store);
    expect(v.ok).toBe(false);
  });
});

describe("v2.19.40 PROMPT FOSSIL · stats", () => {
  it("rolls up count + tokens + vendor breakdown", () => {
    const store = emptyStore(SECRET);
    mintFossil(store, { promptSkeleton: "p", embedding: vec(1, 8), answer: "a", vendor: "haiku", model: "h", costTokens: 100 });
    mintFossil(store, { promptSkeleton: "q", embedding: vec(2, 8), answer: "b", vendor: "opus", model: "o", costTokens: 200 });
    mintFossil(store, { promptSkeleton: "r", embedding: vec(3, 8), answer: "c", vendor: "haiku", model: "h", costTokens: 100 });
    const s = fossilStats(store);
    expect(s.count).toBe(3);
    expect(s.totalCostTokens).toBe(400);
    expect(s.vendorBreakdown["haiku"]).toBe(2);
    expect(s.vendorBreakdown["opus"]).toBe(1);
  });
});

describe("v2.19.40 PROMPT FOSSIL · 1000-iter fuzz", () => {
  it("mint + lookup + verify never throws", () => {
    const store = emptyStore(SECRET);
    for (let i = 0; i < 1000; i++) {
      const emb = vec(i, 12);
      expect(() => mintFossil(store, {
        promptSkeleton: `p${i}`, embedding: emb, answer: `a${i}`,
        vendor: "v", model: "m", costTokens: Math.floor(Math.random() * 1000),
        nowMs: Date.now() - i * 1000,
      })).not.toThrow();
      expect(() => lookupFossil(store, emb, `p${i}`)).not.toThrow();
    }
    expect(verifyChain(store).ok).toBe(true);
  });
});
