/**
 * v2.19.12 — MNEME DIALECT (Personal Intent Map)
 *
 *   "When you type `mneme ask 'X'`, Mneme records: phrase you used →
 *    intent you accepted (or rejected). After enough hits, the SAME
 *    phrase from YOU resolves silently; the same phrase from a teammate
 *    still asks for clarification. Mneme literally learns to speak the
 *    dialect of one person — yours."
 *
 * Architecture:
 *   - HMAC-chained ledger: each record links to its predecessor's sig.
 *     Tampering with any prior record breaks the chain at that point.
 *   - Per-callerKey frequency table: phrase → { intent → count } +
 *     accepted/rejected outcomes.
 *   - Resolution policy (deterministic, no ML):
 *       1. count >= AUTO_RESOLVE_THRESHOLD AND acceptedRatio >= 0.8
 *          → auto-resolve (verdict: speak_native)
 *       2. count >= ASK_BUT_HINT_THRESHOLD
 *          → ask-with-hint (verdict: ask_with_hint)
 *       3. else
 *          → ask-clarification (verdict: ask_clarify)
 *
 * Honest scope:
 *   - This is not natural-language understanding; it's a per-user phrase
 *     resolver that learns from explicit accept/reject feedback.
 *   - Cross-user blindness is intentional: speaks YOUR dialect, not the
 *     team's dialect (the team marketplace would be a separate module).
 */

import { createHmac, timingSafeEqual } from "node:crypto";

const PROTOCOL_VERSION = 1 as const;
const AUTO_RESOLVE_THRESHOLD = 5;
const ASK_BUT_HINT_THRESHOLD = 2;
const AUTO_RESOLVE_RATIO = 0.8;

export interface DialectRecord {
  v: typeof PROTOCOL_VERSION;
  callerKey: string;
  phrase: string;
  intent: string;
  accepted: boolean;
  ts: number;
  prevSig: string | null;
  sig: string;
}

export interface DialectLedger {
  v: typeof PROTOCOL_VERSION;
  records: DialectRecord[];
}

function canon(v: unknown): string {
  if (v === null || typeof v !== "object") return JSON.stringify(v);
  if (Array.isArray(v)) return "[" + v.map(canon).join(",") + "]";
  const keys = Object.keys(v as Record<string, unknown>).sort();
  return "{" + keys.map((k) => JSON.stringify(k) + ":" + canon((v as Record<string, unknown>)[k])).join(",") + "}";
}

function defaultSecret(): string {
  return process.env["MNEME_DIALECT_SECRET"] || `mneme-dialect-v${PROTOCOL_VERSION}`;
}

function sign(body: Omit<DialectRecord, "sig">, secret: string): string {
  return createHmac("sha256", secret).update(canon(body)).digest("hex");
}

function safeEqHex(a: string, b: string): boolean {
  try { return timingSafeEqual(Buffer.from(a, "hex"), Buffer.from(b, "hex")); }
  catch { return false; }
}

function normalisePhrase(p: string): string {
  return p.trim().toLowerCase().replace(/\s+/g, " ");
}

export function emptyLedger(): DialectLedger {
  return { v: PROTOCOL_VERSION, records: [] };
}

export interface LearnInput {
  ledger: DialectLedger;
  callerKey: string;
  phrase: string;
  intent: string;
  accepted: boolean;
  nowMs?: number;
  secret?: string;
}

export function learnPhrase(input: LearnInput): DialectLedger {
  const prev = input.ledger.records[input.ledger.records.length - 1];
  const body: Omit<DialectRecord, "sig"> = {
    v: PROTOCOL_VERSION,
    callerKey: input.callerKey,
    phrase: normalisePhrase(input.phrase),
    intent: input.intent,
    accepted: input.accepted,
    ts: input.nowMs ?? Date.now(),
    prevSig: prev ? prev.sig : null,
  };
  const sig = sign(body, input.secret ?? defaultSecret());
  return { v: PROTOCOL_VERSION, records: [...input.ledger.records, { ...body, sig }] };
}

export type ResolveVerdict = "speak_native" | "ask_with_hint" | "ask_clarify";

export interface ResolveOutput {
  verdict: ResolveVerdict;
  topIntent?: string;
  confidence: number;
  totalHits: number;
  acceptedRatio: number;
  alternatives: Array<{ intent: string; count: number; acceptedRatio: number }>;
}

export function resolvePhrase(opts: {
  ledger: DialectLedger;
  callerKey: string;
  phrase: string;
}): ResolveOutput {
  const phraseNorm = normalisePhrase(opts.phrase);
  const userRecs = opts.ledger.records.filter(
    (r) => r.callerKey === opts.callerKey && r.phrase === phraseNorm,
  );
  if (userRecs.length === 0) {
    return { verdict: "ask_clarify", confidence: 0, totalHits: 0, acceptedRatio: 0, alternatives: [] };
  }
  // Tally per intent
  const byIntent = new Map<string, { count: number; accepted: number }>();
  for (const r of userRecs) {
    const entry = byIntent.get(r.intent) ?? { count: 0, accepted: 0 };
    entry.count++;
    if (r.accepted) entry.accepted++;
    byIntent.set(r.intent, entry);
  }
  const alts = Array.from(byIntent.entries())
    .map(([intent, e]) => ({ intent, count: e.count, acceptedRatio: e.accepted / e.count }))
    .sort((a, b) => b.count - a.count || b.acceptedRatio - a.acceptedRatio);
  const top = alts[0]!;
  const totalAccepted = alts.reduce((s, a) => s + a.acceptedRatio * a.count, 0);
  const totalHits = alts.reduce((s, a) => s + a.count, 0);
  const acceptedRatio = totalHits === 0 ? 0 : totalAccepted / totalHits;
  let verdict: ResolveVerdict;
  if (top.count >= AUTO_RESOLVE_THRESHOLD && top.acceptedRatio >= AUTO_RESOLVE_RATIO) {
    verdict = "speak_native";
  } else if (top.count >= ASK_BUT_HINT_THRESHOLD) {
    verdict = "ask_with_hint";
  } else {
    verdict = "ask_clarify";
  }
  return {
    verdict,
    topIntent: top.intent,
    confidence: Math.min(1, top.count / AUTO_RESOLVE_THRESHOLD) * top.acceptedRatio,
    totalHits,
    acceptedRatio,
    alternatives: alts,
  };
}

/** Verify the chain integrity of the ledger end-to-end. */
export function verifyLedger(ledger: DialectLedger, secret?: string): { ok: boolean; brokenAt?: number; reason?: string } {
  const sec = secret ?? defaultSecret();
  let prevSig: string | null = null;
  for (let i = 0; i < ledger.records.length; i++) {
    const r = ledger.records[i]!;
    const { sig, ...body } = r;
    if (body.prevSig !== prevSig) {
      return { ok: false, brokenAt: i, reason: `prevSig mismatch at step ${i}` };
    }
    const expected = sign(body, sec);
    if (!safeEqHex(expected, sig)) {
      return { ok: false, brokenAt: i, reason: `HMAC mismatch at step ${i} — forged or wrong secret` };
    }
    prevSig = sig;
  }
  return { ok: true };
}

/** Export a serializable snapshot keyed by caller for cross-machine sync. */
export function exportDialect(opts: { ledger: DialectLedger; callerKey: string }): {
  callerKey: string;
  recordCount: number;
  records: DialectRecord[];
  exportedAt: string;
} {
  const records = opts.ledger.records.filter((r) => r.callerKey === opts.callerKey);
  return {
    callerKey: opts.callerKey,
    recordCount: records.length,
    records,
    exportedAt: new Date().toISOString(),
  };
}

export function formatResolveLine(r: ResolveOutput): string {
  const top = r.topIntent ? `→ ${r.topIntent}` : "(no candidates)";
  return `🗣 DIALECT · ${r.verdict} · ${top} · conf=${r.confidence.toFixed(2)} · hits=${r.totalHits}`;
}
