/**
 * v2.16.0 — MNEME OBELISK (Federated Trust Graph)
 *
 *   "BOUNTY today is local — one repo, one ledger. OBELISK promotes
 *    it to a federated trust standard: any signed BOUNTY card from any
 *    repo (or any vendor's own self-published score) can be aggregated
 *    into the global AI Trust Graph."
 *
 * Phase 1 (v2.16) primitives:
 *
 *   1. obeliskCard — wrap a local BOUNTY VendorScorecard with publisher
 *      identity + ed25519-like signature (using HMAC for now; ed25519
 *      requires a webcrypto path we'll add in v2.17)
 *   2. aggregateGraph — given N cards from N publishers, weight + fuse
 *      into a per-vendor consensus falseRate with confidence based on
 *      total sample count and publisher diversity
 *   3. verifyCard — independent verification of a single card
 *
 * Privacy: publisher identity is whatever string they pick. No PII
 * required. Could be a GitHub handle, a pseudonym, or org name.
 *
 * Trust model: each card stands on its own signature. Aggregation
 * weights samples by Wilson lower bound so a single publisher with 5
 * verdicts doesn't outvote 10 publishers with 1000 verdicts.
 */

import { createHmac, timingSafeEqual } from "node:crypto";

const PROTOCOL_VERSION = 1 as const;

export interface VendorScorecard {
  vendor: string;
  totalVerdicts: number;
  falseCount: number;
  trueCount: number;
  partialCount: number;
  inconclusiveCount: number;
  falseRate: number;
  falseRateLB: number;
  generatedAt: string;
}

export interface ObeliskCard {
  v: typeof PROTOCOL_VERSION;
  publisher: string;
  publisherUrl?: string; // optional homepage / repo
  publishedAt: string;
  vendorScore: VendorScorecard;
  sig: string;
}

function canon(v: unknown): string {
  if (v === null || typeof v !== "object") return JSON.stringify(v);
  if (Array.isArray(v)) return "[" + v.map(canon).join(",") + "]";
  const keys = Object.keys(v as Record<string, unknown>).sort();
  return "{" + keys.map((k) => JSON.stringify(k) + ":" + canon((v as Record<string, unknown>)[k])).join(",") + "}";
}

function defaultSecret(): string {
  return process.env["MNEME_OBELISK_SECRET"] || `mneme-obelisk-v${PROTOCOL_VERSION}`;
}

export function buildCard(input: { publisher: string; publisherUrl?: string; vendorScore: VendorScorecard; secret?: string }): ObeliskCard {
  const publishedAt = new Date().toISOString();
  const body: Omit<ObeliskCard, "sig"> = {
    v: PROTOCOL_VERSION,
    publisher: input.publisher,
    ...(input.publisherUrl ? { publisherUrl: input.publisherUrl } : {}),
    publishedAt,
    vendorScore: input.vendorScore,
  };
  const sig = createHmac("sha256", input.secret ?? defaultSecret()).update(canon(body)).digest("hex");
  return { ...body, sig };
}

export function verifyCard(card: ObeliskCard, secret?: string): { ok: boolean; reason?: string } {
  const { sig: claimed, ...body } = card;
  const expected = createHmac("sha256", secret ?? defaultSecret()).update(canon(body)).digest("hex");
  try {
    const ok = timingSafeEqual(Buffer.from(expected, "hex"), Buffer.from(claimed, "hex"));
    return ok ? { ok: true } : { ok: false, reason: "card sig mismatch -- forged or wrong publisher key" };
  } catch { return { ok: false, reason: "card sig length invalid" }; }
}

export interface AggregatedRow {
  vendor: string;
  totalVerdicts: number;
  totalFalse: number;
  consensusFalseRate: number;
  /** Wilson LB on aggregated counts. */
  consensusFalseRateLB: number;
  publisherCount: number;
  publishers: string[];
  /** Higher = stronger signal. Logit-based using totalVerdicts. */
  confidenceScore: number;
}

function wilsonLB(positive: number, total: number, z = 1.96): number {
  if (total === 0) return 0;
  const p = positive / total;
  const denom = 1 + (z * z) / total;
  const center = p + (z * z) / (2 * total);
  const margin = z * Math.sqrt((p * (1 - p) + (z * z) / (4 * total)) / total);
  return Math.max(0, Math.min(1, (center - margin) / denom));
}

export function aggregateGraph(cards: ObeliskCard[], secret?: string): {
  rows: AggregatedRow[];
  unverified: ObeliskCard[];
} {
  const verified: ObeliskCard[] = [];
  const unverified: ObeliskCard[] = [];
  for (const c of cards) {
    if (verifyCard(c, secret).ok) verified.push(c);
    else unverified.push(c);
  }

  const byVendor = new Map<string, { totalVerdicts: number; totalFalse: number; publishers: Set<string> }>();
  for (const c of verified) {
    const v = c.vendorScore;
    const e = byVendor.get(v.vendor) ?? { totalVerdicts: 0, totalFalse: 0, publishers: new Set() };
    e.totalVerdicts += v.totalVerdicts;
    e.totalFalse += v.falseCount;
    e.publishers.add(c.publisher);
    byVendor.set(v.vendor, e);
  }

  const rows: AggregatedRow[] = Array.from(byVendor.entries()).map(([vendor, e]) => {
    const consensusFalseRate = e.totalVerdicts === 0 ? 0 : e.totalFalse / e.totalVerdicts;
    const consensusFalseRateLB = wilsonLB(e.totalFalse, e.totalVerdicts);
    // Confidence: log(totalVerdicts) capped + bonus for >=3 distinct publishers
    const sampleConf = Math.min(1, Math.log10(e.totalVerdicts + 1) / 3);
    const diversityBonus = e.publishers.size >= 3 ? 0.2 : e.publishers.size >= 2 ? 0.1 : 0;
    return {
      vendor,
      totalVerdicts: e.totalVerdicts,
      totalFalse: e.totalFalse,
      consensusFalseRate: Math.round(consensusFalseRate * 10000) / 10000,
      consensusFalseRateLB: Math.round(consensusFalseRateLB * 10000) / 10000,
      publisherCount: e.publishers.size,
      publishers: Array.from(e.publishers).sort(),
      confidenceScore: Math.round((sampleConf + diversityBonus) * 1000) / 1000,
    };
  }).sort((a, b) => b.consensusFalseRateLB - a.consensusFalseRateLB);

  return { rows, unverified };
}

export function formatObeliskLine(rows: AggregatedRow[]): string {
  if (rows.length === 0) return "OBELISK · empty graph";
  const worst = rows[0]!;
  return `OBELISK · ${rows.length} vendors · worst=${worst.vendor} (lb=${worst.consensusFalseRateLB.toFixed(3)} across ${worst.publisherCount} publishers)`;
}
