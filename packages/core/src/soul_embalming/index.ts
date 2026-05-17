/**
 * v2.19.30 — MNEME SOUL EMBALMING (Commonwealth pillar #1)
 *
 *   "ทุก 5 นาที agent ถูกแช่ศพ. เมื่อ account โดน ban → spawn replacement
 *    (Codex if Claude banned) → inject EMBALMED SOUL → new agent ไม่รู้สึก
 *    ว่ามันตาย. งานต่อ ไม่ rollback."
 *                                          — user mandate, 2026-05-17
 *
 *   Diagnosis: Multi-agent workflows lose CONTINUITY when an account/vendor
 *   gets banned mid-task. Vendor SDKs treat this as fatal — entire context
 *   evaporates. Mneme as neutral local-first layer can capture + restore
 *   the agent's evolving state across vendor boundaries.
 *
 *   What we embalm (caller-supplied; vendor-neutral):
 *     - currentGoal: parsed task description
 *     - decisionHistory: last N (default 100) decisions agent made
 *     - mentalModel: snapshot of agent's repo understanding (axiom pool)
 *     - currentBiases: mood/confidence/risk (from HORMONAL)
 *     - lastToolCalls: last K (default 10) tool calls + outcomes
 *
 *   HMAC-signed, ring-buffered (default 30-day retention), compressible JSON.
 *
 *   Composes onto:
 *     - v2.19.28 AUTONOMIC SCHEDULER (5-min interval drives embalming)
 *     - v2.19.16 FEDERATED TRUTH (cross-instance soul transport)
 *     - v2.19.10 PROOF-CARRYING (HMAC chain pattern reused)
 *     - v2.19.25 ENDOCRINE (currentBiases comes from hormonal state)
 *
 * Honest scope:
 *   - PURE FUNCTION snapshot + restore. Caller (daemon) writes JSON to disk.
 *   - HMAC-chained for tamper-evident lineage (so transferred souls can be
 *     verified by receiver instance before injection).
 *   - 24/7 safe: malformed snapshots dropped silently; ring buffer never
 *     overflows (oldest evicted on add).
 */

import { createHmac, timingSafeEqual } from "node:crypto";

const PROTOCOL_VERSION = 1 as const;
const DEFAULT_RING_BUFFER_SIZE = 8640; // ~30 days @ 5min interval
const DEFAULT_DECISION_HISTORY_LIMIT = 100;
const DEFAULT_TOOL_CALL_LIMIT = 10;

export interface AgentSoul {
  v: typeof PROTOCOL_VERSION;
  agentId: string;
  vendorAtEmbalm: string;
  /** Parsed task or goal the agent is working on. */
  currentGoal: string;
  /** Capped list of recent (decision, ts) records. */
  decisionHistory: Array<{ summary: string; ts: number; outcome?: "merged" | "reverted" | "pending" }>;
  /** Compact axiom snapshot — facts the agent currently believes. */
  mentalModel: Record<string, unknown>;
  /** Hormonal state (focus / fatigue / mood / cortisol etc). */
  currentBiases: Record<string, number>;
  /** Capped list of recent tool calls + outcomes. */
  lastToolCalls: Array<{ toolName: string; args?: Record<string, unknown>; ok: boolean; ts: number }>;
  embalmedAtMs: number;
}

export interface EmbalmedSoulRecord {
  v: typeof PROTOCOL_VERSION;
  soul: AgentSoul;
  prevSig: string | null;
  sig: string;
}

export interface SoulCrypt {
  v: typeof PROTOCOL_VERSION;
  agentId: string;
  records: EmbalmedSoulRecord[];
  ringBufferSize: number;
}

function canon(v: unknown): string {
  if (v === null || typeof v !== "object") return JSON.stringify(v);
  if (Array.isArray(v)) return "[" + v.map(canon).join(",") + "]";
  const keys = Object.keys(v as Record<string, unknown>).sort();
  return "{" + keys.map((k) => JSON.stringify(k) + ":" + canon((v as Record<string, unknown>)[k])).join(",") + "}";
}

function defaultSecret(): string {
  return process.env["MNEME_SOUL_EMBALMING_SECRET"] || `mneme-soul-embalming-v${PROTOCOL_VERSION}`;
}

function hmacHex(body: unknown, secret: string): string {
  return createHmac("sha256", secret).update(canon(body)).digest("hex");
}

function safeEqHex(a: string, b: string): boolean {
  try { return timingSafeEqual(Buffer.from(a, "hex"), Buffer.from(b, "hex")); }
  catch { return false; }
}

export function emptyCrypt(agentId: string, ringBufferSize: number = DEFAULT_RING_BUFFER_SIZE): SoulCrypt {
  return {
    v: PROTOCOL_VERSION,
    agentId,
    records: [],
    ringBufferSize: Math.max(1, ringBufferSize),
  };
}

/** Cap decisionHistory + lastToolCalls to their defaults to prevent unbounded growth. */
function capSoul(soul: AgentSoul): AgentSoul {
  return {
    ...soul,
    decisionHistory: soul.decisionHistory.slice(-DEFAULT_DECISION_HISTORY_LIMIT),
    lastToolCalls: soul.lastToolCalls.slice(-DEFAULT_TOOL_CALL_LIMIT),
  };
}

/**
 * Append a fresh soul to the crypt; HMAC-chained to previous record.
 * Ring buffer: oldest record evicted when crypt exceeds ringBufferSize.
 * Defensive: malformed soul (missing agentId) returns crypt unchanged.
 */
export function embalmSoul(input: {
  crypt: SoulCrypt;
  soul: AgentSoul;
  secret?: string;
}): SoulCrypt {
  if (!input.soul?.agentId || input.soul.agentId !== input.crypt.agentId) {
    return input.crypt;
  }
  const sec = input.secret ?? defaultSecret();
  const capped = capSoul(input.soul);
  const prev = input.crypt.records[input.crypt.records.length - 1];
  const body: Omit<EmbalmedSoulRecord, "sig"> = {
    v: PROTOCOL_VERSION,
    soul: capped,
    prevSig: prev ? prev.sig : null,
  };
  const sig = hmacHex(body, sec);
  const record: EmbalmedSoulRecord = { ...body, sig };
  const records = [...input.crypt.records, record];
  // Ring buffer eviction
  while (records.length > input.crypt.ringBufferSize) records.shift();
  return { ...input.crypt, records };
}

/**
 * Restore the most recent embalmed soul (typically called on ban detection).
 * Returns null if crypt empty or HMAC chain tampered.
 */
export function restoreLatestSoul(input: { crypt: SoulCrypt; secret?: string }): AgentSoul | null {
  if (input.crypt.records.length === 0) return null;
  if (!verifyCrypt(input.crypt, input.secret)) return null;
  return input.crypt.records[input.crypt.records.length - 1]!.soul;
}

/**
 * Restore a specific record by index (0 = oldest, -1 = newest).
 * Defensive: out-of-range or tampered → null.
 */
export function restoreSoulAt(input: { crypt: SoulCrypt; index: number; secret?: string }): AgentSoul | null {
  if (!verifyCrypt(input.crypt, input.secret)) return null;
  const idx = input.index < 0 ? input.crypt.records.length + input.index : input.index;
  if (idx < 0 || idx >= input.crypt.records.length) return null;
  return input.crypt.records[idx]!.soul;
}

/**
 * Verify the HMAC chain end-to-end.
 *
 * Ring-buffer aware: when oldest records are evicted, the new first record's
 * prevSig points to an evicted record (not null). We anchor the chain at the
 * first present record's stored prevSig and only check INTEGRITY of the
 * records we have + per-record signatures.
 */
export function verifyCrypt(crypt: SoulCrypt, secret?: string): boolean {
  const sec = secret ?? defaultSecret();
  if (crypt.records.length === 0) return true;
  // Anchor at first record's stored prevSig (which may be null if no eviction yet,
  // OR the evicted predecessor's sig after ring rotation). Verify subsequent links.
  let prevSig: string | null = crypt.records[0]!.prevSig;
  for (const r of crypt.records) {
    const { sig, ...body } = r;
    if (body.prevSig !== prevSig) return false;
    if (!safeEqHex(hmacHex(body, sec), sig)) return false;
    prevSig = sig;
  }
  return true;
}

export interface SoulCryptStats {
  agentId: string;
  totalRecords: number;
  capacityUsed: number;
  oldestEmbalmedAtMs: number | null;
  newestEmbalmedAtMs: number | null;
  spanMs: number;
}

export function computeCryptStats(crypt: SoulCrypt): SoulCryptStats {
  if (crypt.records.length === 0) {
    return {
      agentId: crypt.agentId,
      totalRecords: 0,
      capacityUsed: 0,
      oldestEmbalmedAtMs: null,
      newestEmbalmedAtMs: null,
      spanMs: 0,
    };
  }
  const oldest = crypt.records[0]!.soul.embalmedAtMs;
  const newest = crypt.records[crypt.records.length - 1]!.soul.embalmedAtMs;
  return {
    agentId: crypt.agentId,
    totalRecords: crypt.records.length,
    capacityUsed: crypt.records.length / crypt.ringBufferSize,
    oldestEmbalmedAtMs: oldest,
    newestEmbalmedAtMs: newest,
    spanMs: newest - oldest,
  };
}

export function formatCryptLine(s: SoulCryptStats): string {
  const cap = (s.capacityUsed * 100).toFixed(0);
  const days = s.spanMs > 0 ? (s.spanMs / 86400000).toFixed(1) : "0";
  return `⚱ CRYPT ${s.agentId} · ${s.totalRecords} souls · ${cap}% cap · spans ${days}d`;
}

export const SOUL_EMBALMING_TUNABLES = Object.freeze({
  DEFAULT_RING_BUFFER_SIZE,
  DEFAULT_DECISION_HISTORY_LIMIT,
  DEFAULT_TOOL_CALL_LIMIT,
});
