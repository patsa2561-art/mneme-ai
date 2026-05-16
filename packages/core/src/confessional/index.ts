/**
 * v2.19.0 — MNEME CONFESSIONAL (the adult supervision every AI vendor is missing)
 *
 *   "Before a vendor's diff lands, route the same task to its peers, score
 *    them all in the ARENA, and gate the primary vendor by divergence
 *    from peer consensus. If the primary stands alone, the merge is
 *    flagged or blocked — with a signed, recomputable receipt the user
 *    can show their team or their auditor."
 *
 * Vendor-agnostic by design: every Mneme-supported vendor (claude /
 * chatgpt / gemini / cursor / copilot / codex / llama / mistral / qwen /
 * deepseek / grok / perplexity / other) plays the same game. The primary
 * is whoever the user is currently working with; the peers are the
 * reference panel. The verdict is signed and includes the underlying
 * ARENA verdict for full transparency.
 *
 * Honest scope:
 *   - CONFESSIONAL is a pure orchestrator. It does NOT call AI vendors —
 *     the caller fans out + supplies peer responses (cached or live).
 *   - The verdict is RECOMMENDATION-grade: `block` should NEVER be
 *     overridden by software; only humans should override.
 *   - Divergence is measured against the AURELIAN-style composite score,
 *     not raw text similarity. Two AIs can phrase the same correct
 *     answer differently — CONFESSIONAL is about correctness, not style.
 *
 * Composes onto v2.18 ARENA. Pure additive layer.
 */

import { createHmac, timingSafeEqual } from "node:crypto";
import { judgeMatch, type Vendor, type TaskClass, type ExpectedFact, type VendorResponse, type MatchVerdict } from "../arena/index.js";

const PROTOCOL_VERSION = 1 as const;

export type ConfessionalVerdict = "approve" | "flag" | "block";

export interface AuditInput {
  /** The vendor whose diff is being audited. */
  primary: VendorResponse;
  /** Reference panel — at least one other vendor's response on the same prompt. */
  peers: VendorResponse[];
  /** Task class for ARENA scoring + leaderboard segmentation. */
  taskClass: TaskClass;
  /** Verifiable expected facts; ARENA grades each response against these. */
  expectedFacts: ExpectedFact[];
  /** Divergence threshold (0..1). primary < consensus - threshold → flag/block. Default 0.20. */
  divergenceThreshold?: number;
  /** Block hard if primary is at or below this composite (default 0.40). */
  hardBlockBelow?: number;
  /** ISO timestamp; defaults to now. */
  ts?: string;
  secret?: string;
}

export interface ConfessionalReceipt {
  v: typeof PROTOCOL_VERSION;
  receiptId: string;
  ts: string;
  primaryVendor: Vendor;
  peerVendors: Vendor[];
  verdict: ConfessionalVerdict;
  primaryComposite: number;
  consensusComposite: number;
  divergence: number;
  reasons: string[];
  /** Underlying ARENA verdict for transparency. */
  arena: MatchVerdict;
  /** One-line human summary. */
  headline: string;
  sig: string;
}

function canon(v: unknown): string {
  if (v === null || typeof v !== "object") return JSON.stringify(v);
  if (Array.isArray(v)) return "[" + v.map(canon).join(",") + "]";
  const keys = Object.keys(v as Record<string, unknown>).sort();
  return "{" + keys.map((k) => JSON.stringify(k) + ":" + canon((v as Record<string, unknown>)[k])).join(",") + "}";
}

function defaultSecret(): string {
  return process.env["MNEME_CONFESSIONAL_SECRET"] || `mneme-confessional-v${PROTOCOL_VERSION}`;
}

export function auditDiff(input: AuditInput): ConfessionalReceipt {
  if (input.peers.length === 0) {
    throw new Error("CONFESSIONAL requires at least one peer to grade against; pass cached responses if you don't want to call live vendors.");
  }
  const divergenceThreshold = input.divergenceThreshold ?? 0.20;
  const hardBlockBelow = input.hardBlockBelow ?? 0.40;
  const ts = input.ts ?? new Date().toISOString();

  // Reuse ARENA judgement — primary + peers all scored on same expectedFacts.
  const arena = judgeMatch({
    prompt: `[confessional audit · ${input.taskClass}]`,
    taskClass: input.taskClass,
    expectedFacts: input.expectedFacts,
    responses: [input.primary, ...input.peers],
    ts,
  });

  const primaryScored = arena.scored.find((s) => s.vendor === input.primary.vendor);
  if (!primaryScored) {
    // Defensive — should be impossible since we included primary in responses.
    throw new Error("CONFESSIONAL invariant violation: primary not in scored set");
  }
  const peerScored = arena.scored.filter((s) => s.vendor !== input.primary.vendor);
  const consensusComposite = peerScored.length === 0
    ? primaryScored.composite
    : peerScored.reduce((a, s) => a + s.composite, 0) / peerScored.length;

  // Divergence: how much primary trails peer consensus. Positive = primary worse.
  const divergence = Math.round((consensusComposite - primaryScored.composite) * 1000) / 1000;

  const reasons: string[] = [];
  let verdict: ConfessionalVerdict = "approve";

  if (primaryScored.composite <= hardBlockBelow) {
    verdict = "block";
    reasons.push(`primary composite ${primaryScored.composite} ≤ hard-block ${hardBlockBelow}`);
  } else if (divergence > divergenceThreshold * 2) {
    // Primary trails peer consensus by 2× threshold → block.
    verdict = "block";
    reasons.push(`primary trails peer consensus by ${divergence} (>2× threshold ${divergenceThreshold})`);
  } else if (divergence > divergenceThreshold) {
    verdict = "flag";
    reasons.push(`primary trails peer consensus by ${divergence} (> threshold ${divergenceThreshold})`);
  } else {
    reasons.push(`primary within consensus band (divergence ${divergence} ≤ ${divergenceThreshold})`);
  }

  // Surface per-fact disagreement: any fact primary failed that ALL peers passed.
  if (verdict !== "approve") {
    const peerFactRefs = peerScored.map((p) => p.perFact);
    primaryScored.perFact.forEach((f, i) => {
      if (!f.passed && peerFactRefs.every((pf) => pf[i] && pf[i]!.passed)) {
        reasons.push(`Peer-confirmed miss: "${f.description}" (${f.reason})`);
      }
    });
  }

  const peerVendors = peerScored.map((p) => p.vendor);
  const receiptId = "cfn-" + createHmac("sha256", "mneme-confessional-id")
    .update(`${input.primary.vendor}|${ts}|${arena.matchId}`)
    .digest("hex").slice(0, 14);
  const headline = verdict === "approve"
    ? `🛐 CONFESSIONAL · ${input.primary.vendor} APPROVED · within consensus (div ${divergence})`
    : verdict === "flag"
      ? `🛐 CONFESSIONAL · ${input.primary.vendor} FLAGGED · ${peerVendors.join("+")} disagree (div ${divergence})`
      : `🛐 CONFESSIONAL · ${input.primary.vendor} BLOCKED · severe divergence ${divergence}`;
  const body: Omit<ConfessionalReceipt, "sig"> = {
    v: PROTOCOL_VERSION,
    receiptId,
    ts,
    primaryVendor: input.primary.vendor,
    peerVendors,
    verdict,
    primaryComposite: primaryScored.composite,
    consensusComposite: Math.round(consensusComposite * 1000) / 1000,
    divergence,
    reasons,
    arena,
    headline,
  };
  const sig = createHmac("sha256", input.secret ?? defaultSecret()).update(canon(body)).digest("hex");
  return { ...body, sig };
}

export function verifyReceipt(r: ConfessionalReceipt, secret?: string): { ok: boolean; reason?: string } {
  const { sig: claimed, ...body } = r;
  const expected = createHmac("sha256", secret ?? defaultSecret()).update(canon(body)).digest("hex");
  try {
    if (!timingSafeEqual(Buffer.from(expected, "hex"), Buffer.from(claimed, "hex"))) {
      return { ok: false, reason: "receipt sig mismatch" };
    }
  } catch { return { ok: false, reason: "receipt sig malformed" }; }
  return { ok: true };
}

export function formatConfessionalLine(r: ConfessionalReceipt): string {
  return r.headline;
}
