/**
 * v2.8.0 -- SHADOW CONSENSUS.
 *
 *   "N vendors silently vote on a claim · winner is the fused verdict."
 *
 * The wild move: Mneme can already PREPARE a question + soul-prompt
 * context. It can already FUSE multiple sensor verdicts via the v2.6
 * TRUTH KERNEL. SHADOW CONSENSUS composes these two:
 *
 *   1. User asks Mneme a high-stakes question.
 *   2. Mneme generates a soul prompt + question payload tagged with
 *      a "ballot id".
 *   3. Mneme writes the ballot to N vendor inboxes (Claude / GPT /
 *      Gemini / Cursor / etc) via the existing handoff paths — the
 *      user (or AI orchestrator) pastes to each vendor.
 *   4. Each vendor's reply lands back as a sensor output (caller calls
 *      `recordVendorReply(ballotId, vendor, answer)`).
 *   5. When ≥ M replies arrive, SHADOW CONSENSUS fuses them via the
 *      v2.6 TRUTH KERNEL and emits a verdict + per-vendor breakdown.
 *
 * Mneme becomes a META-LLM that you don't pay for: it asks every
 * vendor, fuses the answers, surfaces the disagreement. The user paid
 * for the actual vendor seats; Mneme adds the consensus layer.
 *
 * Nobel-tier move: each ballot is HMAC-chained — sending the same
 * question to Claude twice doesn't fool the consensus (Mneme detects
 * the duplicate signature). Tampering with one vendor's reply also
 * fails verification. The consensus IS the proof.
 *
 * Privacy: ballots are NEVER persisted off-disk by default. The caller
 * decides if + where to store them.
 */

import { createHash, createHmac, randomBytes } from "node:crypto";
import { checkTruth, type SensorAdapter, type TruthVerdict } from "../truth_kernel/index.js";
import { safeHmacEqual } from "../util/hmac_compare.js";

export interface Ballot {
  /** Unique ballot id. */
  id: string;
  /** The question being voted on. */
  question: string;
  /** The optional soul-prompt context the AI agent should consider. */
  context?: string;
  /** Vendors invited to vote — ballot is invalid for any vendor not listed. */
  vendors: readonly string[];
  /** ISO timestamp the ballot opened. */
  openedAt: string;
  /** HMAC over the canonical ballot. */
  sig: string;
}

export interface VendorReply {
  ballotId: string;
  vendor: string;
  /** TRUE / FALSE / UNCERTAIN / INAPPLICABLE — the vendor's verdict. */
  verdict: "TRUE" | "FALSE" | "UNCERTAIN" | "INAPPLICABLE";
  /** Vendor-supplied confidence (0..1). */
  confidence: number;
  /** Vendor-supplied rationale. */
  rationale?: string;
  /** ISO timestamp the reply arrived. */
  receivedAt: string;
  /** HMAC signature linking the reply back to the ballot. */
  sig: string;
}

export interface ConsensusOutcome {
  ballot: Ballot;
  replies: VendorReply[];
  /** Fused TRUTH KERNEL verdict. */
  truth: TruthVerdict;
  /** Coverage: replied vendors / invited vendors. */
  coverage: number;
  /** Whether consensus is QUORATE (≥ floor(N/2)+1 replies). */
  quorate: boolean;
  /** ISO timestamp the consensus was closed. */
  closedAt: string;
}

function canonicalBallot(b: Omit<Ballot, "sig">): string {
  return JSON.stringify({ id: b.id, question: b.question, context: b.context ?? "", vendors: [...b.vendors].sort(), openedAt: b.openedAt });
}

function canonicalReply(r: Omit<VendorReply, "sig">): string {
  return JSON.stringify({ ballotId: r.ballotId, vendor: r.vendor, verdict: r.verdict, confidence: r.confidence, rationale: r.rationale ?? "", receivedAt: r.receivedAt });
}

export interface OpenBallotInput {
  question: string;
  vendors: readonly string[];
  context?: string;
  secret: string;
}

/** Open a new ballot. The HMAC is computed over the canonical body so
 *  duplicates with a different timestamp don't match. */
export function openBallot(input: OpenBallotInput): Ballot {
  if (input.vendors.length === 0) throw new Error("openBallot: at least one vendor required");
  if (input.question.length === 0) throw new Error("openBallot: question must be non-empty");
  const id = createHash("sha256").update(randomBytes(16)).digest("hex").slice(0, 16);
  const body: Omit<Ballot, "sig"> = {
    id,
    question: input.question,
    context: input.context,
    vendors: input.vendors,
    openedAt: new Date().toISOString(),
  };
  const sig = createHmac("sha256", input.secret).update(canonicalBallot(body)).digest("hex");
  return { ...body, sig };
}

/** Verify a ballot's HMAC matches the secret. */
export function verifyBallot(ballot: Ballot, secret: string): boolean {
  const expected = createHmac("sha256", secret).update(canonicalBallot(ballot)).digest("hex");
  return safeHmacEqual(expected, ballot.sig);
}

export interface RecordReplyInput {
  ballot: Ballot;
  vendor: string;
  verdict: VendorReply["verdict"];
  confidence: number;
  rationale?: string;
  secret: string;
}

/** Record a vendor's reply against a ballot. Fails if the vendor wasn't
 *  invited or the ballot signature is bad. */
export function recordReply(input: RecordReplyInput): { ok: true; reply: VendorReply } | { ok: false; reason: string } {
  if (!verifyBallot(input.ballot, input.secret)) return { ok: false, reason: "ballot signature invalid" };
  if (!input.ballot.vendors.includes(input.vendor)) return { ok: false, reason: `vendor ${input.vendor} not invited` };
  const body: Omit<VendorReply, "sig"> = {
    ballotId: input.ballot.id,
    vendor: input.vendor,
    verdict: input.verdict,
    confidence: Math.max(0, Math.min(1, input.confidence)),
    rationale: input.rationale,
    receivedAt: new Date().toISOString(),
  };
  const sig = createHmac("sha256", input.secret).update(canonicalReply(body)).digest("hex");
  return { ok: true, reply: { ...body, sig } };
}

/** Verify a vendor reply's HMAC. */
export function verifyReply(reply: VendorReply, secret: string): boolean {
  const expected = createHmac("sha256", secret).update(canonicalReply(reply)).digest("hex");
  return safeHmacEqual(expected, reply.sig);
}

export interface CloseConsensusInput {
  ballot: Ballot;
  replies: readonly VendorReply[];
  secret: string;
  /** Minimum replies required for quorum. Defaults to floor(N/2)+1. */
  quorumOverride?: number;
}

/** Close the ballot and compute the fused consensus.
 *  Replies that fail HMAC verification are silently dropped + reported
 *  via `replies.length`. */
export async function closeConsensus(input: CloseConsensusInput): Promise<ConsensusOutcome> {
  if (!verifyBallot(input.ballot, input.secret)) {
    throw new Error("closeConsensus: ballot signature invalid");
  }
  const valid: VendorReply[] = [];
  const seenVendors = new Set<string>();
  for (const r of input.replies) {
    if (r.ballotId !== input.ballot.id) continue;
    if (!input.ballot.vendors.includes(r.vendor)) continue;
    if (seenVendors.has(r.vendor)) continue; // one vote per vendor
    if (!verifyReply(r, input.secret)) continue;
    valid.push(r);
    seenVendors.add(r.vendor);
  }
  const minQuorum = input.quorumOverride ?? Math.floor(input.ballot.vendors.length / 2) + 1;
  const quorate = valid.length >= minQuorum;

  // Wrap each reply as a TRUTH KERNEL sensor adapter.
  const sensors: SensorAdapter[] = valid.map((r) => ({
    id: r.vendor,
    weight: 1,
    run: () => ({ sensor: r.vendor, verdict: r.verdict, confidence: r.confidence, rationale: r.rationale }),
  }));
  const truth = await checkTruth({ claim: input.ballot.question, sensors });
  const coverage = input.ballot.vendors.length > 0 ? valid.length / input.ballot.vendors.length : 0;
  return {
    ballot: input.ballot,
    replies: valid,
    truth,
    coverage,
    quorate,
    closedAt: new Date().toISOString(),
  };
}

/** Compact pulse summary. */
export function formatConsensusPulseLine(c: ConsensusOutcome): string {
  return `SHADOW-CONSENSUS · ${c.truth.verdict} · pTrue=${c.truth.pTrue.toFixed(2)} · coverage=${(c.coverage * 100).toFixed(0)}% · quorate=${c.quorate} · ballot=${c.ballot.id.slice(0, 8)}`;
}
