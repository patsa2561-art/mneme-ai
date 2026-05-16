/**
 * v2.19.10 — MNEME REVERSE-WRAPPER (tool suggests next tool)
 *
 *   "MCP spec is pull-only — clients ask, servers answer. Mneme bends
 *    the contract (without breaking it): every wrapper response can
 *    attach an OPTIONAL `__suggested_next_call` field with the tool
 *    name + reasoning + confidence + cost estimate. The AI agent's
 *    planner sees the suggestion; if it's smart, it follows. If it
 *    isn't, nothing breaks. Pure additive layer over MCP.
 *
 *    Bonus: telemetry. We log every suggestion + whether the AI
 *    followed within N calls. Follow-through rate measures BOTH:
 *      • the quality of the suggestion (high follow → good tool design)
 *      • the calibration of the AI (high follow → AI listens to hints)
 *    Loop detection: refuses to suggest a tool that was in the last K
 *    invocations of the current session."
 *
 * Honest scope:
 *   - The suggestion is ADVISORY. The AI agent's planner makes the
 *     final decision. We never auto-invoke anything.
 *   - Loop detection is per-session (caller supplies session id) and
 *     uses a sliding window (default last 8 invocations).
 *   - Suggestion rules can be hand-written OR mined from test corpus
 *     by AUTO-GENESIS (we expose the rule shape; the mining is left
 *     to the caller / future v2.20).
 *
 * Composes onto every MCP tool + v2.19.9 GENESPLICING (chimera's
 * sequential mode follows the suggestion chain) + v2.19.10
 * PROOF-CARRYING (the suggestion can carry a proof of where it came
 * from). Pure additive layer.
 */

import { createHmac, timingSafeEqual } from "node:crypto";

const PROTOCOL_VERSION = 1 as const;
const DEFAULT_LOOP_WINDOW = 8;

export interface SuggestedNext {
  v: typeof PROTOCOL_VERSION;
  suggestedNextId: string;
  /** Recommended next tool name (e.g., "mneme.chronostasis.witness"). */
  tool: string;
  /** Human-readable rationale. */
  why: string;
  /** Confidence 0..1 the suggestion is right. */
  confidence: number;
  /** Optional USD cost estimate for the suggested call. */
  costEstimateUsd?: number;
  /** Optional pre-filled args (planner can adjust). */
  suggestedArgs?: Record<string, unknown>;
  /** Why this WASN'T suggested? (set when suppressed by loop detection). */
  suppressedReason?: string;
  ts: string;
  sig: string;
}

/** Wrapper output with optional suggested-next attached. */
export interface OutputWithSuggestion<T = unknown> {
  data: T;
  __suggested_next?: SuggestedNext;
}

export interface SuggestionRule {
  /** Name of the tool whose output triggers this rule. */
  forTool: string;
  /** Optional predicate over the output; if false, rule doesn't fire. */
  predicate?: (output: unknown) => boolean;
  /** Suggested next tool. */
  suggestTool: string;
  /** Why this suggestion. */
  why: string;
  /** Baseline confidence (0..1). */
  confidence: number;
  /** Optional cost estimate USD. */
  costEstimateUsd?: number;
  /** Optional args builder. */
  buildArgs?: (output: unknown) => Record<string, unknown>;
}

export interface FollowThroughEvent {
  /** Session this telemetry belongs to. */
  sessionId: string;
  /** The suggestion that was emitted. */
  suggestion: SuggestedNext;
  /** Was the next call to the suggested tool within window N? */
  followed: boolean;
  /** Number of invocations between suggestion + follow (or window expiry). */
  invocationsBetween: number;
  recordedAt: string;
}

function canon(v: unknown): string {
  if (v === null || typeof v !== "object") return JSON.stringify(v);
  if (Array.isArray(v)) return "[" + v.map(canon).join(",") + "]";
  const keys = Object.keys(v as Record<string, unknown>).sort();
  return "{" + keys.map((k) => JSON.stringify(k) + ":" + canon((v as Record<string, unknown>)[k])).join(",") + "}";
}

function defaultSecret(): string {
  return process.env["MNEME_REVERSE_WRAPPER_SECRET"] || `mneme-reverse-wrapper-v${PROTOCOL_VERSION}`;
}

function hmac(body: unknown, secret: string): string {
  return createHmac("sha256", secret).update(canon(body)).digest("hex");
}

function safeEqHex(a: string, b: string): boolean {
  try { return timingSafeEqual(Buffer.from(a, "hex"), Buffer.from(b, "hex")); }
  catch { return false; }
}

// ─── Session call history (for loop detection + follow-through) ─────────
export class ReverseWrapperSession {
  private callHistory: Array<{ tool: string; ts: number }> = [];
  private pendingSuggestions: Array<{ suggestion: SuggestedNext; emittedAtIdx: number }> = [];
  private followEvents: FollowThroughEvent[] = [];
  private secret: string;
  public readonly sessionId: string;
  public readonly loopWindow: number;

  constructor(opts: { sessionId: string; loopWindow?: number; secret?: string }) {
    this.sessionId = opts.sessionId;
    this.loopWindow = opts.loopWindow ?? DEFAULT_LOOP_WINDOW;
    this.secret = opts.secret ?? defaultSecret();
  }

  /** Record that a tool was just called. Updates loop-detection state + checks pending suggestions. */
  recordCall(toolName: string, nowMs?: number): void {
    const ts = nowMs ?? Date.now();
    this.callHistory.push({ tool: toolName, ts });
    // Check any pending suggestions: did this call satisfy them?
    const currentIdx = this.callHistory.length - 1;
    for (const ps of this.pendingSuggestions) {
      const between = currentIdx - ps.emittedAtIdx;
      if (between > this.loopWindow) {
        // Expired without follow-through
        this.followEvents.push({
          sessionId: this.sessionId,
          suggestion: ps.suggestion,
          followed: false,
          invocationsBetween: between,
          recordedAt: new Date(ts).toISOString(),
        });
      } else if (ps.suggestion.tool === toolName) {
        // Followed!
        this.followEvents.push({
          sessionId: this.sessionId,
          suggestion: ps.suggestion,
          followed: true,
          invocationsBetween: between,
          recordedAt: new Date(ts).toISOString(),
        });
      }
    }
    // Prune pending: keep only ones not yet resolved
    this.pendingSuggestions = this.pendingSuggestions.filter((ps) => {
      const between = currentIdx - ps.emittedAtIdx;
      const expired = between > this.loopWindow;
      const followed = ps.suggestion.tool === toolName;
      return !expired && !followed;
    });
  }

  /**
   * Apply suggestion rules to a (currentTool, output) pair. Returns a
   * SuggestedNext if any rule fires AND it doesn't trigger loop detection.
   */
  suggestNext(input: {
    currentTool: string;
    output: unknown;
    rules: SuggestionRule[];
    nowMs?: number;
  }): SuggestedNext | null {
    const ts = input.nowMs ?? Date.now();
    // Find first matching rule
    const matched = input.rules.find((r) =>
      r.forTool === input.currentTool && (!r.predicate || r.predicate(input.output))
    );
    if (!matched) return null;

    // Build the suggestion
    const buildId = (): string => "sn-" + createHmac("sha256", "mneme-reverse-sn-id")
      .update(`${this.sessionId}|${matched.suggestTool}|${ts}`)
      .digest("hex").slice(0, 14);
    const suggestedNextId = buildId();
    const baseBody: Omit<SuggestedNext, "sig"> = {
      v: PROTOCOL_VERSION,
      suggestedNextId,
      tool: matched.suggestTool,
      why: matched.why,
      confidence: matched.confidence,
      ...(matched.costEstimateUsd !== undefined ? { costEstimateUsd: matched.costEstimateUsd } : {}),
      ...(matched.buildArgs ? { suggestedArgs: matched.buildArgs(input.output) } : {}),
      ts: new Date(ts).toISOString(),
    };

    // Loop detection: is suggestTool in the recent window?
    const recentTools = this.callHistory.slice(-this.loopWindow).map((c) => c.tool);
    if (recentTools.includes(matched.suggestTool)) {
      const suppressed: Omit<SuggestedNext, "sig"> = {
        ...baseBody,
        suppressedReason: `loop guard: '${matched.suggestTool}' called within last ${this.loopWindow} invocations`,
      };
      const sig = hmac(suppressed, this.secret);
      return { ...suppressed, sig };
    }

    const sig = hmac(baseBody, this.secret);
    const suggestion: SuggestedNext = { ...baseBody, sig };
    // Track as pending so we can measure follow-through
    this.pendingSuggestions.push({ suggestion, emittedAtIdx: this.callHistory.length - 1 });
    return suggestion;
  }

  /** Attach a suggestion to a wrapper output (mutation-free). */
  attachSuggestion<T>(input: {
    output: T;
    currentTool: string;
    rules: SuggestionRule[];
    nowMs?: number;
  }): OutputWithSuggestion<T> {
    const sn = this.suggestNext({
      currentTool: input.currentTool,
      output: input.output,
      rules: input.rules,
      ...(input.nowMs !== undefined ? { nowMs: input.nowMs } : {}),
    });
    if (!sn) return { data: input.output };
    return { data: input.output, __suggested_next: sn };
  }

  followThroughStats(): {
    totalSuggestions: number;
    followed: number;
    expired: number;
    followRate: number;
    pendingNow: number;
    perToolBreakdown: Array<{ tool: string; suggested: number; followed: number; rate: number }>;
  } {
    const totalSuggestions = this.followEvents.length + this.pendingSuggestions.length;
    const followed = this.followEvents.filter((e) => e.followed).length;
    const expired = this.followEvents.filter((e) => !e.followed).length;
    const decided = followed + expired;
    const followRate = decided === 0 ? 0 : Math.round((followed / decided) * 1000) / 1000;
    const perToolMap = new Map<string, { suggested: number; followed: number }>();
    for (const e of this.followEvents) {
      const m = perToolMap.get(e.suggestion.tool) ?? { suggested: 0, followed: 0 };
      m.suggested++;
      if (e.followed) m.followed++;
      perToolMap.set(e.suggestion.tool, m);
    }
    const perToolBreakdown = Array.from(perToolMap.entries()).map(([tool, m]) => ({
      tool, suggested: m.suggested, followed: m.followed,
      rate: m.suggested === 0 ? 0 : Math.round((m.followed / m.suggested) * 1000) / 1000,
    })).sort((a, b) => b.rate - a.rate);
    return {
      totalSuggestions, followed, expired, followRate,
      pendingNow: this.pendingSuggestions.length,
      perToolBreakdown,
    };
  }

  recentHistory(n: number = 8): Array<{ tool: string; ts: number }> {
    return this.callHistory.slice(-n);
  }
}

export function verifySuggestion(s: SuggestedNext, secret?: string): boolean {
  const { sig, ...body } = s;
  return safeEqHex(hmac(body, secret ?? defaultSecret()), sig);
}

export function formatSuggestionLine(s: SuggestedNext): string {
  const icon = s.suppressedReason ? "🔁" : "🪂";
  return `${icon} SUGGEST · ${s.tool} · conf=${s.confidence}${s.costEstimateUsd ? ` · $${s.costEstimateUsd}` : ""}${s.suppressedReason ? " · SUPPRESSED" : ""}`;
}

/** Built-in suggestion rules shipped with v2.19.10. Extensible. */
export const BUILTIN_RULES: SuggestionRule[] = [
  {
    forTool: "mneme.inverse.audit",
    predicate: (out) => {
      const data = (out as { data?: { verdict?: string } } | { verdict?: string }) ?? {};
      const v = ("data" in data ? data.data?.verdict : (data as { verdict?: string }).verdict) ?? "";
      return v === "rejected";
    },
    suggestTool: "mneme.chronostasis.tick",
    why: "Rejected output should trigger CHRONOSTASIS witness pool to rewind dependents.",
    confidence: 0.92,
    costEstimateUsd: 0.003,
  },
  {
    forTool: "mneme.confessional.audit",
    predicate: (out) => {
      const data = (out as { data?: { verdict?: string } } | { verdict?: string }) ?? {};
      const v = ("data" in data ? data.data?.verdict : (data as { verdict?: string }).verdict) ?? "";
      return v === "block" || v === "flag";
    },
    suggestTool: "mneme.inverse.audit",
    why: "Flagged/blocked diff should be re-audited by the rarer output→input direction.",
    confidence: 0.78,
  },
  {
    forTool: "mneme.chronostasis.propose",
    suggestTool: "mneme.chronostasis.witness_prompt",
    why: "Newly proposed claim should immediately get a witness panel summons.",
    confidence: 0.85,
  },
  {
    forTool: "mneme.agreement.compile",
    suggestTool: "mneme.agreement.pre_commit_hook",
    why: "Compiled agreement should be wired into the pre-commit gate.",
    confidence: 0.88,
  },
  {
    forTool: "mneme.dream.run",
    predicate: (out) => {
      const r = out as { data?: { candidatesEmitted?: number } } | { candidatesEmitted?: number };
      const c = "data" in r ? r.data?.candidatesEmitted : (r as { candidatesEmitted?: number }).candidatesEmitted;
      return (c ?? 0) > 0;
    },
    suggestTool: "mneme.dream.review",
    why: "Dream cycle emitted candidates — parent should review (confirm or refute).",
    confidence: 0.90,
  },
  // v2.19.18 — CAPTION SEVERANCE routing (Layer 3 of 4-layer defense).
  // After mneme.caption.sever runs, suggest adversarial_check as the
  // natural follow-up so the AI verifies its own caption-independence.
  {
    forTool: "mneme.caption.sever",
    predicate: (out) => {
      const r = out as { data?: { certificate?: { finalCredibility?: number } } };
      const cred = r?.data?.certificate?.finalCredibility ?? 1;
      // Low credibility → strongly suggest the double-check
      return cred < 0.5;
    },
    suggestTool: "mneme.caption.adversarial_check",
    why: "Low caption-severance credibility — verify the AI's answer is not caption-dependent via 2x vendor diff.",
    confidence: 0.92,
    costEstimateUsd: 0.006, // 2x vendor-vision calls
  },
];
