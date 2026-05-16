/**
 * v2.19.2 — EMBEDDER AUTO-PROMOTE
 *
 *   "If doctor says 'pick ollama' and config is 'hash' and ollama is
 *    reachable, the system is silently degrading semantic search to
 *    ★★ instead of ★★★★. AUTO-PROMOTE makes the upgrade a one-call
 *    decision: doctor's recommendation becomes the new config, with
 *    a signed receipt the user can replay or revert."
 *
 * Pure function over caller-supplied doctor verdict + current config.
 * Returns the new config (or null if no change) + a signed receipt.
 * The CLI / daemon decides when to call this — typically on every
 * `mneme status` or on every daemon cycle.
 *
 * Composes onto v1.65.1 `mneme.embedder.autodiagnose`. Pure additive.
 */

import { createHmac, timingSafeEqual } from "node:crypto";

const PROTOCOL_VERSION = 1 as const;

export type EmbedderProvider = "auto" | "ollama" | "openai" | "bundled" | "hash";

export interface DoctorVerdict {
  pick: EmbedderProvider;
  reason: string;
  qualityStars: 1 | 2 | 3 | 4 | 5;
  reachable?: boolean;
}

export interface PromoteInput {
  /** Current value from .mneme/config.json embeddings.provider. */
  current: EmbedderProvider;
  /** Doctor's recommendation. */
  doctor: DoctorVerdict;
  /** Override: even if same, return a receipt. Default false. */
  forceReceipt?: boolean;
  secret?: string;
}

export interface PromoteDecision {
  v: typeof PROTOCOL_VERSION;
  decisionId: string;
  shouldPromote: boolean;
  from: EmbedderProvider;
  to: EmbedderProvider;
  /** ★★ → ★★★★ delta. */
  qualityGain: number;
  reasons: string[];
  decidedAt: string;
  sig: string;
}

function canon(v: unknown): string {
  if (v === null || typeof v !== "object") return JSON.stringify(v);
  if (Array.isArray(v)) return "[" + v.map(canon).join(",") + "]";
  const keys = Object.keys(v as Record<string, unknown>).sort();
  return "{" + keys.map((k) => JSON.stringify(k) + ":" + canon((v as Record<string, unknown>)[k])).join(",") + "}";
}

function defaultSecret(): string {
  return process.env["MNEME_PROMOTE_SECRET"] || `mneme-embedder-auto-promote-v${PROTOCOL_VERSION}`;
}

const QUALITY: Record<EmbedderProvider, number> = {
  auto: 3, ollama: 4, openai: 5, bundled: 3, hash: 2,
};

export function decidePromote(input: PromoteInput): PromoteDecision {
  const reasons: string[] = [];
  const decidedAt = new Date().toISOString();
  const currQ = QUALITY[input.current] ?? 0;
  const recQ = QUALITY[input.doctor.pick] ?? 0;
  let shouldPromote = false;
  let to: EmbedderProvider = input.current;

  if (input.doctor.reachable === false) {
    reasons.push(`doctor reports ${input.doctor.pick} not reachable — refuse to promote`);
  } else if (input.current === input.doctor.pick) {
    reasons.push(`current ${input.current} already matches doctor pick — no change`);
  } else if (recQ <= currQ) {
    reasons.push(`doctor pick ${input.doctor.pick} (★${recQ}) not better than current ${input.current} (★${currQ}) — refuse to downgrade`);
  } else {
    shouldPromote = true;
    to = input.doctor.pick;
    reasons.push(`promote ${input.current} (★${currQ}) → ${input.doctor.pick} (★${recQ}); doctor: ${input.doctor.reason}`);
  }

  const decisionId = "prm-" + createHmac("sha256", "mneme-promote-id")
    .update(`${decidedAt}|${input.current}|${input.doctor.pick}`)
    .digest("hex").slice(0, 14);
  const body: Omit<PromoteDecision, "sig"> = {
    v: PROTOCOL_VERSION,
    decisionId,
    shouldPromote,
    from: input.current,
    to,
    qualityGain: shouldPromote ? recQ - currQ : 0,
    reasons,
    decidedAt,
  };
  const sig = createHmac("sha256", input.secret ?? defaultSecret()).update(canon(body)).digest("hex");
  return { ...body, sig };
}

export function verifyPromoteDecision(d: PromoteDecision, secret?: string): boolean {
  const { sig: claimed, ...body } = d;
  const expected = createHmac("sha256", secret ?? defaultSecret()).update(canon(body)).digest("hex");
  try { return timingSafeEqual(Buffer.from(expected, "hex"), Buffer.from(claimed, "hex")); }
  catch { return false; }
}

export function formatPromoteLine(d: PromoteDecision): string {
  if (!d.shouldPromote) return `🎚 EMBEDDER · keep ${d.from} (${d.reasons[0] ?? ""})`;
  return `🎚 EMBEDDER PROMOTED · ${d.from} → ${d.to} · +${d.qualityGain}★`;
}
