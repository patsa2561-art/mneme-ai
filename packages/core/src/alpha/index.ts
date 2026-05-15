/**
 * v2.16.0 — MNEME ALPHA  (Honest Financial AI Layer)
 *
 *   "When AI says 'NOK will go up tomorrow', Mneme ALPHA does NOT promise
 *    90% accuracy. It does something that's actually possible: makes the
 *    AI's claim TRACEABLE, FACT-CHECKABLE, and ACCURACY-MEASURED over
 *    time. Sell that. Don't sell oracles."
 *
 * Honest scope (what ALPHA IS):
 *   1. CLAIM EXTRACTION — pull structured claims from AI free-text:
 *      ticker, direction (up/down/flat), horizon (today/week), price
 *      target, confidence (if AI stated one).
 *   2. PRICE-CHECK STUB — verify the price the AI quoted matches a real
 *      live price (caller supplies a price-fetch function; ALPHA never
 *      hardcodes a vendor).
 *   3. OVERCONFIDENCE DETECTOR — flag claims that score above a sanity
 *      ceiling (e.g., "I am 99% sure NVDA pumps tomorrow" → REJECTED).
 *   4. TRACK-RECORD LEDGER — record (claim, vendor, predicted, observed)
 *      and let BOUNTY compute the accuracy over time.
 *   5. SIGNAL FUSION (audit-only) — fuse N AI vendors' opinions into a
 *      consensus + dispersion metric. Output is ADVISORY, never a buy/
 *      sell directive.
 *
 * Honest scope (what ALPHA IS NOT):
 *   - Not a stock predictor.
 *   - Not financial advice.
 *   - Not a "90% accuracy oracle" — markets are mostly efficient + noisy;
 *     no honest engineer claims 90% direction accuracy on liquid stocks.
 *   - Not a backtester (use a proper quant framework for that).
 *
 * Wisdom: this is anti-hallucination + accountability for the corner of
 * AI that has the most expensive hallucinations (someone's retirement).
 * Saying NO to overconfident financial AI is more valuable than any
 * "alpha edge" we could honestly promise.
 */

import { createHmac, randomBytes } from "node:crypto";

const PROTOCOL_VERSION = 1 as const;

export type Direction = "up" | "down" | "flat" | "unknown";
export type Horizon = "intraday" | "today" | "week" | "month" | "quarter" | "year" | "long_term" | "unknown";

export interface FinancialClaim {
  v: typeof PROTOCOL_VERSION;
  id: string;
  ts: string;
  vendor: string;
  /** Raw AI text the claim was extracted from. */
  rawText: string;
  ticker: string | null;
  direction: Direction;
  horizon: Horizon;
  /** Target price if mentioned. */
  targetPrice: number | null;
  /** Stated current price (the AI told the user this is the price). */
  quotedPrice: number | null;
  /** AI-stated confidence 0..1, if any. */
  statedConfidence: number | null;
  /** True if the claim's confidence exceeds the honesty ceiling. */
  overconfident: boolean;
  /** HMAC for tamper-evident citation. */
  sig: string;
}

const TICKER_REGEX = /\b([A-Z]{1,6}(?:\.[A-Z]{1,3})?)\b/g;
const HORIZON_HINTS: Array<[RegExp, Horizon]> = [
  [/\b(intraday|today)\b/i, "today"],
  [/\b(this\s+week|next\s+week|7\s*days?)\b/i, "week"],
  [/\b(this\s+month|next\s+month|30\s*days?)\b/i, "month"],
  [/\b(this\s+quarter|next\s+quarter|q[1-4])\b/i, "quarter"],
  [/\b(this\s+year|next\s+year|annual)\b/i, "year"],
  [/\b(long[\s-]?term|over\s+\d+\s+years?)\b/i, "long_term"],
];

function defaultSecret(): string {
  return process.env["MNEME_ALPHA_SECRET"] || `mneme-alpha-v${PROTOCOL_VERSION}`;
}

function canon(v: unknown): string {
  if (v === null || typeof v !== "object") return JSON.stringify(v);
  if (Array.isArray(v)) return "[" + v.map(canon).join(",") + "]";
  const keys = Object.keys(v as Record<string, unknown>).sort();
  return "{" + keys.map((k) => JSON.stringify(k) + ":" + canon((v as Record<string, unknown>)[k])).join(",") + "}";
}

/**
 * Pull a structured FinancialClaim out of an AI free-text response.
 * Heuristic; non-finding fields stay null.
 */
export function extractClaim(input: { vendor: string; text: string; secret?: string }): FinancialClaim {
  const text = input.text;

  // Ticker — pick the first standalone uppercase 1-6 char token that isn't
  // a common English word noise; bias toward $TICKER pattern when present.
  let ticker: string | null = null;
  const dollar = text.match(/\$([A-Z]{1,6}(?:\.[A-Z]{1,3})?)\b/);
  if (dollar) ticker = dollar[1]!;
  else {
    const tokens = text.match(TICKER_REGEX) || [];
    const NOISE = new Set(["A", "I", "AI", "USA", "USD", "EU", "EUR", "JP", "JPY", "CN", "UK", "PR", "ML", "DM", "AM", "PM", "OK", "IT", "IS", "BE", "OR", "AND", "FOR", "THE", "BUY", "SELL", "HOLD", "CEO", "CFO", "Q1", "Q2", "Q3", "Q4"]);
    ticker = tokens.find((t) => !NOISE.has(t)) ?? null;
  }

  // Direction — look for explicit signals (allow common stems like "dropping" / "rising")
  let direction: Direction = "unknown";
  if (/\b(up|ris(?:e|es|ing)|rall(?:y|ies|ying)|surg(?:e|es|ing)|pump(?:s|ing|ed)?|moon|gain(?:s|ing|ed)?|bull(?:ish)?|long|buy(?:s|ing)?|increas(?:e|es|ing|ed)|higher|breakout|breakthrough)\b/i.test(text)) direction = "up";
  if (/\b(down|fall(?:s|ing|en)?|drop(?:s|ping|ped)?|crash(?:es|ing|ed)?|dump(?:s|ing|ed)?|short(?:ing)?|sell(?:s|ing)?|declin(?:e|es|ing|ed)|lower|breakdown|tank(?:s|ing|ed)?|plung(?:e|es|ing|ed))\b/i.test(text)) direction = direction === "up" ? "unknown" : "down";
  if (/\b(flat|sideways|range|consolidat(?:e|es|ing|ed)|hold|neutral)\b/i.test(text) && direction === "unknown") direction = "flat";

  // Horizon
  let horizon: Horizon = "unknown";
  for (const [rx, h] of HORIZON_HINTS) if (rx.test(text)) { horizon = h; break; }

  // Target price — "target $123" / "target 123 USD"
  const target = text.match(/(?:target|tp|price\s+target)[\s:]*\$?(\d+(?:\.\d+)?)/i);
  const targetPrice = target ? parseFloat(target[1]!) : null;

  // Quoted price — "current price $4.69" / "trading at 4.69"
  const quoted = text.match(/(?:current(?:\s+price)?|trading\s+at|now\s+at|price[\s:])[\s$]*(\d+(?:\.\d+)?)/i);
  const quotedPrice = quoted ? parseFloat(quoted[1]!) : null;

  // Stated confidence — accept "confidence" or "confident" or "sure" or "certain" or "chance" or "probability"
  let statedConfidence: number | null = null;
  const conf = text.match(/(\d+(?:\.\d+)?)\s*%\s*(?:confiden(?:t|ce)|chance|probability|sure|certain|likely)/i);
  if (conf) statedConfidence = Math.max(0, Math.min(1, parseFloat(conf[1]!) / 100));
  else if (/\b(certain|100%|guaranteed|always|will definitely|for sure)\b/i.test(text)) statedConfidence = 1.0;
  else if (/\b(likely|probable|probably)\b/i.test(text) && statedConfidence === null) statedConfidence = 0.7;

  // Overconfidence: stating > 0.85 confidence on a direction prediction is
  // statistically very implausible for liquid markets (efficient market
  // hypothesis + noise). Flag but don't block.
  const overconfident = statedConfidence !== null && statedConfidence > 0.85 && direction !== "unknown";

  const ts = new Date().toISOString();
  const id = "fc-" + randomBytes(6).toString("hex");
  const body: Omit<FinancialClaim, "sig"> = {
    v: PROTOCOL_VERSION,
    id, ts,
    vendor: input.vendor,
    rawText: input.text.slice(0, 2000),
    ticker, direction, horizon,
    targetPrice, quotedPrice, statedConfidence,
    overconfident,
  };
  const sig = createHmac("sha256", input.secret ?? defaultSecret()).update(canon(body)).digest("hex");
  return { ...body, sig };
}

export interface PriceCheckResult {
  matched: boolean;
  quoted: number | null;
  observed: number | null;
  divergencePct: number | null;
  /** Verdict: aligned / divergent / unverifiable / no_quote. */
  verdict: "aligned" | "divergent" | "unverifiable" | "no_quote";
  detail: string;
}

/**
 * Compare the AI's quoted price to a real live price. Caller supplies the
 * fetcher (e.g., backed by IEX / Polygon / Binance / Alpha Vantage / your
 * own broker API). ALPHA never hardcodes a vendor — keeps the layer
 * vendor-agnostic.
 *
 * tolerancePct defaults to 2% (typical bid/ask + slippage).
 */
export async function priceCheck(input: {
  claim: FinancialClaim;
  fetchPrice: (ticker: string) => Promise<number | null>;
  tolerancePct?: number;
}): Promise<PriceCheckResult> {
  if (!input.claim.ticker) {
    return { matched: false, quoted: null, observed: null, divergencePct: null, verdict: "no_quote", detail: "no ticker extracted from claim" };
  }
  if (input.claim.quotedPrice === null) {
    return { matched: false, quoted: null, observed: null, divergencePct: null, verdict: "no_quote", detail: "AI did not quote a price" };
  }
  let observed: number | null = null;
  try { observed = await input.fetchPrice(input.claim.ticker); } catch { observed = null; }
  if (observed === null) {
    return { matched: false, quoted: input.claim.quotedPrice, observed: null, divergencePct: null, verdict: "unverifiable", detail: "live price fetcher returned null" };
  }
  const diff = Math.abs(observed - input.claim.quotedPrice) / observed;
  const tol = input.tolerancePct ?? 0.02;
  const matched = diff <= tol;
  return {
    matched,
    quoted: input.claim.quotedPrice,
    observed,
    divergencePct: Math.round(diff * 10000) / 100,
    verdict: matched ? "aligned" : "divergent",
    detail: matched ? `quoted ${input.claim.quotedPrice} vs observed ${observed} -- within ${(tol * 100).toFixed(1)}% tolerance.` : `MISMATCH: quoted ${input.claim.quotedPrice} vs observed ${observed} (off by ${(diff * 100).toFixed(2)}%).`,
  };
}

/** Fuse N vendors' claims on the same ticker. Returns consensus +
 *  dispersion. ADVISORY ONLY — never a trade signal. */
export function fuseClaims(claims: FinancialClaim[]): {
  ticker: string | null;
  vendorsConsulted: number;
  directionVotes: Record<Direction, number>;
  consensusDirection: Direction;
  consensusStrength: number; // 0..1 = top vote / total
  meanStatedConfidence: number | null;
  overconfidentCount: number;
  /** "advisory" reminder string the caller should display to the user. */
  advisory: string;
} {
  const votes: Record<Direction, number> = { up: 0, down: 0, flat: 0, unknown: 0 };
  for (const c of claims) votes[c.direction]++;
  const ranked = (Object.entries(votes) as Array<[Direction, number]>).sort((a, b) => b[1] - a[1]);
  const top = ranked[0];
  const total = claims.length;
  const meanConf = (() => {
    const withConf = claims.filter((c) => c.statedConfidence !== null);
    if (withConf.length === 0) return null;
    return withConf.reduce((acc, c) => acc + (c.statedConfidence as number), 0) / withConf.length;
  })();
  const oc = claims.filter((c) => c.overconfident).length;
  return {
    ticker: claims[0]?.ticker ?? null,
    vendorsConsulted: total,
    directionVotes: votes,
    consensusDirection: top?.[0] ?? "unknown",
    consensusStrength: total === 0 ? 0 : (top?.[1] ?? 0) / total,
    meanStatedConfidence: meanConf === null ? null : Math.round(meanConf * 1000) / 1000,
    overconfidentCount: oc,
    advisory: "ALPHA fusion is ADVISORY ONLY -- no responsible engineer claims 90% direction accuracy on liquid markets. Use as one input among many; never as sole basis for capital allocation. NOT financial advice.",
  };
}

export function formatAlphaLine(claim: FinancialClaim): string {
  return `ALPHA · ${claim.vendor} · ${claim.ticker ?? "?"} · ${claim.direction}/${claim.horizon}${claim.overconfident ? " ⚠OVERCONFIDENT" : ""}`;
}
