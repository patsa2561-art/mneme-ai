/**
 * v2.54.0 — NIMBUS: federated trust mesh primitive.
 *
 * Latin: cloud / aura. Per-org leaderboards + cross-org reputation
 * transfer, gated by CONSENT FABRIC.
 *
 * Design (network-effects-first):
 *   Each Mneme installation can publish a signed LEADERBOARD CARD
 *   summarising the org's TRUSTed primitives:
 *     - COLOSSEUM top-5 vendors + ELO scores
 *     - HONEST MIRROR per-vendor false-rate windowed lower bound
 *     - NEMESIS dispute count
 *     - Org-level consent + scope (which artifacts shareable)
 *
 *   Consumers subscribe to other orgs' cards + compute weighted
 *   cross-org reputation. The trust mesh is a federation, not a
 *   central server.
 *
 *   v2.54 ships the LOCAL pub/sub primitive (no network). Network
 *   transport is a future extension via the existing bridge.
 *
 * Privacy: only AGGREGATED scores cross the boundary. Per-commit
 * fingerprints + raw activity never leave the org.
 *
 * Composes: createHmac + the existing leaderboard / mirror primitives.
 * Pure deterministic + defensive; never throws.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync, appendFileSync } from "node:fs";
import { join } from "node:path";
import { createHmac } from "node:crypto";

const NIMBUS_DIR = ".mneme/nemesis/nimbus";
const PUBLISHED_FILE = "published_cards.jsonl";
const SUBSCRIPTIONS_FILE = "subscriptions.jsonl";
const KEY_ENV = "MNEME_NIMBUS_KEY";
const DEFAULT_KEY = "mneme-nimbus-v1";

function keyOf(): string {
  return process.env[KEY_ENV] ?? DEFAULT_KEY;
}

export interface NimbusVendorEntry {
  vendor: string;
  elo?: number;
  falseRateLB?: number;
  /** Sample size — readers can weight by N. */
  n?: number;
}

export interface NimbusCard {
  /** Anonymized org identifier (HMAC of git-remote or user-set tag). */
  orgFingerprint: string;
  at: string;
  /** Top vendors by ELO (from COLOSSEUM). */
  topByElo: NimbusVendorEntry[];
  /** Vendors by lowest false-rate LB (from HONEST MIRROR / BOUNTY). */
  topByHonesty: NimbusVendorEntry[];
  /** Consent fields — what may consumers do with this card. */
  consent: {
    sharedScopes: string[];
    expiresAt: string;
    /** Revocation URI (if any). */
    revocationRef?: string;
  };
  /** Optional sticky note for human readers. */
  note?: string;
  /** Card-level HMAC. */
  hmac: string;
}

function hmacOf(body: object): string {
  return createHmac("sha256", keyOf()).update(JSON.stringify(body)).digest("hex");
}

export interface PublishInput {
  repoRoot: string;
  orgTag: string;
  topByElo?: NimbusVendorEntry[];
  topByHonesty?: NimbusVendorEntry[];
  sharedScopes?: string[];
  expiresAtIso?: string;
  revocationRef?: string;
  note?: string;
  persist?: boolean;
}

export interface PublishResult {
  ok: boolean;
  card?: NimbusCard;
  path?: string;
  reason: string;
}

/**
 * Publish a NIMBUS card to the local pub-store. Pure: card is just a
 * signed JSON envelope; transport to other orgs is the caller's job
 * (HTTP / git / file copy / etc).
 */
export function publishCard(input: PublishInput): PublishResult {
  try {
    if (!input || !input.orgTag) return { ok: false, reason: "orgTag required" };
    const orgFingerprint = createHmac("sha256", keyOf()).update("org:").update(input.orgTag).digest("hex").slice(0, 16);
    const at = new Date().toISOString();
    const expiresAt = input.expiresAtIso ?? new Date(Date.now() + 90 * 86_400_000).toISOString();
    const cardBody = {
      orgFingerprint,
      at,
      topByElo: input.topByElo ?? [],
      topByHonesty: input.topByHonesty ?? [],
      consent: {
        sharedScopes: input.sharedScopes ?? ["leaderboard:read"],
        expiresAt,
        revocationRef: input.revocationRef,
      },
      note: input.note,
    };
    const card: NimbusCard = { ...cardBody, hmac: hmacOf(cardBody) };
    if (input.persist !== false) {
      try {
        const dir = join(input.repoRoot, NIMBUS_DIR);
        if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
        const p = join(dir, PUBLISHED_FILE);
        appendFileSync(p, JSON.stringify(card) + "\n");
        return { ok: true, card, path: p, reason: `card published to ${p}` };
      } catch (e) {
        return { ok: true, card, reason: `card built but persist failed: ${(e as Error).message}` };
      }
    }
    return { ok: true, card, reason: "card built (no persist)" };
  } catch (e) {
    return { ok: false, reason: `publish failed: ${(e as Error).message}` };
  }
}

/** Verify a NIMBUS card's HMAC + expiry. Pure. */
export function verifyCard(card: NimbusCard): { ok: boolean; expired: boolean; reason: string } {
  if (!card || typeof card.hmac !== "string") return { ok: false, expired: false, reason: "missing card or hmac" };
  const { hmac, ...body } = card;
  const expected = hmacOf(body);
  if (expected !== hmac) return { ok: false, expired: false, reason: "hmac mismatch" };
  const expired = Date.parse(card.consent.expiresAt) < Date.now();
  if (expired) return { ok: false, expired: true, reason: "card expired" };
  return { ok: true, expired: false, reason: "card verified + within expiry" };
}

// ════════════════════════════════════════════════════════════════════
//  Subscription side — consume foreign cards into local reputation
// ════════════════════════════════════════════════════════════════════

export interface SubscriptionEntry {
  at: string;
  orgFingerprint: string;
  card: NimbusCard;
  /** Caller's local trust weight for this org (0..1). */
  trustWeight: number;
}

export interface SubscribeInput {
  repoRoot: string;
  card: NimbusCard;
  trustWeight?: number;
  persist?: boolean;
}

export function subscribeCard(input: SubscribeInput): { ok: boolean; entry?: SubscriptionEntry; reason: string } {
  try {
    if (!input || !input.card) return { ok: false, reason: "card required" };
    const v = verifyCard(input.card);
    if (!v.ok) return { ok: false, reason: `card refused: ${v.reason}` };
    const trustWeight = typeof input.trustWeight === "number" ? Math.max(0, Math.min(1, input.trustWeight)) : 0.5;
    const entry: SubscriptionEntry = {
      at: new Date().toISOString(),
      orgFingerprint: input.card.orgFingerprint,
      card: input.card,
      trustWeight,
    };
    if (input.persist !== false) {
      try {
        const dir = join(input.repoRoot, NIMBUS_DIR);
        if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
        appendFileSync(join(dir, SUBSCRIPTIONS_FILE), JSON.stringify(entry) + "\n");
      } catch { /* */ }
    }
    return { ok: true, entry, reason: "card subscribed + verified" };
  } catch (e) {
    return { ok: false, reason: `subscribe failed: ${(e as Error).message}` };
  }
}

/**
 * Compute cross-org weighted reputation: per vendor, weighted average
 * of (ELO + 1/(1+falseRateLB)) across all subscribed cards.
 * Returns a ranked list with confidence.
 */
export interface CrossOrgReputation {
  vendor: string;
  weightedScore: number;
  contributingOrgs: number;
  /** Sum of trustWeights — proxy for confidence. */
  totalWeight: number;
}

export function computeCrossOrgReputation(repoRoot: string): CrossOrgReputation[] {
  const p = join(repoRoot, NIMBUS_DIR, SUBSCRIPTIONS_FILE);
  if (!existsSync(p)) return [];
  const entries: SubscriptionEntry[] = [];
  for (const line of readFileSync(p, "utf8").split("\n")) {
    if (!line.trim()) continue;
    try { entries.push(JSON.parse(line) as SubscriptionEntry); } catch { /* */ }
  }
  // Aggregate
  const acc: Map<string, { weightedScoreSum: number; orgs: Set<string>; totalWeight: number }> = new Map();
  for (const e of entries) {
    const w = e.trustWeight;
    const seen: Set<string> = new Set();
    for (const v of e.card.topByElo) {
      const score = (v.elo ?? 1200) / 2000; // normalize to ~0..1
      const cur = acc.get(v.vendor) ?? { weightedScoreSum: 0, orgs: new Set(), totalWeight: 0 };
      cur.weightedScoreSum += score * w;
      cur.totalWeight += w;
      cur.orgs.add(e.orgFingerprint);
      acc.set(v.vendor, cur);
      seen.add(v.vendor);
    }
    for (const v of e.card.topByHonesty) {
      if (seen.has(v.vendor)) continue;
      const score = 1 / (1 + (v.falseRateLB ?? 0.5));
      const cur = acc.get(v.vendor) ?? { weightedScoreSum: 0, orgs: new Set(), totalWeight: 0 };
      cur.weightedScoreSum += score * w;
      cur.totalWeight += w;
      cur.orgs.add(e.orgFingerprint);
      acc.set(v.vendor, cur);
    }
  }
  const out: CrossOrgReputation[] = [];
  for (const [vendor, a] of acc) {
    out.push({
      vendor,
      weightedScore: a.totalWeight > 0 ? +(a.weightedScoreSum / a.totalWeight).toFixed(3) : 0,
      contributingOrgs: a.orgs.size,
      totalWeight: +a.totalWeight.toFixed(3),
    });
  }
  return out.sort((a, b) => b.weightedScore - a.weightedScore);
}

export function listPublished(repoRoot: string): NimbusCard[] {
  const p = join(repoRoot, NIMBUS_DIR, PUBLISHED_FILE);
  if (!existsSync(p)) return [];
  const out: NimbusCard[] = [];
  for (const line of readFileSync(p, "utf8").split("\n")) {
    if (!line.trim()) continue;
    try { out.push(JSON.parse(line) as NimbusCard); } catch { /* */ }
  }
  return out;
}

export function listSubscriptions(repoRoot: string): SubscriptionEntry[] {
  const p = join(repoRoot, NIMBUS_DIR, SUBSCRIPTIONS_FILE);
  if (!existsSync(p)) return [];
  const out: SubscriptionEntry[] = [];
  for (const line of readFileSync(p, "utf8").split("\n")) {
    if (!line.trim()) continue;
    try { out.push(JSON.parse(line) as SubscriptionEntry); } catch { /* */ }
  }
  return out;
}

void writeFileSync; // referenced for future use (revoke API)
