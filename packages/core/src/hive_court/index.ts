/**
 * v2.19.30 — MNEME HIVE COURT (Commonwealth pillar #2)
 *
 *   "Codex บอก: 'refactor approach A'. Claude Code บอก: 'refactor approach B'.
 *    แทนที่จะ block หรือสุ่ม — Mneme ตัดสิน + ออก WRIT (HMAC-signed verdict).
 *    Agents เคารพอัตโนมัติ. User เห็น notification เฉพาะ close-call."
 *                                          — user mandate, 2026-05-17
 *
 *   Diagnosis: when 2+ AI agents disagree mid-loop (e.g., refactor approach
 *   A vs B), there's no NEUTRAL adjudicator. Vendor SDKs have no concept of
 *   inter-agent dispute. Multi-agent workflows deadlock or random-pick — both
 *   waste user attention.
 *
 *   HIVE COURT composes the existing arbitration primitives Mneme already
 *   ships and produces a single HMAC-signed WRIT that all agents respect:
 *
 *     1. SCORE   (v2.18 ARENA-style)  — fact-coverage per agent
 *     2. AUDIT   (v2.19 CONFESSIONAL) — peer-audit by 3rd-party AIs
 *     3. VOTE    (v2.19 TRINITY)      — consensus + lazy tiebreaker
 *     4. VERIFY  (v2.19.15 TRUTH FORENSIC) — refute false claims
 *     5. WRIT    — HMAC-signed verdict + writ tier (clear / close / disputed)
 *
 *   Composes onto:
 *     - v2.18 ARENA (scoring pattern)
 *     - v2.19 CONFESSIONAL (peer audit pattern)
 *     - v2.19 TRINITY (voting pattern)
 *     - v2.19.15 TRUTH FORENSIC (claim verification)
 *     - v2.19.10 PROOF-CARRYING (WRIT chains into proof)
 *     - v2.19.16 FEDERATED TRUTH (cross-instance WRIT replication)
 *
 * Honest scope:
 *   - PURE FUNCTION adjudicator. Caller supplies the per-agent claims +
 *     score / audit / vote inputs (which come from REAL ARENA/CONFESSIONAL/
 *     TRINITY runs); we orchestrate.
 *   - HMAC-signed Writ; tampered writs refuse to be respected.
 *   - 24/7 safe: 0 agents → INSUFFICIENT_PARTIES verdict; 1 agent → that
 *     agent wins by default + caveat; never crashes.
 */

import { createHmac, timingSafeEqual } from "node:crypto";

const PROTOCOL_VERSION = 1 as const;
const DEFAULT_CLOSE_CALL_MARGIN = 0.1; // <10% lead = CLOSE_CALL tier
const DEFAULT_DISPUTED_MARGIN = 0.03;  // <3% lead = DISPUTED tier (user attention required)

export type WritTier = "CLEAR" | "CLOSE_CALL" | "DISPUTED" | "INSUFFICIENT_PARTIES" | "SINGLE_PARTY_DEFAULT";

export interface AgentClaim {
  /** Stable agent id (e.g., "claude-code-1", "codex-2"). */
  agentId: string;
  /** Vendor at time of claim ("claude" / "openai" / "google" / etc.). */
  vendor: string;
  /** What the agent proposed (free text; the WRIT decides which wins). */
  claim: string;
  /** Per-source scores (0..1); higher is better. */
  factCoverageScore: number;     // from ARENA
  peerAuditScore: number;        // from CONFESSIONAL
  trinityVoteShare: number;      // from TRINITY (0..1 share of votes)
  truthForensicVerdict: "ACCEPTED" | "REJECTED" | "UNKNOWN";
}

export interface CourtInput {
  /** What the dispute is about ("how to refactor auth.ts"). */
  topic: string;
  /** Competing agent claims (>= 0). */
  claims: AgentClaim[];
  /** Margin thresholds (caller can tighten for higher-stakes disputes). */
  closeCallMargin?: number;
  disputedMargin?: number;
  /** Caller secret for HMAC. */
  secret?: string;
}

export interface CompositeScore {
  agentId: string;
  vendor: string;
  /** Weighted sum of all 4 inputs; rejected by TRUTH FORENSIC = 0. */
  finalScore: number;
  /** Per-source breakdown for the audit trail. */
  breakdown: {
    factCoverageScore: number;
    peerAuditScore: number;
    trinityVoteShare: number;
    truthVerdict: "ACCEPTED" | "REJECTED" | "UNKNOWN";
  };
}

export interface Writ {
  v: typeof PROTOCOL_VERSION;
  topic: string;
  tier: WritTier;
  /** Winning agent's id (or empty if no winner). */
  winnerAgentId: string;
  /** Winning claim text (or empty if no winner). */
  winningClaim: string;
  /** All composite scores for transparency. */
  composites: CompositeScore[];
  /** Margin between winner + runner-up (0 if no runner-up). */
  margin: number;
  /** Caveats list (e.g., "USER_ATTENTION_REQUIRED" for DISPUTED). */
  caveats: string[];
  /** Issued at ts. */
  issuedAtMs: number;
  /** HMAC sig — agents verify before respecting. */
  sig: string;
}

function canon(v: unknown): string {
  if (v === null || typeof v !== "object") return JSON.stringify(v);
  if (Array.isArray(v)) return "[" + v.map(canon).join(",") + "]";
  const keys = Object.keys(v as Record<string, unknown>).sort();
  return "{" + keys.map((k) => JSON.stringify(k) + ":" + canon((v as Record<string, unknown>)[k])).join(",") + "}";
}

function defaultSecret(): string {
  return process.env["MNEME_HIVE_COURT_SECRET"] || `mneme-hive-court-v${PROTOCOL_VERSION}`;
}

function hmacHex(body: unknown, secret: string): string {
  return createHmac("sha256", secret).update(canon(body)).digest("hex");
}

function safeEqHex(a: string, b: string): boolean {
  try { return timingSafeEqual(Buffer.from(a, "hex"), Buffer.from(b, "hex")); }
  catch { return false; }
}

/**
 * Composite weight: ARENA 35% + CONFESSIONAL 25% + TRINITY 25% + TRUTH 15%.
 * If TRUTH FORENSIC REJECTED → final score forced to 0 (no winner can be a liar).
 */
function compositeFor(c: AgentClaim): CompositeScore {
  const truthMultiplier = c.truthForensicVerdict === "REJECTED" ? 0 : 1;
  const finalScore = truthMultiplier * (
    0.35 * c.factCoverageScore +
    0.25 * c.peerAuditScore +
    0.25 * c.trinityVoteShare +
    0.15 * (c.truthForensicVerdict === "ACCEPTED" ? 1 : 0.5)
  );
  return {
    agentId: c.agentId,
    vendor: c.vendor,
    finalScore,
    breakdown: {
      factCoverageScore: c.factCoverageScore,
      peerAuditScore: c.peerAuditScore,
      trinityVoteShare: c.trinityVoteShare,
      truthVerdict: c.truthForensicVerdict,
    },
  };
}

/**
 * Adjudicate the dispute. Pure function; HMAC-signed WRIT.
 *
 * Tier ladder (priority order):
 *   1. 0 claims        → INSUFFICIENT_PARTIES
 *   2. 1 claim         → SINGLE_PARTY_DEFAULT (winner by default)
 *   3. margin >= closeCallMargin (default 0.10) → CLEAR
 *   4. margin >= disputedMargin (default 0.03)  → CLOSE_CALL
 *   5. else                                     → DISPUTED (USER_ATTENTION)
 */
export function adjudicate(input: CourtInput): Writ {
  const sec = input.secret ?? defaultSecret();
  const closeMargin = input.closeCallMargin ?? DEFAULT_CLOSE_CALL_MARGIN;
  const disputedMargin = input.disputedMargin ?? DEFAULT_DISPUTED_MARGIN;
  const issuedAtMs = Date.now();

  if (!input.claims || input.claims.length === 0) {
    const body: Omit<Writ, "sig"> = {
      v: PROTOCOL_VERSION,
      topic: input.topic,
      tier: "INSUFFICIENT_PARTIES",
      winnerAgentId: "",
      winningClaim: "",
      composites: [],
      margin: 0,
      caveats: ["NO_CLAIMS"],
      issuedAtMs,
    };
    return { ...body, sig: hmacHex(body, sec) };
  }

  const composites = input.claims.map(compositeFor);
  composites.sort((a, b) => b.finalScore - a.finalScore || a.agentId.localeCompare(b.agentId));

  if (composites.length === 1) {
    const winner = composites[0]!;
    const body: Omit<Writ, "sig"> = {
      v: PROTOCOL_VERSION,
      topic: input.topic,
      tier: "SINGLE_PARTY_DEFAULT",
      winnerAgentId: winner.agentId,
      winningClaim: input.claims[0]!.claim,
      composites,
      margin: 0,
      caveats: ["SINGLE_PARTY", "NO_DISPUTE"],
      issuedAtMs,
    };
    return { ...body, sig: hmacHex(body, sec) };
  }

  const winner = composites[0]!;
  const runnerUp = composites[1]!;
  const margin = winner.finalScore - runnerUp.finalScore;
  const caveats: string[] = [];
  let tier: WritTier;
  if (margin >= closeMargin) {
    tier = "CLEAR";
  } else if (margin >= disputedMargin) {
    tier = "CLOSE_CALL";
    caveats.push("CLOSE_CALL");
  } else {
    tier = "DISPUTED";
    caveats.push("DISPUTED", "USER_ATTENTION_REQUIRED");
  }
  if (winner.breakdown.truthVerdict === "REJECTED") {
    caveats.push("WINNER_TRUTH_REJECTED");
  }
  // Find the winning claim text by id
  const winningClaimEntry = input.claims.find((c) => c.agentId === winner.agentId);

  const body: Omit<Writ, "sig"> = {
    v: PROTOCOL_VERSION,
    topic: input.topic,
    tier,
    winnerAgentId: winner.agentId,
    winningClaim: winningClaimEntry?.claim ?? "",
    composites,
    margin,
    caveats,
    issuedAtMs,
  };
  return { ...body, sig: hmacHex(body, sec) };
}

/** Verify a WRIT before respecting it. Tampered writs return false. */
export function verifyWrit(w: Writ, secret?: string): boolean {
  const { sig, ...body } = w;
  return safeEqHex(hmacHex(body, secret ?? defaultSecret()), sig);
}

/** Returns true iff a respecting agent should defer to this WRIT now. */
export function shouldDeferToWrit(w: Writ, secret?: string): boolean {
  if (!verifyWrit(w, secret)) return false;
  return w.tier === "CLEAR" || w.tier === "CLOSE_CALL" || w.tier === "SINGLE_PARTY_DEFAULT";
}

export interface CourtStats {
  totalClaims: number;
  topComposite: number;
  margin: number;
  tier: WritTier;
  userAttentionRequired: boolean;
}

export function computeStats(w: Writ): CourtStats {
  return {
    totalClaims: w.composites.length,
    topComposite: w.composites[0]?.finalScore ?? 0,
    margin: w.margin,
    tier: w.tier,
    userAttentionRequired: w.caveats.includes("USER_ATTENTION_REQUIRED"),
  };
}

export function formatWritLine(w: Writ): string {
  const tag = w.tier === "CLEAR" ? "⚖" : w.tier === "CLOSE_CALL" ? "⚠" : w.tier === "DISPUTED" ? "🔥" : w.tier === "SINGLE_PARTY_DEFAULT" ? "·" : "—";
  return `${tag} WRIT · ${w.tier} · winner=${w.winnerAgentId || "(none)"} · margin=${w.margin.toFixed(3)}`;
}

export const HIVE_COURT_TUNABLES = Object.freeze({
  DEFAULT_CLOSE_CALL_MARGIN,
  DEFAULT_DISPUTED_MARGIN,
});
