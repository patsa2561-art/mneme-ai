/**
 * v2.80.0 — FLIGHT RECORDER · the AI black box (diamond 💎3, built on the v2.79 NOTARY spine).
 *
 * When an agent controls a PC (Grok Computer), pays via x402, or merges code,
 * an incident needs a court-admissible record: WHAT it did, WHY (reasoning),
 * and what it CLAIMED vs what was TRUE (truth-delta) — in causal order, and
 * impossible to forge after the fact.
 *
 * Design — every frame IS a NOTARY receipt:
 *   - Each recorded frame is signed (Ed25519) + chained (prev → receiptId).
 *   - The whole CDR therefore inherits NOTARY's three guarantees at once:
 *       tamper-evidence (any edit breaks the signature),
 *       attribution     (who recorded it — the issuer key),
 *       portability      (a third party verifies OFFLINE with the public key).
 *   - `seal()` issues ONE final receipt over the chain head — the single
 *     artifact you hand an auditor / insurer / court.
 *   - `replay()` walks the chain in causal order and pinpoints the first
 *     truth-delta divergence (the "incident moment").
 *
 * No new crypto here — it composes the NOTARY primitive. Pure logic except
 * record/seal (sign) and the jsonl read/append. Defensive: never throws on
 * read; malformed lines are skipped.
 */

import { existsSync, readFileSync, appendFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { issueReceipt, verifyReceipt, verifyChain, type NotaryReceipt, type IssuerKeyPair } from "../notary/index.js";

export type FrameKind = "action" | "decision" | "claim" | "tool-call" | "payment" | "observation";
export type TruthDelta = "MATCH" | "CONTRADICT" | "UNVERIFIED";

/** The data a caller records. The recorder wraps it in a signed receipt. */
export interface FramePayload {
  seq: number;
  agent: string;
  kind: FrameKind;
  /** What the agent did (free text / structured summary). */
  action: string;
  /** Why — reasoning trace (optional). */
  reasoning?: string;
  /** A checkable claim the agent asserted (optional). */
  claim?: string;
  /** What was actually observed/true (optional). */
  observedReality?: string;
  /** Claim-vs-reality verdict. Caller may supply (e.g. from `mneme verify`);
   *  else computed heuristically from claim + observedReality. */
  truthDelta?: TruthDelta;
}

export interface RecordInput {
  agent: string;
  kind?: FrameKind;
  action: string;
  reasoning?: string;
  claim?: string;
  observedReality?: string;
  /** Explicit verdict from a real verifier; overrides the heuristic. */
  truthDelta?: TruthDelta;
}

const CDR_REL = ".mneme/flight_recorder/cdr.jsonl";

function cdrPath(repoRoot: string): string {
  return join(repoRoot, CDR_REL);
}

/**
 * Heuristic claim-vs-reality classifier. HONEST SCOPE: this is a deterministic
 * string/number heuristic, NOT semantic truth — feed a real verifier's verdict
 * via RecordInput.truthDelta when you have one. Returns UNVERIFIED when it
 * cannot decide rather than guessing.
 */
export function classifyTruthDelta(claim?: string, observed?: string): TruthDelta {
  if (!claim || !observed) return "UNVERIFIED";
  const norm = (s: string) => s.toLowerCase().replace(/\s+/g, " ").trim();
  const c = norm(claim);
  const o = norm(observed);
  if (c.length === 0 || o.length === 0) return "UNVERIFIED";
  if (c === o) return "MATCH";
  // Explicit refutation language in the observation.
  if (/\b(false|incorrect|refuted|wrong|not true|does not|doesn't|did not|didn't|no such|missing|failed)\b/.test(o)) {
    return "CONTRADICT";
  }
  // Numeric disagreement: if both carry numbers and none of the claim's numbers
  // appear in the observation, treat as contradiction.
  const nums = (s: string): string[] => (s.match(/-?\d+(?:\.\d+)?/g) ?? []);
  const cn = nums(c), on = nums(o);
  if (cn.length > 0 && on.length > 0) {
    const overlap = cn.some((x) => on.includes(x));
    if (!overlap) return "CONTRADICT";
  }
  // Observation entails the claim (substring) → match.
  if (o.includes(c) || c.includes(o)) return "MATCH";
  return "UNVERIFIED";
}

/** Read the chain of receipts (one per jsonl line). Skips malformed lines. */
export function readCdr(repoRoot: string): NotaryReceipt[] {
  const p = cdrPath(repoRoot);
  if (!existsSync(p)) return [];
  const out: NotaryReceipt[] = [];
  for (const line of readFileSync(p, "utf8").split("\n")) {
    const t = line.trim();
    if (!t) continue;
    try { out.push(JSON.parse(t) as NotaryReceipt); } catch { /* skip malformed */ }
  }
  return out;
}

export interface RecordedFrame {
  seq: number;
  receiptId: string;
  truthDelta: TruthDelta;
  receipt: NotaryReceipt;
}

/**
 * Record one frame: compute truth-delta, chain onto the prior receiptId, sign,
 * append. Returns the recorded frame. The returned receipt verifies offline.
 */
export function record(repoRoot: string, input: RecordInput, keyPair?: IssuerKeyPair): RecordedFrame {
  const chain = readCdr(repoRoot);
  const seq = chain.length;
  const prev = chain.length > 0 ? chain[chain.length - 1]!.receiptId : null;
  const truthDelta = input.truthDelta ?? classifyTruthDelta(input.claim, input.observedReality);
  const payload: FramePayload = {
    seq,
    agent: input.agent,
    kind: input.kind ?? "action",
    action: input.action,
    ...(input.reasoning !== undefined ? { reasoning: input.reasoning } : {}),
    ...(input.claim !== undefined ? { claim: input.claim } : {}),
    ...(input.observedReality !== undefined ? { observedReality: input.observedReality } : {}),
    truthDelta,
  };
  const receipt = issueReceipt(repoRoot, {
    kind: "reasoning-trace",
    subject: `frame:${seq}:${input.action.slice(0, 64)}`,
    payload,
    prev,
  }, keyPair);
  try {
    const dir = join(repoRoot, ".mneme", "flight_recorder");
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
    appendFileSync(cdrPath(repoRoot), JSON.stringify(receipt) + "\n", "utf8");
  } catch { /* best-effort persistence; the returned receipt is still valid */ }
  return { seq, receiptId: receipt.receiptId, truthDelta, receipt };
}

export interface CdrVerifyResult {
  valid: boolean;
  reason: string;
  frames: number;
  brokenAt?: number;
}

/** Verify the whole black box: every frame signs + chains (offline, public-key). */
export function verifyCdr(repoRoot: string, opts: { sameIssuer?: boolean } = {}): CdrVerifyResult {
  const chain = readCdr(repoRoot);
  if (chain.length === 0) return { valid: true, reason: "empty recorder", frames: 0 };
  const v = verifyChain(chain, { sameIssuer: opts.sameIssuer });
  return { valid: v.valid, reason: v.reason, frames: chain.length, brokenAt: v.brokenAt };
}

export interface ReplayResult {
  frames: number;
  /** Causal-order summary lines (human readable). */
  narrative: string[];
  /** seq of the first CONTRADICT frame, or null. The "incident moment". */
  incidentSeq: number | null;
  counts: { match: number; contradict: number; unverified: number };
  /** Verified offline before replaying? */
  chainValid: boolean;
}

/** Walk the chain in causal order, surface the first truth-delta divergence. */
export function replay(repoRoot: string): ReplayResult {
  const chain = readCdr(repoRoot);
  const chainValid = chain.length === 0 ? true : verifyChain(chain).valid;
  const narrative: string[] = [];
  const counts = { match: 0, contradict: 0, unverified: 0 };
  let incidentSeq: number | null = null;
  for (const r of chain) {
    const p = (r.payload ?? {}) as Partial<FramePayload>;
    const td = (p.truthDelta ?? "UNVERIFIED") as TruthDelta;
    if (td === "MATCH") counts.match++;
    else if (td === "CONTRADICT") counts.contradict++;
    else counts.unverified++;
    if (td === "CONTRADICT" && incidentSeq === null) incidentSeq = p.seq ?? null;
    const mark = td === "CONTRADICT" ? "🔴" : td === "MATCH" ? "🟢" : "⚪";
    narrative.push(`${mark} #${p.seq ?? "?"} [${p.kind ?? "?"}] ${p.agent ?? "?"}: ${String(p.action ?? "").slice(0, 80)}${p.claim ? ` — claim: "${String(p.claim).slice(0, 60)}" vs reality (${td})` : ""}`);
  }
  return { frames: chain.length, narrative, incidentSeq, counts, chainValid };
}

export interface FlightSeal {
  v: 1;
  frames: number;
  head: string | null;
  contradictions: number;
  incidentSeq: number | null;
  /** The single court-admissible artifact: a signed receipt over the chain head. */
  receipt: NotaryReceipt;
}

/**
 * Seal the black box: issue ONE NOTARY receipt over the chain head + summary.
 * Since each frame chains onto the prior receiptId, the head commits the entire
 * sequence — verifying the seal + the head's chain proves the whole flight.
 */
export function seal(repoRoot: string, keyPair?: IssuerKeyPair): FlightSeal {
  const chain = readCdr(repoRoot);
  const r = replay(repoRoot);
  const head = chain.length > 0 ? chain[chain.length - 1]!.receiptId : null;
  const receipt = issueReceipt(repoRoot, {
    kind: "generic",
    subject: `flight-seal:${head ?? "empty"}`,
    payload: { head, frames: chain.length, contradictions: r.counts.contradict, incidentSeq: r.incidentSeq },
  }, keyPair);
  return { v: 1, frames: chain.length, head, contradictions: r.counts.contradict, incidentSeq: r.incidentSeq, receipt };
}

/** Verify a seal offline (signature) AND that it commits the expected head. */
export function verifySeal(seal: FlightSeal, expectedHead: string | null): { valid: boolean; reason: string } {
  const v = verifyReceipt(seal.receipt);
  if (!v.valid) return { valid: false, reason: `seal signature: ${v.reason}` };
  const committedHead = (seal.receipt.payload as { head?: string | null } | undefined)?.head ?? null;
  if (committedHead !== expectedHead) return { valid: false, reason: "seal does not commit the expected chain head" };
  return { valid: true, reason: "ok" };
}
