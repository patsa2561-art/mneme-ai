/**
 * v2.19.13 — MNEME NEGATIVE-EVIDENCE FIREWALL (Hallucination Kill)
 *
 *   "Every AI safety tool asks the wrong question: 'what supports this
 *    claim?'. Mneme inverts: 'what REFUTES it, and did we search and NOT
 *    find?'. A claim is ACCEPTED only when every generated refutation
 *    candidate has been explicitly searched across all relevant sources
 *    and produced NOTHING. If even one refutation finds evidence, the
 *    claim is REJECTED. If any refutation search is inconclusive, the
 *    verdict is UNKNOWN (not ACCEPTED).
 *
 *    No vendor ships this because the UX cost is brutal — slower answers,
 *    more 'I don't know' verdicts — and every AI tool is optimised for
 *    confident-and-fast. Negative-evidence primacy contradicts every AI
 *    vendor's incentive. Only an independent tool (Mneme) can enforce it.
 *
 *    Companion layer: HALLUCINATION TOKEN-TAX. Each vendor starts with
 *    1000 credits/month; every REJECTED claim costs 10 credits; exhaustion
 *    triggers a routing fallback signal to the caller ('vendor exhausted
 *    hallucination budget; route to fallback'). Vendors get skin in the
 *    game."
 *
 * Architecture (vendor-agnostic orchestrator):
 *   - `gateClaim({claim, refutations, searchResults})` — caller supplies
 *     refutations (from inverse-LLM or manual) + search outcomes (from
 *     caller's git/file/test/web searcher); we compute the verdict.
 *   - HMAC-signed certificate per ACCEPTED claim — content-addressed +
 *     tamper-detectable.
 *   - TokenTaxLedger: HMAC-chained credits/charges; routing decision is
 *     pure function of remaining budget.
 *
 * Honest scope:
 *   - We do NOT generate refutations ourselves; INVERSE-LLM (v2.19.3) or
 *     any caller-supplied generator does. Composes onto v2.19.3.
 *   - We do NOT execute searches; caller does git/file/test/web. We grade
 *     the outcomes.
 *   - Token-tax is advisory: we signal route-to-fallback; the caller (the
 *     MCP client) decides whether to honour it.
 */

import { createHmac, timingSafeEqual } from "node:crypto";

const PROTOCOL_VERSION = 1 as const;
const DEFAULT_MONTHLY_BUDGET = 1000;
const DEFAULT_REJECT_COST = 10;

export type SearchVerdict = "found" | "not_found" | "inconclusive";

export interface SearchResult {
  refutation: string;
  source: "git" | "file" | "test" | "web" | "other";
  verdict: SearchVerdict;
  /** Evidence string when verdict='found'; reason when 'inconclusive'. */
  evidence?: string;
}

export type GateVerdict = "ACCEPTED" | "REJECTED" | "UNKNOWN";

export interface NegativeEvidenceCertificate {
  v: typeof PROTOCOL_VERSION;
  claim: string;
  refutationCount: number;
  searchCount: number;
  ts: number;
  hmac: string;
}

export interface GateResult {
  verdict: GateVerdict;
  /** Set when verdict='REJECTED' — the refutation + evidence that defeated the claim. */
  rejectedBy?: SearchResult;
  /** Set when verdict='UNKNOWN' — list of inconclusive searches. */
  pendingSearches?: SearchResult[];
  /** Set when verdict='ACCEPTED' — HMAC-signed proof of completion. */
  certificate?: NegativeEvidenceCertificate;
  refutationCount: number;
  searchCount: number;
}

function canon(v: unknown): string {
  if (v === null || typeof v !== "object") return JSON.stringify(v);
  if (Array.isArray(v)) return "[" + v.map(canon).join(",") + "]";
  const keys = Object.keys(v as Record<string, unknown>).sort();
  return "{" + keys.map((k) => JSON.stringify(k) + ":" + canon((v as Record<string, unknown>)[k])).join(",") + "}";
}

function defaultSecret(): string {
  return process.env["MNEME_NEGEV_SECRET"] || `mneme-negative-evidence-v${PROTOCOL_VERSION}`;
}

function signCert(body: Omit<NegativeEvidenceCertificate, "hmac">, secret: string): string {
  return createHmac("sha256", secret).update(canon(body)).digest("hex");
}

function safeEqHex(a: string, b: string): boolean {
  try { return timingSafeEqual(Buffer.from(a, "hex"), Buffer.from(b, "hex")); }
  catch { return false; }
}

export interface GateInput {
  claim: string;
  refutations: string[];
  searchResults: SearchResult[];
  nowMs?: number;
  secret?: string;
}

/**
 * Compute verdict from refutations + search outcomes. Pure function.
 *
 * Rules:
 *   1. If ANY search verdict is 'found' → REJECTED (any refutation evidence is fatal).
 *   2. Else if ANY search verdict is 'inconclusive' → UNKNOWN.
 *   3. Else if EVERY refutation has at least one 'not_found' search → ACCEPTED + certificate.
 *   4. Else (refutations exist with NO searches at all) → UNKNOWN.
 *   5. Empty refutations list → UNKNOWN (we refuse to auto-accept untested claims).
 */
export function gateClaim(input: GateInput): GateResult {
  const refCount = input.refutations.length;
  const searchCount = input.searchResults.length;
  // Rule 5: empty refutations → UNKNOWN (don't auto-accept)
  if (refCount === 0) {
    return { verdict: "UNKNOWN", refutationCount: 0, searchCount };
  }
  // Rule 1: any FOUND is fatal
  const found = input.searchResults.find((s) => s.verdict === "found");
  if (found) {
    return { verdict: "REJECTED", rejectedBy: found, refutationCount: refCount, searchCount };
  }
  // Rule 2: any INCONCLUSIVE → UNKNOWN
  const inconclusive = input.searchResults.filter((s) => s.verdict === "inconclusive");
  if (inconclusive.length > 0) {
    return { verdict: "UNKNOWN", pendingSearches: inconclusive, refutationCount: refCount, searchCount };
  }
  // Rule 3 + 4: every refutation must have at least one NOT_FOUND search
  const coverage = new Set<string>();
  for (const s of input.searchResults) {
    if (s.verdict === "not_found") coverage.add(s.refutation);
  }
  const uncovered = input.refutations.filter((r) => !coverage.has(r));
  if (uncovered.length > 0) {
    return { verdict: "UNKNOWN", refutationCount: refCount, searchCount };
  }
  const ts = input.nowMs ?? Date.now();
  const body: Omit<NegativeEvidenceCertificate, "hmac"> = {
    v: PROTOCOL_VERSION,
    claim: input.claim,
    refutationCount: refCount,
    searchCount,
    ts,
  };
  const certificate: NegativeEvidenceCertificate = { ...body, hmac: signCert(body, input.secret ?? defaultSecret()) };
  return { verdict: "ACCEPTED", certificate, refutationCount: refCount, searchCount };
}

export function verifyCertificate(cert: NegativeEvidenceCertificate, secret?: string): { ok: boolean; reason?: string } {
  const { hmac, ...body } = cert;
  const expected = signCert(body, secret ?? defaultSecret());
  if (!safeEqHex(expected, hmac)) {
    return { ok: false, reason: "HMAC mismatch — forged or wrong secret" };
  }
  return { ok: true };
}

// ─── TOKEN TAX LEDGER ───────────────────────────────────────────────────

export interface TaxEntry {
  v: typeof PROTOCOL_VERSION;
  vendor: string;
  kind: "credit" | "charge";
  amount: number;
  reason: string;
  monthKey: string;
  ts: number;
  prevSig: string | null;
  sig: string;
}

export interface TaxLedger {
  v: typeof PROTOCOL_VERSION;
  entries: TaxEntry[];
}

function signTaxEntry(body: Omit<TaxEntry, "sig">, secret: string): string {
  return createHmac("sha256", secret).update(canon(body)).digest("hex");
}

function monthKeyOf(ts: number): string {
  const d = new Date(ts);
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
}

export function emptyTaxLedger(): TaxLedger {
  return { v: PROTOCOL_VERSION, entries: [] };
}

/**
 * Issue the monthly credit. Idempotent within the month: a second call for
 * the same vendor in the same month is a NO-OP.
 */
export function initMonthlyBudget(opts: {
  ledger: TaxLedger;
  vendor: string;
  amount?: number;
  nowMs?: number;
  secret?: string;
}): TaxLedger {
  const nowMs = opts.nowMs ?? Date.now();
  const monthKey = monthKeyOf(nowMs);
  const alreadyCredited = opts.ledger.entries.some(
    (e) => e.vendor === opts.vendor && e.kind === "credit" && e.monthKey === monthKey,
  );
  if (alreadyCredited) return opts.ledger;
  const prev = opts.ledger.entries[opts.ledger.entries.length - 1];
  const body: Omit<TaxEntry, "sig"> = {
    v: PROTOCOL_VERSION,
    vendor: opts.vendor,
    kind: "credit",
    amount: opts.amount ?? DEFAULT_MONTHLY_BUDGET,
    reason: `monthly budget grant ${monthKey}`,
    monthKey,
    ts: nowMs,
    prevSig: prev ? prev.sig : null,
  };
  const sig = signTaxEntry(body, opts.secret ?? defaultSecret());
  return { v: PROTOCOL_VERSION, entries: [...opts.ledger.entries, { ...body, sig }] };
}

/** Append a charge for a refuted claim. Negative amount NOT permitted; pass positive. */
export function chargeTax(opts: {
  ledger: TaxLedger;
  vendor: string;
  amount?: number;
  reason: string;
  nowMs?: number;
  secret?: string;
}): TaxLedger {
  const nowMs = opts.nowMs ?? Date.now();
  const monthKey = monthKeyOf(nowMs);
  const amount = opts.amount ?? DEFAULT_REJECT_COST;
  if (amount < 0) throw new Error("chargeTax: amount must be non-negative");
  const prev = opts.ledger.entries[opts.ledger.entries.length - 1];
  const body: Omit<TaxEntry, "sig"> = {
    v: PROTOCOL_VERSION,
    vendor: opts.vendor,
    kind: "charge",
    amount,
    reason: opts.reason,
    monthKey,
    ts: nowMs,
    prevSig: prev ? prev.sig : null,
  };
  const sig = signTaxEntry(body, opts.secret ?? defaultSecret());
  return { v: PROTOCOL_VERSION, entries: [...opts.ledger.entries, { ...body, sig }] };
}

/** Verify HMAC chain integrity end-to-end. */
export function verifyTaxLedger(ledger: TaxLedger, secret?: string): { ok: boolean; brokenAt?: number; reason?: string } {
  const sec = secret ?? defaultSecret();
  let prevSig: string | null = null;
  for (let i = 0; i < ledger.entries.length; i++) {
    const e = ledger.entries[i]!;
    const { sig, ...body } = e;
    if (body.prevSig !== prevSig) {
      return { ok: false, brokenAt: i, reason: `prevSig mismatch at step ${i}` };
    }
    if (!safeEqHex(signTaxEntry(body, sec), sig)) {
      return { ok: false, brokenAt: i, reason: `HMAC mismatch at step ${i}` };
    }
    prevSig = sig;
  }
  return { ok: true };
}

export interface VendorStatus {
  vendor: string;
  monthKey: string;
  budget: number;
  charged: number;
  remaining: number;
  exhausted: boolean;
  rejectedClaimCount: number;
}

export function vendorStatus(opts: {
  ledger: TaxLedger;
  vendor: string;
  nowMs?: number;
}): VendorStatus {
  const nowMs = opts.nowMs ?? Date.now();
  const monthKey = monthKeyOf(nowMs);
  let budget = 0;
  let charged = 0;
  let rejectedClaimCount = 0;
  for (const e of opts.ledger.entries) {
    if (e.vendor !== opts.vendor || e.monthKey !== monthKey) continue;
    if (e.kind === "credit") budget += e.amount;
    else { charged += e.amount; rejectedClaimCount++; }
  }
  const remaining = budget - charged;
  return {
    vendor: opts.vendor,
    monthKey,
    budget,
    charged,
    remaining,
    exhausted: remaining <= 0,
    rejectedClaimCount,
  };
}

export interface RoutingDecision {
  route: "primary" | "fallback";
  primaryVendor: string;
  fallbackVendor: string;
  reason: string;
  primaryStatus: VendorStatus;
}

export function routingDecision(opts: {
  ledger: TaxLedger;
  primaryVendor: string;
  fallbackVendor: string;
  nowMs?: number;
}): RoutingDecision {
  const status = vendorStatus({ ledger: opts.ledger, vendor: opts.primaryVendor, nowMs: opts.nowMs });
  if (status.exhausted) {
    return {
      route: "fallback",
      primaryVendor: opts.primaryVendor,
      fallbackVendor: opts.fallbackVendor,
      reason: `vendor '${opts.primaryVendor}' exhausted hallucination budget (${status.charged}/${status.budget} for ${status.monthKey}); routing to ${opts.fallbackVendor}`,
      primaryStatus: status,
    };
  }
  return {
    route: "primary",
    primaryVendor: opts.primaryVendor,
    fallbackVendor: opts.fallbackVendor,
    reason: `vendor '${opts.primaryVendor}' has ${status.remaining}/${status.budget} credits remaining`,
    primaryStatus: status,
  };
}

export function formatGateLine(r: GateResult): string {
  const tag = r.verdict === "ACCEPTED" ? "✅" : r.verdict === "REJECTED" ? "❌" : "❓";
  return `${tag} NEGEV · ${r.verdict} · refutations=${r.refutationCount} · searches=${r.searchCount}`;
}
