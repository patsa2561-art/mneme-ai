/**
 * v2.19.21 — MNEME SNN AUTO-PROMOTE (W5 audit fix at SOURCE)
 *
 *   User audit (W5): mneme status reports hash:fnv-256 [FALLBACK] even
 *   though SNN MCP tools ship + resolveEmbedder ladder includes SNN. The
 *   v2.19.16 BundledOrSnnEmbedder promoted at runtime (in-memory) but
 *   never wrote the resolution back to disk — so every `mneme status`
 *   call re-resolved + every fresh process started cold.
 *
 *   v2.19.21 closes the gap: `decidePromotion()` compares the saved
 *   config's provider against the runtime-resolved tier and recommends a
 *   one-way promotion when (a) saved is hash (the worst tier), (b) runtime
 *   resolved to a higher tier. Pure function — caller decides whether to
 *   persist the promotion (writes to .mneme/config.json).
 *
 *   HMAC-chained PROMOTION HISTORY ledger so the daemon can audit + roll
 *   back if quality degrades.
 *
 * Honest scope:
 *   - Refuses to downgrade. If saved provider is `snn` or higher and
 *     ladder resolved to a lower tier (e.g., bundled fail → snn), no
 *     auto-write. The user's explicit pin always wins.
 *   - Refuses to "promote" between equal-tier providers (snn vs bundled
 *     — both ★★★) unless the runtime tier is strictly higher quality.
 *   - Caller persists. Mneme returns the decision; .mneme/config.json
 *     write is the CLI's call.
 */

import { createHmac, timingSafeEqual } from "node:crypto";

const PROTOCOL_VERSION = 1 as const;

export type EmbedderTier = "openai" | "ollama" | "snn" | "bundled" | "hash" | "auto" | "unknown";

/** Strict quality ordering. Higher index = higher quality. */
const TIER_RANK: Record<EmbedderTier, number> = {
  hash: 1,
  unknown: 1,
  bundled: 2,
  snn: 2, // peer of bundled — pure-TS vs WASM
  auto: 3, // "auto" means "let the ladder pick"; treat as middle
  ollama: 4,
  openai: 5,
};

export interface PromotionDecision {
  v: typeof PROTOCOL_VERSION;
  savedProvider: EmbedderTier;
  runtimeResolvedName: string;
  runtimeResolvedTier: EmbedderTier;
  shouldPromote: boolean;
  recommendedProvider: EmbedderTier | null;
  reason: string;
  isDowngradeRefused: boolean;
}

/** Parse the active embedder's `name` field into a tier. */
export function tierFromName(name: string): EmbedderTier {
  if (name.startsWith("openai:")) return "openai";
  if (name.startsWith("ollama:")) return "ollama";
  if (name.startsWith("bundled:")) return "bundled";
  if (name.startsWith("snn:")) return "snn";
  if (name.startsWith("hash:")) return "hash";
  return "unknown";
}

/**
 * Decide whether to promote the saved config to the runtime-resolved tier.
 *   Promote when:
 *     savedProvider is "auto" OR "hash" (worst tier)
 *     AND runtime resolved to a higher tier than "hash"
 *   Refuse to downgrade:
 *     if savedProvider's rank >= runtime's rank, no write
 */
export function decidePromotion(input: {
  savedProvider: EmbedderTier;
  runtimeResolvedName: string;
}): PromotionDecision {
  const runtimeTier = tierFromName(input.runtimeResolvedName);
  const savedRank = TIER_RANK[input.savedProvider] ?? 0;
  const runtimeRank = TIER_RANK[runtimeTier] ?? 0;
  const isDowngradeRefused = savedRank >= runtimeRank && input.savedProvider !== "auto";
  // Auto-promote happens when:
  //   (a) saved is "hash" or "auto" (worst-tier / undecided)
  //   (b) runtime resolved to a STRICTLY higher tier
  const shouldPromote = (input.savedProvider === "hash" || input.savedProvider === "auto")
    && runtimeRank > savedRank;
  const recommendedProvider: EmbedderTier | null = shouldPromote ? runtimeTier : null;
  let reason: string;
  if (shouldPromote) {
    reason = `saved=${input.savedProvider} (rank ${savedRank}) → runtime=${runtimeTier} (rank ${runtimeRank}); promoting to surface real tier in status + skip future probe`;
  } else if (isDowngradeRefused) {
    reason = `saved=${input.savedProvider} (rank ${savedRank}) >= runtime=${runtimeTier} (rank ${runtimeRank}); refusing to downgrade (user's explicit pin wins)`;
  } else {
    reason = `saved=${input.savedProvider} (rank ${savedRank}) ~ runtime=${runtimeTier} (rank ${runtimeRank}); no promotion needed`;
  }
  return {
    v: PROTOCOL_VERSION,
    savedProvider: input.savedProvider,
    runtimeResolvedName: input.runtimeResolvedName,
    runtimeResolvedTier: runtimeTier,
    shouldPromote,
    recommendedProvider,
    reason,
    isDowngradeRefused,
  };
}

// ─── PROMOTION HISTORY LEDGER ───────────────────────────────────────────

export interface PromotionRecord {
  v: typeof PROTOCOL_VERSION;
  from: EmbedderTier;
  to: EmbedderTier;
  runtimeResolvedName: string;
  reason: string;
  ts: number;
  prevSig: string | null;
  sig: string;
}

export interface PromotionHistory {
  v: typeof PROTOCOL_VERSION;
  records: PromotionRecord[];
}

function canon(v: unknown): string {
  if (v === null || typeof v !== "object") return JSON.stringify(v);
  if (Array.isArray(v)) return "[" + v.map(canon).join(",") + "]";
  const keys = Object.keys(v as Record<string, unknown>).sort();
  return "{" + keys.map((k) => JSON.stringify(k) + ":" + canon((v as Record<string, unknown>)[k])).join(",") + "}";
}

function defaultSecret(): string {
  return process.env["MNEME_SNN_PROMOTE_SECRET"] || `mneme-snn-auto-promote-v${PROTOCOL_VERSION}`;
}

function signRecord(body: Omit<PromotionRecord, "sig">, secret: string): string {
  return createHmac("sha256", secret).update(canon(body)).digest("hex");
}

function safeEqHex(a: string, b: string): boolean {
  try { return timingSafeEqual(Buffer.from(a, "hex"), Buffer.from(b, "hex")); }
  catch { return false; }
}

export function emptyPromotionHistory(): PromotionHistory {
  return { v: PROTOCOL_VERSION, records: [] };
}

export function appendPromotion(opts: {
  history: PromotionHistory;
  decision: PromotionDecision;
  nowMs?: number;
  secret?: string;
}): PromotionHistory {
  if (!opts.decision.shouldPromote || opts.decision.recommendedProvider === null) {
    return opts.history;
  }
  const prev = opts.history.records[opts.history.records.length - 1];
  const body: Omit<PromotionRecord, "sig"> = {
    v: PROTOCOL_VERSION,
    from: opts.decision.savedProvider,
    to: opts.decision.recommendedProvider,
    runtimeResolvedName: opts.decision.runtimeResolvedName,
    reason: opts.decision.reason,
    ts: opts.nowMs ?? Date.now(),
    prevSig: prev ? prev.sig : null,
  };
  const sig = signRecord(body, opts.secret ?? defaultSecret());
  return { v: PROTOCOL_VERSION, records: [...opts.history.records, { ...body, sig }] };
}

export function verifyPromotionHistory(history: PromotionHistory, secret?: string): { ok: boolean; brokenAt?: number; reason?: string } {
  const sec = secret ?? defaultSecret();
  let prevSig: string | null = null;
  for (let i = 0; i < history.records.length; i++) {
    const r = history.records[i]!;
    const { sig, ...body } = r;
    if (body.prevSig !== prevSig) return { ok: false, brokenAt: i, reason: `prevSig mismatch at step ${i}` };
    if (!safeEqHex(signRecord(body, sec), sig)) return { ok: false, brokenAt: i, reason: `HMAC mismatch at step ${i}` };
    prevSig = sig;
  }
  return { ok: true };
}

export function formatDecisionLine(d: PromotionDecision): string {
  const tag = d.shouldPromote ? "⬆" : d.isDowngradeRefused ? "🛡" : "·";
  return `${tag} SNN-PROMOTE · saved=${d.savedProvider} · runtime=${d.runtimeResolvedTier} · ${d.shouldPromote ? "PROMOTE" : "no-op"}`;
}
