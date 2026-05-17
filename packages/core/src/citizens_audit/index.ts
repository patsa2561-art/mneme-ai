/**
 * v2.19.37 — MNEME CITIZEN'S AUDIT (Gap #6 — ride the regulator wave)
 *
 *   Quarterly aggregated public binder of Mneme protocol receipts from
 *   users worldwide. Vendor pressure mechanism stronger than any single
 *   regulator: "Vendor X led hallucination rate in Q3 per Mneme
 *   Citizens' Audit" → reputational damage → vendors fix issues faster.
 *
 *   Wild moat: vendors block regulators (lawyers, slow) but cannot
 *   block press citing aggregated public stats from millions of
 *   Mneme users. Anonymization + content-addressing make it impossible
 *   for any single vendor to deny.
 *
 *   Composes onto:
 *     - v2.19.37 RECEIPT PROTOCOL (input format)
 *     - v2.19.34 APOSTILLE (Mneme reference implementation)
 *     - v2.19.34 ETERNITY (binder pinned across jurisdictions)
 *
 * Honest scope:
 *   - PURE FUNCTION anonymise + aggregate + render. No I/O.
 *   - Anonymisation strips: prompt/response hashes, file paths, notes,
 *     impl strings. Keeps: vendor, model, ts (bucketed to day),
 *     tokens, cost, outcome, vaccines, controls.
 *   - Deterministic: same input → same output.
 *   - 50+ tests; 1000+ random fuzz iterations.
 */

import { createHash } from "node:crypto";
import type { ProtocolReceipt } from "../mneme_receipt_protocol/index.js";

const PROTOCOL_VERSION = 1 as const;

export interface AnonymizedReceipt {
  v: typeof PROTOCOL_VERSION;
  vendor: string;
  modelVersion: string;
  /** ms since epoch, bucketed to start-of-day UTC for k-anonymity. */
  dayBucketMs: number;
  tokensIn: number;
  tokensOut: number;
  costUsdMicros: number;
  vaccineCount: number;
  outcomeClass: string;
  /** Frameworks the original receipt mapped to (control values dropped). */
  frameworks: string[];
  /** sha256 anonymized id (deterministic from anonymized fields). */
  anonymizedId: string;
}

function canon(v: unknown): string {
  if (v === null || typeof v !== "object") return JSON.stringify(v);
  if (Array.isArray(v)) return "[" + v.map(canon).join(",") + "]";
  const keys = Object.keys(v as Record<string, unknown>).sort();
  return "{" + keys.map((k) => JSON.stringify(k) + ":" + canon((v as Record<string, unknown>)[k])).join(",") + "}";
}

function sha256Hex(s: string): string {
  return createHash("sha256").update(s, "utf8").digest("hex");
}

const DAY_MS = 24 * 60 * 60 * 1000;

function dayBucket(ms: number): number {
  if (!Number.isFinite(ms) || ms < 0) return 0;
  return Math.floor(ms / DAY_MS) * DAY_MS;
}

/**
 * Anonymise a receipt for public aggregation. Strips:
 *   - promptSha256 + responseSha256 (hash content reveals user)
 *   - filesTouched + toolsCalled (repo structure leaks)
 *   - note + prevContentHash + contentHash + ext (impl-specific PII)
 *   - implementation (could fingerprint instance)
 * Keeps for stats:
 *   - vendor, modelVersion, dayBucketMs, tokens, cost, vaccineCount,
 *     outcomeClass, frameworks
 */
export function anonymizeReceipt(r: ProtocolReceipt): AnonymizedReceipt {
  const frameworks = r.controls
    ? Object.keys(r.controls).filter((k) => Array.isArray(r.controls![k]) && r.controls![k]!.length > 0).sort()
    : [];
  const body = {
    v: PROTOCOL_VERSION,
    vendor: r.vendor,
    modelVersion: r.modelVersion,
    dayBucketMs: dayBucket(r.tsMs),
    tokensIn: r.tokensIn,
    tokensOut: r.tokensOut,
    costUsdMicros: r.costUsdMicros,
    vaccineCount: Array.isArray(r.vaccinesTriggered) ? r.vaccinesTriggered.length : 0,
    outcomeClass: r.outcomeClass,
    frameworks,
  };
  return { ...body, anonymizedId: sha256Hex(canon(body)).slice(0, 16) };
}

// ─── AGGREGATE ──────────────────────────────────────────────────────

export interface VendorRow {
  vendor: string;
  modelVersions: string[];
  totalReceipts: number;
  totalTokensIn: number;
  totalTokensOut: number;
  totalCostUsdMicros: number;
  /** Outcome breakdown. */
  outcomeBreakdown: Record<string, number>;
  /** Rate (0..1) of receipts that triggered ≥1 vaccine. */
  vaccineHitRate: number;
  /** Rate (0..1) of receipts blocked by guard/apoptosis/truth (the bad outcomes). */
  blockedRate: number;
  /** Distinct frameworks the vendor touched. */
  frameworkCount: number;
}

export interface AuditAggregate {
  v: typeof PROTOCOL_VERSION;
  quarter: string;
  totalReceipts: number;
  uniqueVendors: number;
  uniqueModels: number;
  windowStartMs: number;
  windowEndMs: number;
  /** Per-vendor row, sorted by totalReceipts desc then alpha. */
  vendorRows: VendorRow[];
  /** Vendors ranked WORST-to-BEST by vaccine hit rate (high = bad). */
  hallucinationLeaderboard: Array<{ vendor: string; vaccineHitRate: number; receipts: number }>;
  /** Vendors ranked by blockedRate. */
  blockedLeaderboard: Array<{ vendor: string; blockedRate: number; receipts: number }>;
}

/** Quarter id from a representative ms (e.g. "2026-Q2"). */
export function quarterIdFromMs(ms: number): string {
  const d = new Date(ms);
  const year = d.getUTCFullYear();
  const q = Math.floor(d.getUTCMonth() / 3) + 1;
  return `${year}-Q${q}`;
}

const BLOCKED_OUTCOMES = new Set(["blocked_by_guard", "blocked_by_apoptosis", "blocked_by_truth"]);

export function aggregateCitizens(input: {
  receipts: AnonymizedReceipt[];
  quarter?: string;
  windowStartMs?: number;
  windowEndMs?: number;
}): AuditAggregate {
  const recs = Array.isArray(input.receipts) ? input.receipts.filter((r) => r && typeof r === "object" && r.v === PROTOCOL_VERSION) : [];
  // Window filter (if supplied)
  const filtered = (input.windowStartMs !== undefined && input.windowEndMs !== undefined)
    ? recs.filter((r) => r.dayBucketMs >= input.windowStartMs! && r.dayBucketMs <= input.windowEndMs!)
    : recs;

  const byVendor = new Map<string, AnonymizedReceipt[]>();
  for (const r of filtered) {
    const arr = byVendor.get(r.vendor) ?? [];
    arr.push(r);
    byVendor.set(r.vendor, arr);
  }

  const vendorRows: VendorRow[] = [];
  for (const [vendor, group] of byVendor) {
    const models = Array.from(new Set(group.map((g) => g.modelVersion))).sort();
    let tokensIn = 0, tokensOut = 0, cost = 0;
    const outcomes: Record<string, number> = {};
    let vaccineHits = 0;
    let blocked = 0;
    const frameworks = new Set<string>();
    for (const g of group) {
      tokensIn += g.tokensIn;
      tokensOut += g.tokensOut;
      cost += g.costUsdMicros;
      outcomes[g.outcomeClass] = (outcomes[g.outcomeClass] ?? 0) + 1;
      if (g.vaccineCount > 0) vaccineHits++;
      if (BLOCKED_OUTCOMES.has(g.outcomeClass)) blocked++;
      for (const fw of g.frameworks) frameworks.add(fw);
    }
    const n = group.length;
    vendorRows.push({
      vendor, modelVersions: models, totalReceipts: n,
      totalTokensIn: tokensIn, totalTokensOut: tokensOut, totalCostUsdMicros: cost,
      outcomeBreakdown: outcomes,
      vaccineHitRate: n > 0 ? Math.round((vaccineHits / n) * 10000) / 10000 : 0,
      blockedRate: n > 0 ? Math.round((blocked / n) * 10000) / 10000 : 0,
      frameworkCount: frameworks.size,
    });
  }
  vendorRows.sort((a, b) => b.totalReceipts - a.totalReceipts || a.vendor.localeCompare(b.vendor));

  const hallucinationLeaderboard = vendorRows
    .map((v) => ({ vendor: v.vendor, vaccineHitRate: v.vaccineHitRate, receipts: v.totalReceipts }))
    .filter((v) => v.receipts >= 10) // statistical floor — at least 10 receipts to rank
    .sort((a, b) => b.vaccineHitRate - a.vaccineHitRate || a.vendor.localeCompare(b.vendor));

  const blockedLeaderboard = vendorRows
    .map((v) => ({ vendor: v.vendor, blockedRate: v.blockedRate, receipts: v.totalReceipts }))
    .filter((v) => v.receipts >= 10)
    .sort((a, b) => b.blockedRate - a.blockedRate || a.vendor.localeCompare(b.vendor));

  const uniqueModels = new Set<string>();
  for (const v of vendorRows) for (const m of v.modelVersions) uniqueModels.add(`${v.vendor}::${m}`);

  const tsList = filtered.map((r) => r.dayBucketMs);
  return {
    v: PROTOCOL_VERSION,
    quarter: input.quarter ?? (tsList.length > 0 ? quarterIdFromMs(tsList[0]!) : "unknown"),
    totalReceipts: filtered.length,
    uniqueVendors: vendorRows.length,
    uniqueModels: uniqueModels.size,
    windowStartMs: input.windowStartMs ?? (tsList.length > 0 ? Math.min(...tsList) : 0),
    windowEndMs: input.windowEndMs ?? (tsList.length > 0 ? Math.max(...tsList) : 0),
    vendorRows,
    hallucinationLeaderboard,
    blockedLeaderboard,
  };
}

// ─── RENDER QUARTERLY REPORT ───────────────────────────────────────

export function renderQuarterlyReport(agg: AuditAggregate, organizationName: string = "Mneme Citizens"): string {
  const lines: string[] = [];
  lines.push(`# 🪞 State of AI Accountability — ${agg.quarter}`);
  lines.push(``);
  lines.push(`Prepared by **${organizationName}** · Mneme Protocol Receipt v1.0 · Public CC-BY-4.0`);
  lines.push(``);
  lines.push(`**Total receipts**: ${agg.totalReceipts.toLocaleString()}`);
  lines.push(`**Unique vendors**: ${agg.uniqueVendors}`);
  lines.push(`**Unique models**: ${agg.uniqueModels}`);
  if (agg.windowStartMs > 0) {
    lines.push(`**Window**: ${new Date(agg.windowStartMs).toISOString().slice(0, 10)} → ${new Date(agg.windowEndMs).toISOString().slice(0, 10)}`);
  }
  lines.push(``);

  if (agg.hallucinationLeaderboard.length > 0) {
    lines.push(`## 🦠 Hallucination Leaderboard (vaccine hit rate; ≥10 receipts to qualify)`);
    lines.push(``);
    lines.push(`| Rank | Vendor | Hit Rate | Receipts |`);
    lines.push(`|---|---|---|---|`);
    agg.hallucinationLeaderboard.forEach((v, i) => {
      lines.push(`| ${i + 1} | ${v.vendor} | ${(v.vaccineHitRate * 100).toFixed(2)}% | ${v.receipts.toLocaleString()} |`);
    });
    lines.push(``);
  }

  if (agg.blockedLeaderboard.length > 0) {
    lines.push(`## 🛡 Blocked-Outcome Leaderboard (rejected by Mneme guards)`);
    lines.push(``);
    lines.push(`| Rank | Vendor | Blocked Rate | Receipts |`);
    lines.push(`|---|---|---|---|`);
    agg.blockedLeaderboard.forEach((v, i) => {
      lines.push(`| ${i + 1} | ${v.vendor} | ${(v.blockedRate * 100).toFixed(2)}% | ${v.receipts.toLocaleString()} |`);
    });
    lines.push(``);
  }

  if (agg.vendorRows.length > 0) {
    lines.push(`## 🏦 Vendor Volume Breakdown`);
    lines.push(``);
    lines.push(`| Vendor | Receipts | Models | Tokens In | Tokens Out | Cost (USD) | Frameworks |`);
    lines.push(`|---|---|---|---|---|---|---|`);
    for (const v of agg.vendorRows) {
      lines.push(`| ${v.vendor} | ${v.totalReceipts.toLocaleString()} | ${v.modelVersions.length} | ${v.totalTokensIn.toLocaleString()} | ${v.totalTokensOut.toLocaleString()} | $${(v.totalCostUsdMicros / 1_000_000).toFixed(2)} | ${v.frameworkCount} |`);
    }
    lines.push(``);
  }

  lines.push(`---`);
  lines.push(`**Methodology**: aggregated from Mneme Receipt Protocol v1.0 receipts. All PII stripped at source via \`anonymizeReceipt\`. Vendor rankings require ≥10 receipts to qualify for statistical floor. Source: \`@mneme-ai/core::citizensAudit\`.`);

  return lines.join("\n");
}

export interface CitizensAuditStats {
  totalReceipts: number;
  uniqueVendors: number;
  vendorsWithEnoughData: number;
  topHallucinatingVendor: string | null;
}

export function computeAuditStats(agg: AuditAggregate): CitizensAuditStats {
  return {
    totalReceipts: agg.totalReceipts,
    uniqueVendors: agg.uniqueVendors,
    vendorsWithEnoughData: agg.hallucinationLeaderboard.length,
    topHallucinatingVendor: agg.hallucinationLeaderboard[0]?.vendor ?? null,
  };
}

export function formatAuditLine(s: CitizensAuditStats): string {
  return `🪞 CITIZENS · ${s.totalReceipts} receipts · ${s.uniqueVendors} vendors · top-hallucinator: ${s.topHallucinatingVendor ?? "n/a"}`;
}

export const CITIZENS_AUDIT_TUNABLES = Object.freeze({
  PROTOCOL_VERSION,
  STATISTICAL_FLOOR_RECEIPTS: 10,
  DAY_MS,
});
