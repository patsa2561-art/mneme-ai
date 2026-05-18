/**
 * v2.19.40 — MNEME TOKEN GOVERNOR (the wiring layer for the 13 primitives).
 *
 * Mneme already ships 13 primitives that each reduce AI token spend. The
 * problem the user surfaced (2026-05-18) is that nothing wired them into a
 * single auto-operation layer — every AI agent still had to know which
 * primitive to call and when. The Token Governor is the meta-orchestrator
 * that sits behind the MCP boundary and runs a deterministic 5-stage
 * cascade per AI call:
 *
 *   STAGE 1 — CACHE HIT?
 *     REFLEX (5-min TTL) → SOUL EMBALMING (ban-resilience) →
 *     AGREEMENT-WASM (rule callable) → REPLICA (non-LLM oracle).
 *     HIT → return 0-token instant answer.
 *
 *   STAGE 2 — LOCAL ANSWERABLE?
 *     file_existence / version / mcp tool count / grep / semantic search via
 *     SNN embedder. Hit → 0 cloud tokens.
 *
 *   STAGE 3 — CHEAP VENDOR ENOUGH?
 *     ARBITRAGE routes to Haiku / Gemini-Flash / local Ollama. If predicted
 *     confidence < 0.7, escalate.
 *
 *   STAGE 4 — EXPENSIVE VENDOR (last resort).
 *     COMPRESS context first (CHIMERA + HTC) → INVERSE-LLM audit output →
 *     TRUTH FORENSIC verify → cache result for future.
 *
 *   STAGE 5 — VENDOR LIE TAX.
 *     If response refuted → NEGEV charges vendor. If vendor budget exceeded,
 *     route to next-cheapest on the next call.
 *
 * The module is INTENTIONALLY pure-function: every external dependency is
 * passed in as a callback in `GovernorContext`. This keeps the orchestrator
 * vendor-neutral, testable end-to-end, and composable with the existing
 * Mneme primitives without taking on their I/O burden. Callers supply the
 * cache lookup, the SNN embedder, the vendor router, etc; the Governor
 * sequences the 5 stages and returns a `GovernorDecision` the caller acts
 * on. Composes onto APOSTILLE (every decision can be receipt-minted), into
 * GANGLION (the synapse graph picks which stage to try first based on
 * Hebbian history), and beside PROMPT FOSSIL (Stage 1 cache layer adds a
 * fossil-similarity check before falling through).
 */

import { createHmac } from "node:crypto";

export type GovernorStage = 1 | 2 | 3 | 4 | 5;

export type GovernorAction =
  | "cache_hit"          // Stage 1
  | "local_answer"       // Stage 2
  | "cheap_vendor"       // Stage 3
  | "expensive_vendor"   // Stage 4
  | "lie_tax_recorded";  // Stage 5 (post-call)

export interface AICallRequest {
  /** What kind of operation the AI agent is asking for. */
  kind: "ask" | "verify" | "generate" | "refactor" | "explain";
  /** The natural-language prompt (or claim, for verify). */
  prompt: string;
  /** Files the call touches (used to compute volatility / fossil TTL). */
  filesTouched?: string[];
  /** Vendor the agent would have picked by default (may be overridden). */
  vendorPreferred?: string;
  /** Caller's confidence floor below which Stage 3 escalates to Stage 4. */
  minConfidence?: number;
  /** Estimated tokens the direct vendor call would have cost. */
  estDirectTokens?: number;
}

export interface GovernorContext {
  /** Stage 1.a — REFLEX cache lookup. Returns cached answer or null. */
  reflexLookup?: (req: AICallRequest) => Promise<{ answer: string; ageMs: number } | null>;
  /** Stage 1.b — SOUL EMBALMING context restore. Returns restored context. */
  soulRestore?: (req: AICallRequest) => Promise<{ context: string } | null>;
  /** Stage 1.c — AGREEMENT-WASM callable. Returns rule result if applicable. */
  agreementCall?: (req: AICallRequest) => Promise<{ result: string } | null>;
  /** Stage 1.d — REPLICA non-LLM oracle. Returns answer for ~100ms ops. */
  replicaConsult?: (req: AICallRequest) => Promise<{ answer: string } | null>;
  /** Stage 1.e — PROMPT FOSSIL similarity hit (>=0.85). */
  fossilLookup?: (req: AICallRequest) => Promise<{ answer: string; similarity: number } | null>;
  /** Stage 2 — local-answer attempt (file_exists, count, grep, SNN search). */
  localAnswer?: (req: AICallRequest) => Promise<{ answer: string; confidence: number } | null>;
  /** Stage 3 — cheap-vendor router (ARBITRAGE). Returns { vendor, predictedConfidence }. */
  arbitrageChoose?: (req: AICallRequest) => Promise<{ vendor: string; estTokens: number; predictedConfidence: number } | null>;
  /** Stage 3.exec — actually call the cheap vendor. */
  cheapVendorCall?: (req: AICallRequest, vendor: string) => Promise<{ answer: string; tokensUsed: number; confidence: number } | null>;
  /** Stage 4.exec — expensive vendor call (with compression + audit). */
  expensiveVendorCall?: (req: AICallRequest) => Promise<{ answer: string; tokensUsed: number } | null>;
  /** Stage 4 audit — INVERSE-LLM + TRUTH FORENSIC verdict on the response. */
  auditResponse?: (req: AICallRequest, answer: string) => Promise<{ verdict: "trustworthy" | "mixed" | "refuted" | "unknown" }>;
  /** Stage 5 — NEGEV token-tax charge on a vendor for a refuted response. */
  negevCharge?: (vendor: string, refutedClaim: string) => Promise<void>;
  /** GANGLION pre-stage hint (which stage has historically worked best). */
  ganglionHint?: (req: AICallRequest) => Promise<{ preferredStage: GovernorStage; confidence: number } | null>;
  /** Optional HMAC secret for the decision audit chain. */
  secret?: string;
}

export interface GovernorDecision {
  stage: GovernorStage;
  action: GovernorAction;
  answer: string;
  vendor: string | null;
  tokensUsedActual: number;
  estTokensSavedVsDirect: number;
  predictedConfidence: number | null;
  /** Audit trail of which sub-stages were tried + their outcome. */
  trail: Array<{ stage: GovernorStage; sub: string; outcome: "hit" | "miss" | "low_confidence" | "error" }>;
  /** HMAC-signed decision record (composes with APOSTILLE). */
  signature: string;
  /** Plain-English explanation safe for end-user dashboards. */
  explanation: string;
}

const PROTOCOL_VERSION = 1 as const;

function defaultSecret(): string {
  return process.env["MNEME_GOVERNOR_SECRET"] || `mneme-token-governor-v${PROTOCOL_VERSION}`;
}

function canon(v: unknown): string {
  if (v === null || typeof v !== "object") return JSON.stringify(v);
  if (Array.isArray(v)) return "[" + v.map(canon).join(",") + "]";
  const keys = Object.keys(v as Record<string, unknown>).sort();
  return "{" + keys.map((k) => JSON.stringify(k) + ":" + canon((v as Record<string, unknown>)[k])).join(",") + "}";
}

function signDecision(d: Omit<GovernorDecision, "signature" | "explanation">, secret: string): string {
  return createHmac("sha256", secret).update(canon(d)).digest("hex");
}

/**
 * Run the full 5-stage Governor cascade. Returns a deterministic decision
 * the caller can act on. Pure: only side effect is whatever the callbacks
 * themselves do; the Governor sequences them.
 */
export async function governCall(
  req: AICallRequest,
  ctx: GovernorContext,
): Promise<GovernorDecision> {
  const trail: GovernorDecision["trail"] = [];
  const minConf = req.minConfidence ?? 0.7;
  const direct = req.estDirectTokens ?? 0;
  const secret = ctx.secret ?? defaultSecret();

  // Optional GANGLION hint: try the historically best stage first.
  let stageOrder: GovernorStage[] = [1, 2, 3, 4];
  if (ctx.ganglionHint) {
    try {
      const hint = await ctx.ganglionHint(req);
      if (hint && hint.confidence >= 0.6) {
        stageOrder = [hint.preferredStage, ...stageOrder.filter((s) => s !== hint.preferredStage)];
      }
    } catch { /* hint is advisory; never fatal */ }
  }

  // STAGE 1 — CACHE HIT? (REFLEX → SOUL → AGREEMENT → REPLICA → FOSSIL)
  const tryStage1 = async (): Promise<GovernorDecision | null> => {
    const subProbes: Array<["reflex" | "soul" | "agreement" | "replica" | "fossil", () => Promise<{ answer: string; meta?: number } | null>]> = [
      ["reflex", async () => {
        if (!ctx.reflexLookup) return null;
        const r = await ctx.reflexLookup(req);
        return r ? { answer: r.answer, meta: r.ageMs } : null;
      }],
      ["soul", async () => {
        if (!ctx.soulRestore) return null;
        const r = await ctx.soulRestore(req);
        return r ? { answer: r.context } : null;
      }],
      ["agreement", async () => {
        if (!ctx.agreementCall) return null;
        const r = await ctx.agreementCall(req);
        return r ? { answer: r.result } : null;
      }],
      ["replica", async () => {
        if (!ctx.replicaConsult) return null;
        const r = await ctx.replicaConsult(req);
        return r ? { answer: r.answer } : null;
      }],
      ["fossil", async () => {
        if (!ctx.fossilLookup) return null;
        const r = await ctx.fossilLookup(req);
        return r ? { answer: r.answer, meta: r.similarity } : null;
      }],
    ];
    for (const [sub, probe] of subProbes) {
      try {
        const hit = await probe();
        if (hit) {
          trail.push({ stage: 1, sub, outcome: "hit" });
          const partial: Omit<GovernorDecision, "signature" | "explanation"> = {
            stage: 1, action: "cache_hit", answer: hit.answer, vendor: null,
            tokensUsedActual: 0, estTokensSavedVsDirect: direct,
            predictedConfidence: 0.95, trail,
          };
          return {
            ...partial,
            signature: signDecision(partial, secret),
            explanation: `Stage 1 cache hit via ${sub} — zero tokens spent (saved ~${direct} vs direct call).`,
          };
        }
        trail.push({ stage: 1, sub, outcome: "miss" });
      } catch {
        trail.push({ stage: 1, sub, outcome: "error" });
      }
    }
    return null;
  };

  // STAGE 2 — LOCAL ANSWERABLE?
  const tryStage2 = async (): Promise<GovernorDecision | null> => {
    if (!ctx.localAnswer) return null;
    try {
      const r = await ctx.localAnswer(req);
      if (r && r.confidence >= minConf) {
        trail.push({ stage: 2, sub: "local_answer", outcome: "hit" });
        const partial: Omit<GovernorDecision, "signature" | "explanation"> = {
          stage: 2, action: "local_answer", answer: r.answer, vendor: null,
          tokensUsedActual: 0, estTokensSavedVsDirect: direct,
          predictedConfidence: r.confidence, trail,
        };
        return {
          ...partial,
          signature: signDecision(partial, secret),
          explanation: `Stage 2 local answer (confidence ${(r.confidence * 100).toFixed(0)}%) — no cloud call (saved ~${direct} tokens).`,
        };
      }
      trail.push({ stage: 2, sub: "local_answer", outcome: r ? "low_confidence" : "miss" });
    } catch {
      trail.push({ stage: 2, sub: "local_answer", outcome: "error" });
    }
    return null;
  };

  // STAGE 3 — CHEAP VENDOR (ARBITRAGE)
  const tryStage3 = async (): Promise<GovernorDecision | null> => {
    if (!ctx.arbitrageChoose || !ctx.cheapVendorCall) return null;
    try {
      const choice = await ctx.arbitrageChoose(req);
      if (!choice || choice.predictedConfidence < minConf) {
        trail.push({ stage: 3, sub: "arbitrage", outcome: choice ? "low_confidence" : "miss" });
        return null;
      }
      trail.push({ stage: 3, sub: "arbitrage", outcome: "hit" });
      const exec = await ctx.cheapVendorCall(req, choice.vendor);
      if (!exec) {
        trail.push({ stage: 3, sub: "cheap_vendor_call", outcome: "miss" });
        return null;
      }
      trail.push({ stage: 3, sub: "cheap_vendor_call", outcome: exec.confidence >= minConf ? "hit" : "low_confidence" });
      if (exec.confidence < minConf) return null;
      const partial: Omit<GovernorDecision, "signature" | "explanation"> = {
        stage: 3, action: "cheap_vendor", answer: exec.answer, vendor: choice.vendor,
        tokensUsedActual: exec.tokensUsed,
        estTokensSavedVsDirect: Math.max(0, direct - exec.tokensUsed),
        predictedConfidence: exec.confidence, trail,
      };
      return {
        ...partial,
        signature: signDecision(partial, secret),
        explanation: `Stage 3 cheap vendor (${choice.vendor}) handled the call in ${exec.tokensUsed} tokens (saved ~${Math.max(0, direct - exec.tokensUsed)} vs direct).`,
      };
    } catch {
      trail.push({ stage: 3, sub: "arbitrage", outcome: "error" });
      return null;
    }
  };

  // STAGE 4 — EXPENSIVE VENDOR
  const tryStage4 = async (): Promise<GovernorDecision | null> => {
    if (!ctx.expensiveVendorCall) return null;
    try {
      const exec = await ctx.expensiveVendorCall(req);
      if (!exec) {
        trail.push({ stage: 4, sub: "expensive_vendor_call", outcome: "miss" });
        return null;
      }
      trail.push({ stage: 4, sub: "expensive_vendor_call", outcome: "hit" });
      let verdict: "trustworthy" | "mixed" | "refuted" | "unknown" = "unknown";
      if (ctx.auditResponse) {
        try {
          const audit = await ctx.auditResponse(req, exec.answer);
          verdict = audit.verdict;
          trail.push({ stage: 4, sub: `audit:${verdict}`, outcome: verdict === "refuted" ? "miss" : "hit" });
        } catch {
          trail.push({ stage: 4, sub: "audit", outcome: "error" });
        }
      }
      const partial: Omit<GovernorDecision, "signature" | "explanation"> = {
        stage: 4, action: "expensive_vendor", answer: exec.answer,
        vendor: req.vendorPreferred ?? "expensive_vendor",
        tokensUsedActual: exec.tokensUsed,
        estTokensSavedVsDirect: 0, // expensive path already costs tokens
        predictedConfidence: verdict === "trustworthy" ? 0.95 : verdict === "mixed" ? 0.6 : verdict === "refuted" ? 0.0 : 0.7,
        trail,
      };
      return {
        ...partial,
        signature: signDecision(partial, secret),
        explanation: `Stage 4 expensive vendor — ${exec.tokensUsed} tokens used. Audit verdict: ${verdict}.`,
      };
    } catch {
      trail.push({ stage: 4, sub: "expensive_vendor_call", outcome: "error" });
      return null;
    }
  };

  // Sequence through stageOrder (first hit wins).
  for (const s of stageOrder) {
    let decision: GovernorDecision | null = null;
    if (s === 1) decision = await tryStage1();
    else if (s === 2) decision = await tryStage2();
    else if (s === 3) decision = await tryStage3();
    else if (s === 4) decision = await tryStage4();
    if (decision) {
      // STAGE 5 fold-in: if the decision came from a vendor and the audit said
      // refuted, charge NEGEV before returning.
      if (
        decision.vendor &&
        ctx.negevCharge &&
        trail.some((t) => t.sub === "audit:refuted")
      ) {
        try {
          await ctx.negevCharge(decision.vendor, req.prompt);
          trail.push({ stage: 5, sub: "negev_charge", outcome: "hit" });
        } catch {
          trail.push({ stage: 5, sub: "negev_charge", outcome: "error" });
        }
      }
      return decision;
    }
  }

  // Fallback: no stage handled it. Return a no-op decision so the caller
  // knows to fall back to its default vendor.
  const partial: Omit<GovernorDecision, "signature" | "explanation"> = {
    stage: 4, action: "expensive_vendor", answer: "",
    vendor: req.vendorPreferred ?? null,
    tokensUsedActual: 0, estTokensSavedVsDirect: 0,
    predictedConfidence: null, trail,
  };
  return {
    ...partial,
    signature: signDecision(partial, secret),
    explanation: "Governor cascade exhausted with no handler. Caller should fall back to its default vendor path.",
  };
}

/** Compute realised savings across a decision log. */
export function aggregateSavings(decisions: GovernorDecision[]): {
  totalCallsGoverned: number;
  totalTokensSaved: number;
  byStage: Record<GovernorStage, { calls: number; tokensSaved: number }>;
  cacheHitRate: number;
  localHitRate: number;
} {
  const out = {
    totalCallsGoverned: decisions.length,
    totalTokensSaved: 0,
    byStage: { 1: { calls: 0, tokensSaved: 0 }, 2: { calls: 0, tokensSaved: 0 }, 3: { calls: 0, tokensSaved: 0 }, 4: { calls: 0, tokensSaved: 0 }, 5: { calls: 0, tokensSaved: 0 } } as Record<GovernorStage, { calls: number; tokensSaved: number }>,
    cacheHitRate: 0,
    localHitRate: 0,
  };
  let cache = 0, local = 0;
  for (const d of decisions) {
    out.totalTokensSaved += d.estTokensSavedVsDirect;
    out.byStage[d.stage].calls += 1;
    out.byStage[d.stage].tokensSaved += d.estTokensSavedVsDirect;
    if (d.action === "cache_hit") cache += 1;
    if (d.action === "local_answer") local += 1;
  }
  if (decisions.length > 0) {
    out.cacheHitRate = cache / decisions.length;
    out.localHitRate = local / decisions.length;
  }
  return out;
}

/** Verify a decision's HMAC signature (tamper detection). */
export function verifyDecision(d: GovernorDecision, secret?: string): { ok: boolean; reason?: string } {
  const { signature, explanation: _expl, ...body } = d;
  const expected = signDecision(body, secret ?? defaultSecret());
  if (expected !== signature) return { ok: false, reason: "HMAC mismatch — decision tampered with or wrong secret" };
  return { ok: true };
}
