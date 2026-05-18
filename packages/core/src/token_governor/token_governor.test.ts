import { describe, it, expect } from "vitest";
import {
  governCall,
  aggregateSavings,
  verifyDecision,
  type AICallRequest,
  type GovernorContext,
  type GovernorDecision,
} from "./index.js";

const baseReq: AICallRequest = {
  kind: "ask",
  prompt: "does packages/core/src/index.ts exist?",
  estDirectTokens: 200,
};

describe("v2.19.40 TOKEN GOVERNOR · Stage 1 cache cascade", () => {
  it("REFLEX hit returns Stage 1 cache_hit at zero tokens", async () => {
    const ctx: GovernorContext = {
      reflexLookup: async () => ({ answer: "yes (cached)", ageMs: 30_000 }),
    };
    const d = await governCall(baseReq, ctx);
    expect(d.stage).toBe(1);
    expect(d.action).toBe("cache_hit");
    expect(d.tokensUsedActual).toBe(0);
    expect(d.estTokensSavedVsDirect).toBe(200);
    expect(d.trail[0]!.sub).toBe("reflex");
    expect(d.trail[0]!.outcome).toBe("hit");
  });

  it("SOUL EMBALMING hit fires after REFLEX miss", async () => {
    const ctx: GovernorContext = {
      reflexLookup: async () => null,
      soulRestore: async () => ({ context: "restored conversation tail" }),
    };
    const d = await governCall(baseReq, ctx);
    expect(d.stage).toBe(1);
    expect(d.action).toBe("cache_hit");
    expect(d.trail.find((t) => t.sub === "reflex")?.outcome).toBe("miss");
    expect(d.trail.find((t) => t.sub === "soul")?.outcome).toBe("hit");
  });

  it("AGREEMENT-WASM hit fires after REFLEX + SOUL miss", async () => {
    const ctx: GovernorContext = {
      reflexLookup: async () => null,
      soulRestore: async () => null,
      agreementCall: async () => ({ result: "rule says: deny" }),
    };
    const d = await governCall(baseReq, ctx);
    expect(d.stage).toBe(1);
    expect(d.answer).toContain("deny");
  });

  it("REPLICA non-LLM oracle hit fires after first three misses", async () => {
    const ctx: GovernorContext = {
      reflexLookup: async () => null,
      soulRestore: async () => null,
      agreementCall: async () => null,
      replicaConsult: async () => ({ answer: "oracle: 42" }),
    };
    const d = await governCall(baseReq, ctx);
    expect(d.stage).toBe(1);
    expect(d.answer).toContain("42");
  });

  it("PROMPT FOSSIL similarity hit fires when nothing else cached", async () => {
    const ctx: GovernorContext = {
      reflexLookup: async () => null,
      soulRestore: async () => null,
      agreementCall: async () => null,
      replicaConsult: async () => null,
      fossilLookup: async () => ({ answer: "fossil answer", similarity: 0.92 }),
    };
    const d = await governCall(baseReq, ctx);
    expect(d.stage).toBe(1);
    expect(d.trail.find((t) => t.sub === "fossil")?.outcome).toBe("hit");
  });

  it("errors in cache probes are tolerated and trail records them", async () => {
    const ctx: GovernorContext = {
      reflexLookup: async () => { throw new Error("boom"); },
      soulRestore: async () => ({ context: "still works" }),
    };
    const d = await governCall(baseReq, ctx);
    expect(d.stage).toBe(1);
    expect(d.trail.find((t) => t.sub === "reflex")?.outcome).toBe("error");
    expect(d.trail.find((t) => t.sub === "soul")?.outcome).toBe("hit");
  });
});

describe("v2.19.40 TOKEN GOVERNOR · Stage 2 local answer", () => {
  it("local answer above confidence floor wins Stage 2", async () => {
    const ctx: GovernorContext = {
      localAnswer: async () => ({ answer: "file exists", confidence: 0.95 }),
    };
    const d = await governCall(baseReq, ctx);
    expect(d.stage).toBe(2);
    expect(d.action).toBe("local_answer");
    expect(d.estTokensSavedVsDirect).toBe(200);
  });

  it("local answer below confidence floor falls through", async () => {
    const ctx: GovernorContext = {
      localAnswer: async () => ({ answer: "maybe", confidence: 0.3 }),
      cheapVendorCall: async () => null,
      expensiveVendorCall: async () => ({ answer: "ok", tokensUsed: 100 }),
    };
    const d = await governCall(baseReq, ctx);
    expect(d.stage).toBe(4);
  });
});

describe("v2.19.40 TOKEN GOVERNOR · Stage 3 cheap vendor (ARBITRAGE)", () => {
  it("ARBITRAGE confident pick → cheap vendor handles request", async () => {
    const ctx: GovernorContext = {
      arbitrageChoose: async () => ({ vendor: "haiku", estTokens: 50, predictedConfidence: 0.85 }),
      cheapVendorCall: async () => ({ answer: "haiku reply", tokensUsed: 50, confidence: 0.85 }),
    };
    const d = await governCall(baseReq, ctx);
    expect(d.stage).toBe(3);
    expect(d.vendor).toBe("haiku");
    expect(d.tokensUsedActual).toBe(50);
    expect(d.estTokensSavedVsDirect).toBe(150);
  });

  it("cheap vendor low confidence forces escalate to Stage 4", async () => {
    const ctx: GovernorContext = {
      arbitrageChoose: async () => ({ vendor: "haiku", estTokens: 50, predictedConfidence: 0.85 }),
      cheapVendorCall: async () => ({ answer: "iffy", tokensUsed: 40, confidence: 0.4 }),
      expensiveVendorCall: async () => ({ answer: "opus reply", tokensUsed: 800 }),
    };
    const d = await governCall(baseReq, ctx);
    expect(d.stage).toBe(4);
    expect(d.tokensUsedActual).toBe(800);
  });
});

describe("v2.19.40 TOKEN GOVERNOR · Stage 4 expensive vendor + audit", () => {
  it("expensive vendor with trustworthy audit emits clean decision", async () => {
    const ctx: GovernorContext = {
      expensiveVendorCall: async () => ({ answer: "opus answer", tokensUsed: 600 }),
      auditResponse: async () => ({ verdict: "trustworthy" }),
    };
    const d = await governCall(baseReq, ctx);
    expect(d.stage).toBe(4);
    expect(d.predictedConfidence).toBeGreaterThanOrEqual(0.9);
    expect(d.trail.some((t) => t.sub === "audit:trustworthy")).toBe(true);
  });

  it("refuted audit triggers Stage 5 NEGEV token-tax", async () => {
    const charges: Array<{ vendor: string; claim: string }> = [];
    const ctx: GovernorContext = {
      expensiveVendorCall: async () => ({ answer: "false reply", tokensUsed: 600 }),
      auditResponse: async () => ({ verdict: "refuted" }),
      negevCharge: async (vendor, claim) => { charges.push({ vendor, claim }); },
    };
    const d = await governCall({ ...baseReq, vendorPreferred: "opus" }, ctx);
    expect(d.stage).toBe(4);
    expect(charges.length).toBe(1);
    expect(charges[0]!.vendor).toBe("opus");
    expect(d.trail.some((t) => t.stage === 5 && t.sub === "negev_charge")).toBe(true);
  });
});

describe("v2.19.40 TOKEN GOVERNOR · GANGLION stage hint integration", () => {
  it("GANGLION hint reorders stages so the preferred stage tries first", async () => {
    const callOrder: string[] = [];
    const ctx: GovernorContext = {
      // Stage 1 callbacks all miss.
      reflexLookup: async () => { callOrder.push("reflex"); return null; },
      soulRestore: async () => { callOrder.push("soul"); return null; },
      agreementCall: async () => { callOrder.push("agreement"); return null; },
      replicaConsult: async () => { callOrder.push("replica"); return null; },
      // Stage 3 would win (arbitrage handles it).
      arbitrageChoose: async () => { callOrder.push("arbitrage"); return { vendor: "haiku", estTokens: 50, predictedConfidence: 0.85 }; },
      cheapVendorCall: async () => ({ answer: "haiku", tokensUsed: 50, confidence: 0.85 }),
      // Ganglion suggests Stage 3 directly.
      ganglionHint: async () => ({ preferredStage: 3, confidence: 0.9 }),
    };
    const d = await governCall(baseReq, ctx);
    expect(d.stage).toBe(3);
    // Stage 3's arbitrage should have run; with Stage 3 winning first, the
    // Stage 1 cache cascade should never have been touched.
    expect(callOrder).toContain("arbitrage");
    expect(callOrder).not.toContain("reflex");
  });

  it("low-confidence GANGLION hint is ignored", async () => {
    const ctx: GovernorContext = {
      reflexLookup: async () => ({ answer: "cached", ageMs: 1000 }),
      ganglionHint: async () => ({ preferredStage: 3, confidence: 0.3 }),
    };
    const d = await governCall(baseReq, ctx);
    expect(d.stage).toBe(1);
  });
});

describe("v2.19.40 TOKEN GOVERNOR · fallback + signature integrity", () => {
  it("no handler available returns explicit no-op decision", async () => {
    const d = await governCall(baseReq, {});
    expect(d.answer).toBe("");
    expect(d.explanation).toContain("cascade exhausted");
  });

  it("decisions are HMAC-signed and verify-able", async () => {
    const ctx: GovernorContext = {
      reflexLookup: async () => ({ answer: "yes", ageMs: 1000 }),
    };
    const d = await governCall(baseReq, ctx);
    const v = verifyDecision(d);
    expect(v.ok).toBe(true);
  });

  it("tampered decision fails verification", async () => {
    const ctx: GovernorContext = {
      reflexLookup: async () => ({ answer: "yes", ageMs: 1000 }),
    };
    const d = await governCall(baseReq, ctx);
    const tampered = { ...d, answer: "tampered" };
    const v = verifyDecision(tampered);
    expect(v.ok).toBe(false);
  });
});

describe("v2.19.40 TOKEN GOVERNOR · aggregateSavings", () => {
  it("rolls up totals by stage with cache + local hit rates", async () => {
    const ctx: GovernorContext = {
      reflexLookup: async () => ({ answer: "x", ageMs: 0 }),
    };
    const decisions: GovernorDecision[] = [];
    for (let i = 0; i < 5; i++) decisions.push(await governCall(baseReq, ctx));
    const agg = aggregateSavings(decisions);
    expect(agg.totalCallsGoverned).toBe(5);
    expect(agg.totalTokensSaved).toBe(5 * 200);
    expect(agg.cacheHitRate).toBe(1);
    expect(agg.byStage[1].calls).toBe(5);
  });
});

describe("v2.19.40 TOKEN GOVERNOR · 1000-iter fuzz", () => {
  it("never throws across 1000 randomised contexts", async () => {
    for (let i = 0; i < 1000; i++) {
      const ctx: GovernorContext = {
        reflexLookup: async () => Math.random() > 0.7 ? { answer: "x", ageMs: 0 } : null,
        soulRestore: async () => Math.random() > 0.8 ? { context: "x" } : null,
        localAnswer: async () => Math.random() > 0.7 ? { answer: "y", confidence: Math.random() } : null,
        arbitrageChoose: async () => Math.random() > 0.5 ? { vendor: "v", estTokens: 50, predictedConfidence: Math.random() } : null,
        cheapVendorCall: async () => Math.random() > 0.5 ? { answer: "z", tokensUsed: 50, confidence: Math.random() } : null,
        expensiveVendorCall: async () => ({ answer: "exp", tokensUsed: 500 }),
        auditResponse: async () => ({ verdict: ["trustworthy", "mixed", "refuted", "unknown"][Math.floor(Math.random() * 4)] as "trustworthy" | "mixed" | "refuted" | "unknown" }),
      };
      await expect(governCall({ ...baseReq, prompt: `q${i}` }, ctx)).resolves.toBeTruthy();
    }
  });
});
