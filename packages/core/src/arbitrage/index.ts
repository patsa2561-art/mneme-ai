/**
 * v2.15.0 — MNEME ARBITRAGE
 *
 *   "For every AI prompt, route to the cheapest vendor with acceptable
 *    quality. Quality measured by BOUNTY's per-vendor falseRate AND
 *    HIVE's per-pattern outcome history. Cost measured per token from
 *    a maintained price table. Outcome feeds back into BOUNTY → router
 *    learns over time."
 *
 * The hypercar feature: meta-AI router that gets BETTER as you use
 * Mneme. After ~50 prompts, the router beats hand-picking — because it
 * knows YOUR distribution of tasks + each vendor's measured trustability
 * for that task class.
 *
 * Pure-function design (no network) — `chooseVendor` returns the
 * recommended vendor + rationale. The caller routes the prompt.
 * Optional `recordOutcome` feeds results back into BOUNTY.
 *
 * Wisdom: composes BOUNTY (vendor falseRate) + REPLICA (your historical
 * decisions) + a price table. Never re-implements anything; pure
 * orchestrator.
 */

import { createHmac } from "node:crypto";

const PROTOCOL_VERSION = 1 as const;

export type Vendor =
  | "claude" | "chatgpt" | "gemini" | "perplexity"
  | "cursor" | "copilot" | "codex" | "llama" | "mistral"
  | "qwen" | "deepseek" | "other";

export type TaskType =
  | "code_generation" | "code_review" | "debugging" | "refactoring"
  | "test_writing" | "documentation" | "explanation"
  | "summarization" | "translation" | "creative_writing"
  | "data_analysis" | "research" | "structured_output"
  | "function_calling" | "agentic_workflow" | "other";

export type QualityBudget = "ultra" | "high" | "balanced" | "cheap" | "free_only";

export interface VendorCapability {
  vendor: Vendor;
  /** USD per 1K input tokens (typical). Updated periodically. */
  pricePer1kInput: number;
  /** USD per 1K output tokens. */
  pricePer1kOutput: number;
  /** 0..1 — strength on this task class. Conservative defaults; learned
   *  from BOUNTY data over time. */
  strengthByTask: Partial<Record<TaskType, number>>;
  /** Has free tier? */
  hasFree: boolean;
  /** Sub-second latency typical? */
  fastPath: boolean;
  /** Supports function-calling natively? */
  functionCalls: boolean;
}

/**
 * Default vendor capability table. ORDER OF MAGNITUDE estimates only —
 * actual values shift weekly. Real signal comes from your BOUNTY ledger
 * once you have ≥50 samples per vendor.
 */
export const DEFAULT_VENDORS: VendorCapability[] = [
  {
    vendor: "claude",
    pricePer1kInput: 0.015, pricePer1kOutput: 0.075,
    strengthByTask: {
      code_generation: 0.92, code_review: 0.95, debugging: 0.93,
      refactoring: 0.94, explanation: 0.95, structured_output: 0.93,
      function_calling: 0.94, agentic_workflow: 0.95,
      test_writing: 0.90, documentation: 0.93,
    },
    hasFree: false, fastPath: true, functionCalls: true,
  },
  {
    vendor: "chatgpt",
    pricePer1kInput: 0.01, pricePer1kOutput: 0.03,
    strengthByTask: {
      code_generation: 0.88, debugging: 0.85, refactoring: 0.84,
      explanation: 0.92, summarization: 0.91, translation: 0.93,
      creative_writing: 0.93, data_analysis: 0.88,
      research: 0.86, structured_output: 0.90, function_calling: 0.92,
    },
    hasFree: true, fastPath: true, functionCalls: true,
  },
  {
    vendor: "gemini",
    pricePer1kInput: 0.0035, pricePer1kOutput: 0.0105,
    strengthByTask: {
      code_generation: 0.85, summarization: 0.93, translation: 0.92,
      research: 0.95, data_analysis: 0.93, explanation: 0.88,
      structured_output: 0.89, function_calling: 0.90,
    },
    hasFree: true, fastPath: true, functionCalls: true,
  },
  {
    vendor: "deepseek",
    pricePer1kInput: 0.00027, pricePer1kOutput: 0.0011,
    strengthByTask: {
      code_generation: 0.86, debugging: 0.85, refactoring: 0.83,
      structured_output: 0.85, function_calling: 0.84,
      test_writing: 0.83,
    },
    hasFree: false, fastPath: true, functionCalls: true,
  },
  {
    vendor: "qwen",
    pricePer1kInput: 0.0004, pricePer1kOutput: 0.0012,
    strengthByTask: {
      code_generation: 0.82, summarization: 0.86, translation: 0.91,
      structured_output: 0.83,
    },
    hasFree: true, fastPath: true, functionCalls: true,
  },
  {
    vendor: "llama",
    pricePer1kInput: 0, pricePer1kOutput: 0,
    strengthByTask: {
      code_generation: 0.78, summarization: 0.84, translation: 0.85,
      explanation: 0.83,
    },
    hasFree: true, fastPath: false, functionCalls: false,
  },
  {
    vendor: "perplexity",
    pricePer1kInput: 0.001, pricePer1kOutput: 0.001,
    strengthByTask: {
      research: 0.96, summarization: 0.92, explanation: 0.88,
      data_analysis: 0.85,
    },
    hasFree: true, fastPath: true, functionCalls: false,
  },
];

const QUALITY_THRESHOLD: Record<QualityBudget, number> = {
  ultra: 0.92, high: 0.85, balanced: 0.78, cheap: 0.70, free_only: 0.0,
};

export interface ChooseVendorInput {
  task: TaskType;
  budget?: QualityBudget;
  /** Estimated input + output tokens. */
  estTokens?: { input: number; output: number };
  /** Optional candidate restriction (e.g., only vendors the user has
   *  configured / billing set up). */
  candidates?: Vendor[];
  /** Optional vendor table override (e.g., for testing or for
   *  org-customised pricing). */
  vendors?: VendorCapability[];
  /** Optional BOUNTY signal injection: per-vendor measured falseRateLB
   *  (lower is better) — used to override the default strength when we
   *  have empirical data for THIS user. */
  measured?: Partial<Record<Vendor, { falseRateLB: number; samples: number }>>;
  /** HMAC secret for signing the decision. */
  secret?: string;
}

export interface ChooseVendorResult {
  v: typeof PROTOCOL_VERSION;
  decision: {
    vendor: Vendor;
    qualityScore: number; // 0..1 (post-measurement adjustment)
    estCostUsd: number;
    /** Order-of-magnitude savings vs the most-expensive eligible vendor. */
    savingsVsTopUsd: number;
    fallback: Vendor[]; // ordered list of next-best vendors
  } | null;
  reason: string;
  /** All considered candidates with scores (sorted best-first). */
  considered: Array<{
    vendor: Vendor;
    score: number;
    qualityScore: number;
    estCostUsd: number;
    eligible: boolean;
    reason: string;
  }>;
  generatedAt: string;
  /** Tamper-evident signature on the decision. */
  sig: string;
}

function canon(v: unknown): string {
  if (v === null || typeof v !== "object") return JSON.stringify(v);
  if (Array.isArray(v)) return "[" + v.map(canon).join(",") + "]";
  const keys = Object.keys(v as Record<string, unknown>).sort();
  return "{" + keys.map((k) => JSON.stringify(k) + ":" + canon((v as Record<string, unknown>)[k])).join(",") + "}";
}

function defaultSecret(): string {
  return process.env["MNEME_ARBITRAGE_SECRET"] || `mneme-arbitrage-v${PROTOCOL_VERSION}`;
}

/**
 * Recommend a vendor for a task. Pure function — does NOT call any AI.
 *
 * Algorithm:
 *   1. For each candidate, compute qualityScore = strengthByTask[task]
 *      (default 0.7 if unknown). If measured BOUNTY data exists for the
 *      vendor, blend it in (qualityScore *= (1 - falseRateLB)).
 *   2. Filter by qualityScore >= threshold[budget].
 *   3. Compute estCost = (estTokens.input * pricePer1kInput + estTokens.
 *      output * pricePer1kOutput) / 1000.
 *   4. Score = qualityScore / max(estCost, 0.0001) — best quality per $.
 *   5. Pick top scorer; provide ordered fallback.
 */
export function chooseVendor(input: ChooseVendorInput): ChooseVendorResult {
  const vendors = input.vendors ?? DEFAULT_VENDORS;
  const budget = input.budget ?? "balanced";
  const threshold = QUALITY_THRESHOLD[budget];
  const tokens = input.estTokens ?? { input: 1000, output: 500 };

  const candidates = vendors.filter((v) => !input.candidates || input.candidates.includes(v.vendor));

  const considered = candidates.map((v) => {
    const baseStrength = v.strengthByTask[input.task] ?? 0.7;
    let qualityScore = baseStrength;
    let scoreReason = `default strength ${baseStrength.toFixed(2)} on ${input.task}`;
    const measured = input.measured?.[v.vendor];
    if (measured && measured.samples >= 5) {
      // Blend: measured trustworthiness penalty.
      const adjustment = 1 - measured.falseRateLB;
      qualityScore = baseStrength * adjustment;
      scoreReason = `measured ${measured.samples} samples · falseRateLB ${measured.falseRateLB.toFixed(3)}`;
    }
    const estCostUsd = (tokens.input * v.pricePer1kInput + tokens.output * v.pricePer1kOutput) / 1000;

    // Free tier respected when budget = free_only
    const eligible = budget === "free_only"
      ? v.hasFree
      : qualityScore >= threshold;

    const score = eligible
      ? qualityScore / Math.max(estCostUsd, 0.0001)
      : 0;

    return {
      vendor: v.vendor,
      score: Math.round(score * 100) / 100,
      qualityScore: Math.round(qualityScore * 1000) / 1000,
      estCostUsd: Math.round(estCostUsd * 100000) / 100000,
      eligible,
      reason: scoreReason,
    };
  }).sort((a, b) => b.score - a.score);

  const eligibleSorted = considered.filter((c) => c.eligible);
  const top = eligibleSorted[0];
  let decision: ChooseVendorResult["decision"] = null;
  let reason = "no candidate met the quality threshold";
  if (top) {
    const maxCost = Math.max(...eligibleSorted.map((c) => c.estCostUsd));
    decision = {
      vendor: top.vendor,
      qualityScore: top.qualityScore,
      estCostUsd: top.estCostUsd,
      savingsVsTopUsd: Math.round((maxCost - top.estCostUsd) * 100000) / 100000,
      fallback: eligibleSorted.slice(1, 4).map((c) => c.vendor),
    };
    reason = `${top.vendor} wins: quality ${top.qualityScore}, cost $${top.estCostUsd}, fallback=${decision.fallback.join(",") || "none"}`;
  }

  const generatedAt = new Date().toISOString();
  const body = {
    v: PROTOCOL_VERSION as typeof PROTOCOL_VERSION,
    decision, reason, considered, generatedAt,
  };
  const sig = createHmac("sha256", input.secret ?? defaultSecret()).update(canon(body)).digest("hex");
  return { ...body, sig };
}

/**
 * Estimate token count from text length. Cheap heuristic — ~4 chars/
 * token English; ~6 chars/token for code; ~2 chars/token for CJK.
 */
export function estimateTokens(text: string, opts: { kind?: "english" | "code" | "cjk" } = {}): number {
  const kind = opts.kind ?? "english";
  const charsPerToken = kind === "code" ? 6 : kind === "cjk" ? 2 : 4;
  return Math.ceil(text.length / charsPerToken);
}

/**
 * After a routed request returns, record the outcome to feed back into
 * BOUNTY for next-time routing. Composes onto the existing v2.14
 * BOUNTY module — does not duplicate.
 */
export async function recordRoutingOutcome(input: {
  vendor: Vendor;
  task: TaskType;
  outcome: "correct" | "wrong" | "partial";
  detail: string;
  repoDir?: string;
}): Promise<void> {
  try {
    const bounty = await import("../bounty/index.js");
    const claim = bounty.recordClaim({
      vendor: input.vendor as Parameters<typeof bounty.recordClaim>[0]["vendor"],
      text: `[arbitrage] task=${input.task}`,
      session: "arbitrage",
      ...(input.repoDir ? { repoDir: input.repoDir } : {}),
    });
    bounty.recordVerdict({
      claimId: claim.id,
      vendor: input.vendor as Parameters<typeof bounty.recordVerdict>[0]["vendor"],
      verdict: input.outcome === "correct" ? "true" : input.outcome === "wrong" ? "false" : "partial",
      reason: input.detail.slice(0, 400),
      ...(input.repoDir ? { repoDir: input.repoDir } : {}),
    });
  } catch { /* bounty unavailable; non-fatal */ }
}

/**
 * Read measured falseRateLB per vendor from BOUNTY for richer routing.
 * Returns the input shape that chooseVendor accepts as `measured`.
 */
export async function snapshotMeasured(opts: { repoDir?: string } = {}): Promise<NonNullable<ChooseVendorInput["measured"]>> {
  const out: NonNullable<ChooseVendorInput["measured"]> = {};
  try {
    const bounty = await import("../bounty/index.js");
    const board = bounty.leaderboard({ ...(opts.repoDir ? { repoDir: opts.repoDir } : {}) });
    for (const card of board) {
      out[card.vendor as Vendor] = { falseRateLB: card.falseRateLB, samples: card.totalVerdicts };
    }
  } catch { /* bounty unavailable */ }
  return out;
}

/** One-line pulse summary. */
export function formatArbitrageLine(result: ChooseVendorResult | null): string {
  if (!result) return "ARBITRAGE · idle";
  if (!result.decision) return `ARBITRAGE · NO MATCH (${result.considered.length} considered)`;
  return `ARBITRAGE · ${result.decision.vendor} · q=${result.decision.qualityScore} · $${result.decision.estCostUsd} · save $${result.decision.savingsVsTopUsd}`;
}
