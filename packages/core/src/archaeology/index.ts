/**
 * v2.107.0 — DATA ARCHAEOLOGY (Signed Provenance Ingest).
 *
 * The honest, world-class-engineering core of the "data archaeology" idea —
 * WITHOUT the dark-web / aggressive-scraper / socket-sniffing theatre.
 * Mneme's edge is NOT "access more data" (anyone can `curl`). It is: **every
 * fact that enters your local brain carries a signed, verifiable PROVENANCE**
 * — proof of WHERE it came from, WHEN it was fetched, and that it has not
 * been tampered. Raw PUBLIC content is *distilled* into dense fact-shaped
 * statements, each content-addressed + Ed25519-signed, then handed to the
 * Cognitive Cortex (which dedups + quarantines contradictions). Knowledge
 * alchemy done right: accountable, not hoarded.
 *
 * The fetching is the CALLER's job (an agent's WebFetch, or a local file) —
 * this layer never crawls. It provides the *discipline* (a robots.txt +
 * rate-limit policy you clear BEFORE fetching, so ingest stays legitimate)
 * and the *cryptographic accountability* (signed provenance).
 *
 * Pure + total (108-error rule): deterministic, no network, never throws.
 */

import { createHash } from "node:crypto";
import { issueReceipt, verifyReceipt, type NotaryReceipt } from "../notary/receipt.js";

function sha256(s: string): string { return createHash("sha256").update(typeof s === "string" ? s : "", "utf8").digest("hex"); }

// ── POLICY — robots.txt + rate limiting (the "do it legitimately" layer) ──

export interface RobotsRules { allow: string[]; disallow: string[]; crawlDelaySec: number | null }

/** Parse robots.txt for a user-agent (falls back to the `*` block). Total. */
export function parseRobots(robotsTxt: string, userAgent = "*"): RobotsRules {
  const out: RobotsRules = { allow: [], disallow: [], crawlDelaySec: null };
  try {
    const lines = (typeof robotsTxt === "string" ? robotsTxt : "").split(/\r?\n/);
    const uaLower = userAgent.toLowerCase();
    let active = false; let starRules: RobotsRules | null = null; let cur: RobotsRules = out;
    for (const raw of lines) {
      const line = raw.replace(/#.*$/, "").trim();
      if (!line) continue;
      const m = line.match(/^([a-zA-Z-]+)\s*:\s*(.*)$/);
      if (!m) continue;
      const field = m[1]!.toLowerCase(); const val = m[2]!.trim();
      if (field === "user-agent") {
        const ua = val.toLowerCase();
        active = ua === uaLower;
        if (active) cur = out;
        else if (ua === "*") { starRules = starRules ?? { allow: [], disallow: [], crawlDelaySec: null }; cur = starRules; }
        else cur = { allow: [], disallow: [], crawlDelaySec: null };
      } else if (field === "disallow" && val) cur.disallow.push(val);
      else if (field === "allow" && val) cur.allow.push(val);
      else if (field === "crawl-delay") { const n = parseFloat(val); if (Number.isFinite(n)) cur.crawlDelaySec = n; }
    }
    if (out.allow.length === 0 && out.disallow.length === 0 && out.crawlDelaySec === null && starRules) return starRules;
    if (out.crawlDelaySec === null && starRules?.crawlDelaySec != null) out.crawlDelaySec = starRules.crawlDelaySec;
    return out;
  } catch { return out; }
}

/** robots.txt longest-match: the most specific rule wins; ties → Allow. Total. */
export function isPathAllowed(rules: RobotsRules, path: string): boolean {
  try {
    const p = typeof path === "string" ? path : "/";
    const r = rules && Array.isArray(rules.disallow) ? rules : { allow: [], disallow: [], crawlDelaySec: null };
    let best: { len: number; allow: boolean } | null = null;
    for (const d of r.disallow) if (d && p.startsWith(d)) if (!best || d.length > best.len) best = { len: d.length, allow: false };
    for (const a of (r.allow ?? [])) if (a && p.startsWith(a)) if (!best || a.length >= best.len) best = { len: a.length, allow: true };
    return best ? best.allow : true;
  } catch { return true; }
}

export interface RateState { tokens: number; lastMs: number }
export interface RateVerdict { allowed: boolean; state: RateState; waitMs: number }

/** Pure token-bucket rate limiter (deterministic; the clock is an arg). Total. */
export function rateAcquire(state: RateState | null, capacity: number, refillPerSec: number, nowMs: number): RateVerdict {
  const cap = capacity > 0 ? capacity : 1;
  const rate = refillPerSec > 0 ? refillPerSec : 1;
  const now = Number.isFinite(nowMs) ? nowMs : 0;
  const s: RateState = state && Number.isFinite(state.tokens) ? state : { tokens: cap, lastMs: now };
  const elapsed = Math.max(0, now - s.lastMs) / 1000;
  const tokens = Math.min(cap, s.tokens + elapsed * rate);
  if (tokens >= 1) return { allowed: true, state: { tokens: tokens - 1, lastMs: now }, waitMs: 0 };
  return { allowed: false, state: { tokens, lastMs: now }, waitMs: Math.ceil(((1 - tokens) / rate) * 1000) };
}

// ── DISTILL — raw content → dense, fact-shaped statements (deterministic) ──

/** Pull fact-shaped statements from raw text: sentences carrying a concrete
 *  signal (a number, a Proper-Noun pair, a code token, or a fact keyword).
 *  Deduped, capped, deterministic. Total. */
export function distill(content: string, maxFacts = 50): string[] {
  try {
    const text = typeof content === "string" ? content : "";
    const chunks = text.split(/(?<=[.!?])\s+|\n+/).map((s) => s.replace(/\s+/g, " ").trim());
    const seen = new Set<string>();
    const out: string[] = [];
    for (const s of chunks) {
      if (s.length < 12 || s.length > 400) continue;
      const signal = /\d/.test(s) || /[A-Z][a-z]+ [A-Z][a-z]+/.test(s) || /[\w-]+[:=(){}/][\w-]/.test(s) || /\b(is|are|was|were|has|have|equals|returns|requires|supports|released|version|rate|ratio|percent)\b/i.test(s);
      if (!signal) continue;
      const norm = s.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
      if (seen.has(norm)) continue;
      seen.add(norm);
      out.push(s);
      if (out.length >= Math.max(1, maxFacts)) break;
    }
    return out;
  } catch { return []; }
}

// ── INGEST — distilled facts + signed provenance ──

export interface SourceRef { url: string; content: string; fetchedAt: number }

export interface ProvenanceFact {
  statement: string;
  /** cortex key (statement-hash) for dedup + contradiction-gating. */
  key: string;
  sourceUrl: string;
  contentHash: string;
  fetchedAt: number;
  receipt: NotaryReceipt;
}

export interface IngestResult { facts: ProvenanceFact[]; contentHash: string; distilled: number }

/** Distill a fetched source into signed provenance-facts (ready for the
 *  cortex). Total. `at` = issue timestamp (deterministic). */
export function ingestSource(repoRoot: string, src: SourceRef, at: number, maxFacts = 50): IngestResult {
  try {
    const url = typeof src?.url === "string" ? src.url.slice(0, 2000) : "";
    const content = typeof src?.content === "string" ? src.content : "";
    const fetchedAt = Number.isFinite(src?.fetchedAt) ? src.fetchedAt : at;
    const contentHash = sha256(content);
    const facts: ProvenanceFact[] = distill(content, maxFacts).map((statement) => {
      const statementHash = sha256(statement);
      const receipt = issueReceipt(repoRoot, {
        kind: "memory-capsule",
        subject: `archaeology:${contentHash.slice(0, 16)}`,
        payload: { statementHash, statement, sourceUrl: url, contentHash, fetchedAt },
        includePayload: true,
        issuedAt: at,
      });
      return { statement, key: "ingest." + statementHash.slice(0, 24), sourceUrl: url, contentHash, fetchedAt, receipt };
    });
    return { facts, contentHash, distilled: facts.length };
  } catch { return { facts: [], contentHash: "", distilled: 0 }; }
}

export interface ProvenanceVerdict { valid: boolean; bound: boolean; sourceUrl: string | null; reason: string }

/** Verify a fact's provenance OFFLINE: signature valid AND the receipt binds
 *  this exact statement + source + content hash. Catches a forged source. Total. */
export function verifyProvenance(fact: ProvenanceFact): ProvenanceVerdict {
  try {
    if (!fact || !fact.receipt) return { valid: false, bound: false, sourceUrl: null, reason: "no fact/receipt" };
    const v = verifyReceipt(fact.receipt);
    if (!v.valid) return { valid: false, bound: false, sourceUrl: null, reason: v.reason ?? "bad signature" };
    const p = (fact.receipt as { payload?: Record<string, unknown> }).payload;
    const bound = !!p
      && p.statementHash === sha256(fact.statement)
      && p.statement === fact.statement && p.sourceUrl === fact.sourceUrl
      && p.contentHash === fact.contentHash && p.fetchedAt === fact.fetchedAt;
    return { valid: true, bound, sourceUrl: bound ? fact.sourceUrl : null, reason: bound ? "provenance verified: statement signed from this source" : "signature valid but fact does not match receipt (forged source/statement)" };
  } catch (e) { return { valid: false, bound: false, sourceUrl: null, reason: `threw: ${(e as Error).message}` }; }
}

export interface ArchaeologyGauntlet {
  robotsRespected: boolean;
  rateLimits: boolean;
  distills: boolean;
  signedProvenance: boolean;
  forgeryCaught: boolean;
  stable: boolean;
  score: number;
}

/** Prove the archaeology engine. Total + deterministic. */
export function archaeologyGauntlet(repoRoot: string, at: number): ArchaeologyGauntlet {
  try {
    const rules = parseRobots("User-agent: *\nDisallow: /private\nAllow: /private/ok\nCrawl-delay: 2", "mneme");
    const robotsRespected = isPathAllowed(rules, "/public/x") === true && isPathAllowed(rules, "/private/secret") === false && isPathAllowed(rules, "/private/ok/page") === true;
    const r1 = rateAcquire(null, 2, 1, 1000); const r2 = rateAcquire(r1.state, 2, 1, 1000); const r3 = rateAcquire(r2.state, 2, 1, 1000);
    const rateLimits = r1.allowed && r2.allowed && !r3.allowed && r3.waitMs > 0;
    const content = "The render error rate is 3.2 percent. Mneme Cortex signs every fact. Random filler word here. Version 2.107 ships ingest.";
    const ing = ingestSource(repoRoot, { url: "https://example.org/stats", content, fetchedAt: at }, at);
    const distills = ing.distilled >= 2;
    const signedProvenance = ing.facts.length > 0 && verifyProvenance(ing.facts[0]!).bound;
    const forged = JSON.parse(JSON.stringify(ing.facts[0]!)); forged.sourceUrl = "https://evil.example";
    const forgeryCaught = verifyProvenance(forged).bound === false;
    let stable = true;
    try { parseRobots(null as never); isPathAllowed(null as never, null as never); distill(null as never); ingestSource(repoRoot, null as never, at); verifyProvenance(null as never); rateAcquire(null, 0, 0, NaN); } catch { stable = false; }
    const perfect = robotsRespected && rateLimits && distills && signedProvenance && forgeryCaught && stable;
    return { robotsRespected, rateLimits, distills, signedProvenance, forgeryCaught, stable, score: perfect ? 100 : 0 };
  } catch { return { robotsRespected: false, rateLimits: false, distills: false, signedProvenance: false, forgeryCaught: false, stable: false, score: 0 }; }
}
