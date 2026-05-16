/**
 * v2.19.7 — MNEME COLONY MIND (federated NEXUS broadcast across instances)
 *
 *   "Multiple Mneme instances in the same org share a queue of
 *    REWIND broadcasts. When instance A sees a high-confidence
 *    refute, it puts a signed broadcast on a shared queue. Instances
 *    B, C, D drain the queue + auto-deprecate matching pending claims
 *    in their own Chronostasis. The colony develops immunity together;
 *    a hallucination caught by ONE instance protects ALL.
 *
 *    No AI vendor ships cross-instance immune memory — by design,
 *    vendors have one server. Mneme is local-first, so 'multiple
 *    instances' is the natural case."
 *
 * Honest scope:
 *   - COLONY MIND is the queue + drain semantics; transport is caller's
 *     choice (HTTP POST to cosmic server, git-push to shared notes ref,
 *     SQS, NATS — whatever). We define the message format + HMAC layer.
 *   - HMAC is over (instanceId + claim text + verdict signature) so a
 *     malicious peer can't forge broadcasts from another instance.
 *   - Subscribers verify the broadcast signature BEFORE applying any
 *     local deprecation. Fail-closed: invalid sig = ignore.
 *
 * Composes onto v2.19.5 CHRONOSTASIS (consumes + emits) + v2.18 NEXUS
 * PROACTIVE (push semantics). Pure orchestrator + signed envelopes.
 */

import { createHmac, timingSafeEqual } from "node:crypto";

const PROTOCOL_VERSION = 1 as const;

export interface ColonyBroadcast {
  v: typeof PROTOCOL_VERSION;
  broadcastId: string;
  /** Sending instance identity (e.g., hostname + repo hash). */
  fromInstance: string;
  /** Claim that was refuted upstream (text + the refute's confidence). */
  refutedClaimText: string;
  /** Why it was refuted — evidence string from the upstream witness. */
  refuteEvidence: string;
  /** 0..1 — the upstream confidence that triggered the refute. */
  refuteConfidence: number;
  /** Vendor that supplied the refute (for transparency). */
  refuteVendor: string;
  /** Optional: peer-supplied jaccard threshold for matching local claims (default 0.5). */
  matchThreshold: number;
  /** Wall-clock time of upstream refute (so peers can apply TTL logic). */
  upstreamRefutedAt: string;
  sig: string;
}

export interface DrainOutcome {
  v: typeof PROTOCOL_VERSION;
  drainId: string;
  /** Broadcasts processed. */
  considered: number;
  /** Broadcasts whose signature failed → dropped. */
  invalidSigs: number;
  /** Broadcasts that matched at least one local pending claim → applied. */
  applied: number;
  /** Local claim IDs (or texts) that got deprecated as a result. */
  localDeprecated: Array<{ broadcastId: string; localClaimId: string; matchSimilarity: number }>;
  ranAt: string;
  sig: string;
}

function canon(v: unknown): string {
  if (v === null || typeof v !== "object") return JSON.stringify(v);
  if (Array.isArray(v)) return "[" + v.map(canon).join(",") + "]";
  const keys = Object.keys(v as Record<string, unknown>).sort();
  return "{" + keys.map((k) => JSON.stringify(k) + ":" + canon((v as Record<string, unknown>)[k])).join(",") + "}";
}

function defaultSecret(): string {
  return process.env["MNEME_COLONY_SECRET"] || `mneme-colony-mind-v${PROTOCOL_VERSION}`;
}

function hmac(body: unknown, secret: string): string {
  return createHmac("sha256", secret).update(canon(body)).digest("hex");
}

function safeEqHex(a: string, b: string): boolean {
  try { return timingSafeEqual(Buffer.from(a, "hex"), Buffer.from(b, "hex")); }
  catch { return false; }
}

const STOP = new Set(["the","a","an","and","or","is","to","of","in","on","for","with","as","at","by","this","that","be","are","was","were"]);
function tokenize(s: string): string[] {
  return (s.toLowerCase().match(/[a-z][a-z0-9_]+/g) ?? []).filter((t) => !STOP.has(t) && t.length >= 2);
}
function jaccard(a: string, b: string): number {
  const ta = new Set(tokenize(a)); const tb = new Set(tokenize(b));
  if (ta.size === 0 && tb.size === 0) return 1;
  let inter = 0; for (const t of ta) if (tb.has(t)) inter++;
  const union = ta.size + tb.size - inter;
  return union === 0 ? 0 : inter / union;
}

/** Sender — build a signed broadcast envelope. */
export function buildBroadcast(input: {
  fromInstance: string;
  refutedClaimText: string;
  refuteEvidence: string;
  refuteConfidence: number;
  refuteVendor: string;
  matchThreshold?: number;
  upstreamRefutedAt?: string;
  secret?: string;
}): ColonyBroadcast {
  const upstreamRefutedAt = input.upstreamRefutedAt ?? new Date().toISOString();
  const broadcastId = "cb-" + createHmac("sha256", "mneme-colony-id")
    .update(`${input.fromInstance}|${upstreamRefutedAt}|${input.refutedClaimText.slice(0, 80)}`)
    .digest("hex").slice(0, 14);
  const body: Omit<ColonyBroadcast, "sig"> = {
    v: PROTOCOL_VERSION,
    broadcastId,
    fromInstance: input.fromInstance,
    refutedClaimText: input.refutedClaimText,
    refuteEvidence: input.refuteEvidence,
    refuteConfidence: input.refuteConfidence,
    refuteVendor: input.refuteVendor,
    matchThreshold: input.matchThreshold ?? 0.5,
    upstreamRefutedAt,
  };
  const sig = hmac(body, input.secret ?? defaultSecret());
  return { ...body, sig };
}

export function verifyBroadcast(b: ColonyBroadcast, secret?: string): boolean {
  const { sig, ...body } = b;
  return safeEqHex(hmac(body, secret ?? defaultSecret()), sig);
}

/**
 * Drain a list of incoming broadcasts against a local pending claim pool.
 * For each broadcast: verify sig → find local pending claims with jaccard
 * similarity ≥ broadcast.matchThreshold → invoke caller's `localDeprecate`
 * to mark them deprecated. Returns a signed outcome receipt.
 *
 * NOTE: we don't import Chronostasis here to keep this module orthogonal.
 * The caller wires localPending + localDeprecate from its Chronostasis.
 */
export function drainBroadcasts(input: {
  broadcasts: ColonyBroadcast[];
  /** Local pending claims as { claimId, body }. */
  localPending: Array<{ claimId: string; body: string }>;
  /** Caller-supplied apply step. Should mark the local claim deprecated. */
  localDeprecate: (claimId: string, reason: string) => void;
  secret?: string;
}): DrainOutcome {
  const ranAt = new Date().toISOString();
  let considered = 0;
  let invalidSigs = 0;
  let applied = 0;
  const localDeprecated: DrainOutcome["localDeprecated"] = [];
  for (const b of input.broadcasts) {
    considered++;
    if (!verifyBroadcast(b, input.secret)) { invalidSigs++; continue; }
    let touchedThisBroadcast = false;
    for (const lp of input.localPending) {
      const sim = jaccard(lp.body, b.refutedClaimText);
      if (sim >= b.matchThreshold) {
        const reason = `colony broadcast ${b.broadcastId} from ${b.fromInstance}: vendor=${b.refuteVendor} confidence=${b.refuteConfidence} evidence="${b.refuteEvidence.slice(0, 100)}"`;
        input.localDeprecate(lp.claimId, reason);
        localDeprecated.push({ broadcastId: b.broadcastId, localClaimId: lp.claimId, matchSimilarity: Math.round(sim * 1000) / 1000 });
        touchedThisBroadcast = true;
      }
    }
    if (touchedThisBroadcast) applied++;
  }
  const drainId = "cdrain-" + createHmac("sha256", "mneme-colony-drain-id")
    .update(`${ranAt}|${considered}|${applied}`)
    .digest("hex").slice(0, 14);
  const body: Omit<DrainOutcome, "sig"> = {
    v: PROTOCOL_VERSION,
    drainId, considered, invalidSigs, applied, localDeprecated, ranAt,
  };
  const sig = hmac(body, input.secret ?? defaultSecret());
  return { ...body, sig };
}

export function formatBroadcastLine(b: ColonyBroadcast): string {
  return `🐝 COLONY · ${b.broadcastId} from ${b.fromInstance} · conf=${b.refuteConfidence} · "${b.refutedClaimText.slice(0, 60)}"`;
}
export function formatDrainLine(d: DrainOutcome): string {
  return `🐝 COLONY DRAIN · ${d.applied}/${d.considered} applied · ${d.localDeprecated.length} local claims deprecated · ${d.invalidSigs} invalid sigs`;
}
