/**
 * v2.82.0 — LIVE TRUTH CDN · federated "this fact just expired" radar (TRUST FABRIC 💎8, on NOTARY).
 *
 * A model's knowledge has a hard cutoff; the world moves faster. Agents subscribe
 * to a fact ("React 19 ships RSC by default"); ANY instance, anywhere, that observes
 * the fact changed emits a SIGNED invalidation; every subscriber updates. A live
 * fact-feed that overrides training cutoff — federated, no central server, each
 * invalidation independently verifiable.
 *
 * Composes NOTARY (each invalidation is a signed receipt) + the nexus pub/sub idea.
 * Pure except observe() (signs). Never throws on verify.
 */

import { createHash } from "node:crypto";
import { issueReceipt, verifyReceipt, type NotaryReceipt, type IssuerKeyPair } from "../notary/index.js";

export interface Subscription {
  fact: string;
  factHash: string;
  knownValue: string;
  subscriber: string;
  /** When this subscriber last updated its value. */
  asOf: number;
}

export interface Invalidation {
  v: 1;
  fact: string;
  factHash: string;
  oldValue: string;
  newValue: string;
  observedBy: string;
  observedAt: number;
}

export function factHash(fact: string): string {
  return createHash("sha256").update(String(fact).toLowerCase().replace(/\s+/g, " ").trim(), "utf8").digest("hex").slice(0, 32);
}

export function subscribe(fact: string, knownValue: string, subscriber: string, asOf = Date.now()): Subscription {
  return { fact: String(fact), factHash: factHash(fact), knownValue: String(knownValue), subscriber: String(subscriber), asOf };
}

/**
 * Observe a fact's current value. If it differs from the known value, emit a SIGNED
 * invalidation receipt that propagates to subscribers; if unchanged, returns null.
 */
export function observe(
  repoRoot: string,
  input: { fact: string; newValue: string; observedBy?: string; observedAt?: number },
  knownValue: string,
  keyPair?: IssuerKeyPair,
): { changed: boolean; invalidation?: Invalidation; receipt?: NotaryReceipt } {
  const newValue = String(input.newValue);
  if (newValue === String(knownValue)) return { changed: false };
  const invalidation: Invalidation = {
    v: 1,
    fact: String(input.fact),
    factHash: factHash(input.fact),
    oldValue: String(knownValue),
    newValue,
    observedBy: String(input.observedBy ?? "unknown"),
    observedAt: typeof input.observedAt === "number" ? input.observedAt : Date.now(),
  };
  const receipt = issueReceipt(repoRoot, { kind: "claim-verdict", subject: `fact-invalidation:${invalidation.factHash}`, payload: invalidation }, keyPair);
  return { changed: true, invalidation, receipt };
}

export function verifyInvalidation(receipt: unknown): { valid: boolean; reason: string; invalidation?: Invalidation } {
  const v = verifyReceipt(receipt);
  if (!v.valid) return { valid: false, reason: v.reason };
  const p = (receipt as NotaryReceipt).payload as Invalidation | undefined;
  if (!p || p.v !== 1 || typeof p.factHash !== "string" || typeof p.newValue !== "string") {
    return { valid: false, reason: "not a fact invalidation" };
  }
  return { valid: true, reason: "ok", invalidation: p };
}

/**
 * Apply a (verified) invalidation receipt to a subscription. Updates the known value
 * only if: the receipt verifies, the fact matches, and the observation is newer than
 * the subscriber's current asOf. Returns the (possibly updated) subscription + whether
 * it changed. A forged invalidation is ignored.
 */
export function applyInvalidation(sub: Subscription, receipt: unknown): { sub: Subscription; updated: boolean; reason: string } {
  const v = verifyInvalidation(receipt);
  if (!v.valid) return { sub, updated: false, reason: v.reason };
  const inv = v.invalidation!;
  if (inv.factHash !== sub.factHash) return { sub, updated: false, reason: "different fact" };
  if (inv.observedAt <= sub.asOf) return { sub, updated: false, reason: "stale observation (older than current)" };
  if (inv.newValue === sub.knownValue) return { sub, updated: false, reason: "already up to date" };
  return { sub: { ...sub, knownValue: inv.newValue, asOf: inv.observedAt }, updated: true, reason: "updated" };
}
