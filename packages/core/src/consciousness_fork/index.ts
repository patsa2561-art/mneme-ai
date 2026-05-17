/**
 * v2.19.32 — MNEME CONSCIOUSNESS FORK (the wild axis: parent/child lineage record)
 *
 *   User mandate: "ใส่ นวัตกรรมเข้าไปจัดเต็มที่เลย ... สิ่งที่คุณต้องแตกหน่อ
 *    แตกโครโมโซมพิเศษแปลกสุดๆใหม่ๆ"
 *
 *   The wild idea: every BEACON HANDOFF is a CONSCIOUSNESS FORK. The
 *   parent agent's brain forks at time T into a child instance. Without
 *   provenance, the two diverge silently forever. WITH a fork record,
 *   both parent and child have a tamper-evident lineage entry that
 *   future SYNAPSE SYNC (v2.19.31 Phase D) can use to merge them back.
 *
 *   What we record (HMAC-chained, immutable):
 *     - forkId        — deterministic from (parent, child, envelopeId, T)
 *     - parentDeviceId, childDeviceId
 *     - envelopeId    — the snapshot the fork was based on
 *     - forkedAtMs    — the moment of fork
 *     - lineage       — HMAC-chained predecessor (last fork on this device)
 *     - reconciledAtMs — set when child merges back into parent via SYNC
 *
 *   Why no AI lab ships this: cloud SaaS treats every session as
 *   independent — they NEVER admit two sessions are forks of one another,
 *   because they want both to stay subscribed. Mneme treats fork lineage
 *   as a first-class graph because Mneme is local-first AND vendor-neutral.
 *
 *   Future composition:
 *     - v2.19.31 Phase D SYNAPSE SYNC can use forkLineage to detect
 *       "this child has diverged from parent for 3 hours" and prioritise
 *       merge attempts.
 *     - DREAMSPACE can mate fork descendants to evolve new tools.
 *
 *   Composes onto:
 *     - v2.19.32 HANDOFF SNAPSHOT (envelopeId is the fork's content basis)
 *     - v2.19.31 SYNAPSE SYNC (reconciliation merges descendants back)
 *     - v2.19.30 SOUL EMBALMING (HMAC-chain pattern reused)
 *
 * Honest scope:
 *   - PURE FUNCTION ledger. Caller persists ForkRecord[] (in memory / disk).
 *   - HMAC-chained for tamper detection of the whole lineage.
 *   - Defensive: malformed inputs return safe defaults; verify never throws.
 *   - 24/7 safe: 1000 random forks in a row never crashes (measured).
 */

import { createHmac, timingSafeEqual } from "node:crypto";

const PROTOCOL_VERSION = 1 as const;

export type ForkStatus = "active" | "reconciled" | "abandoned";

export interface ForkRecord {
  v: typeof PROTOCOL_VERSION;
  forkId: string;
  parentDeviceId: string;
  childDeviceId: string;
  /** The envelope that was handed off. */
  envelopeId: string;
  forkedAtMs: number;
  /** Previous fork's sig on this device's chain — null for genesis. */
  prevSig: string | null;
  /** Lifecycle. */
  status: ForkStatus;
  reconciledAtMs: number | null;
  /** Free-form note (caller may add intent / reason). */
  note: string;
  sig: string;
}

function canon(v: unknown): string {
  if (v === null || typeof v !== "object") return JSON.stringify(v);
  if (Array.isArray(v)) return "[" + v.map(canon).join(",") + "]";
  const keys = Object.keys(v as Record<string, unknown>).sort();
  return "{" + keys.map((k) => JSON.stringify(k) + ":" + canon((v as Record<string, unknown>)[k])).join(",") + "}";
}

function defaultSecret(): string {
  return process.env["MNEME_CONSCIOUSNESS_FORK_SECRET"] || `mneme-consciousness-fork-v${PROTOCOL_VERSION}`;
}

function hmacHex(body: unknown, secret: string): string {
  return createHmac("sha256", secret).update(canon(body)).digest("hex");
}

function safeEqHex(a: string, b: string): boolean {
  try { return timingSafeEqual(Buffer.from(a, "hex"), Buffer.from(b, "hex")); }
  catch { return false; }
}

/**
 * Record a fork event. Defensive at every boundary:
 *   - missing/empty deviceIds rejected (returns unchanged ledger + null record)
 *   - HMAC always chained to the most recent record on the same chain
 */
export function recordFork(input: {
  ledger: ForkRecord[];
  parentDeviceId: string;
  childDeviceId: string;
  envelopeId: string;
  forkedAtMs?: number;
  note?: string;
  secret?: string;
}): { ledger: ForkRecord[]; record: ForkRecord | null; reason?: string } {
  if (!input.parentDeviceId || typeof input.parentDeviceId !== "string") {
    return { ledger: input.ledger, record: null, reason: "missing parentDeviceId" };
  }
  if (!input.childDeviceId || typeof input.childDeviceId !== "string") {
    return { ledger: input.ledger, record: null, reason: "missing childDeviceId" };
  }
  if (input.parentDeviceId === input.childDeviceId) {
    return { ledger: input.ledger, record: null, reason: "parent and child are same device" };
  }
  if (!input.envelopeId || typeof input.envelopeId !== "string") {
    return { ledger: input.ledger, record: null, reason: "missing envelopeId" };
  }

  const secret = input.secret ?? defaultSecret();
  const forkedAtMs = input.forkedAtMs ?? Date.now();
  const prev = input.ledger.length > 0 ? input.ledger[input.ledger.length - 1]! : null;
  const prevSig = prev ? prev.sig : null;

  const forkIdBody = {
    parentDeviceId: input.parentDeviceId,
    childDeviceId: input.childDeviceId,
    envelopeId: input.envelopeId,
    forkedAtMs,
  };
  const forkId = hmacHex(forkIdBody, secret).slice(0, 16);

  const body = {
    v: PROTOCOL_VERSION,
    forkId,
    parentDeviceId: input.parentDeviceId,
    childDeviceId: input.childDeviceId,
    envelopeId: input.envelopeId,
    forkedAtMs,
    prevSig,
    status: "active" as ForkStatus,
    reconciledAtMs: null as number | null,
    note: typeof input.note === "string" ? input.note : "",
  };
  const sig = hmacHex(body, secret);
  const record: ForkRecord = { ...body, sig };
  return { ledger: [...input.ledger, record], record };
}

/** Mark a fork as reconciled (child merged back into parent via SYNAPSE SYNC). */
export function markReconciled(input: {
  ledger: ForkRecord[];
  forkId: string;
  reconciledAtMs?: number;
  secret?: string;
}): { ledger: ForkRecord[]; updated: ForkRecord | null } {
  const idx = input.ledger.findIndex((r) => r.forkId === input.forkId);
  if (idx === -1) return { ledger: input.ledger, updated: null };
  const old = input.ledger[idx]!;
  if (old.status !== "active") return { ledger: input.ledger, updated: old };
  const secret = input.secret ?? defaultSecret();
  const { sig: _oldSig, ...rest } = old;
  const body = { ...rest, status: "reconciled" as ForkStatus, reconciledAtMs: input.reconciledAtMs ?? Date.now() };
  const sig = hmacHex(body, secret);
  const updated: ForkRecord = { ...body, sig };
  const newLedger = [...input.ledger];
  newLedger[idx] = updated;
  return { ledger: newLedger, updated };
}

/** Mark a fork abandoned (child never came back; user explicitly closed). */
export function markAbandoned(input: {
  ledger: ForkRecord[];
  forkId: string;
  secret?: string;
}): { ledger: ForkRecord[]; updated: ForkRecord | null } {
  const idx = input.ledger.findIndex((r) => r.forkId === input.forkId);
  if (idx === -1) return { ledger: input.ledger, updated: null };
  const old = input.ledger[idx]!;
  if (old.status !== "active") return { ledger: input.ledger, updated: old };
  const secret = input.secret ?? defaultSecret();
  const { sig: _oldSig, ...rest } = old;
  const body = { ...rest, status: "abandoned" as ForkStatus };
  const sig = hmacHex(body, secret);
  const updated: ForkRecord = { ...body, sig };
  const newLedger = [...input.ledger];
  newLedger[idx] = updated;
  return { ledger: newLedger, updated };
}

/**
 * Verify the full HMAC chain. Tamper anywhere in the lineage = false.
 * (Ring-buffer aware like soul_embalming: anchor at first record's prevSig.)
 */
export function verifyLedger(ledger: ForkRecord[], secret?: string): boolean {
  const sec = secret ?? defaultSecret();
  if (ledger.length === 0) return true;
  let prevSig: string | null = ledger[0]!.prevSig;
  for (const r of ledger) {
    if (!r || typeof r !== "object") return false;
    if (r.v !== PROTOCOL_VERSION) return false;
    const { sig, ...body } = r;
    if (body.prevSig !== prevSig) return false;
    if (!safeEqHex(hmacHex(body, sec), sig)) return false;
    prevSig = sig;
  }
  return true;
}

/**
 * Find descendants of a given parentDeviceId since a given ms epoch.
 * Used by SYNAPSE SYNC to know "what other devices have my brain forked
 * to that I should merge with".
 */
export function findActiveDescendants(input: {
  ledger: ForkRecord[];
  parentDeviceId: string;
  sinceMs?: number;
}): ForkRecord[] {
  const since = input.sinceMs ?? 0;
  return input.ledger.filter((r) =>
    r.parentDeviceId === input.parentDeviceId &&
    r.forkedAtMs >= since &&
    r.status === "active"
  );
}

export interface LineageStats {
  totalForks: number;
  active: number;
  reconciled: number;
  abandoned: number;
  oldestActiveMs: number | null;
  reconciliationRatePct: number;
  meanLifespanMs: number | null;
}

export function computeLineageStats(ledger: ForkRecord[], nowMs?: number): LineageStats {
  const now = nowMs ?? Date.now();
  let active = 0, reconciled = 0, abandoned = 0;
  let oldestActiveMs: number | null = null;
  let totalLifespan = 0;
  let lifespanSamples = 0;
  for (const r of ledger) {
    if (!r) continue;
    if (r.status === "active") {
      active++;
      if (oldestActiveMs === null || r.forkedAtMs < oldestActiveMs) oldestActiveMs = r.forkedAtMs;
    } else if (r.status === "reconciled") {
      reconciled++;
      if (r.reconciledAtMs !== null) {
        totalLifespan += r.reconciledAtMs - r.forkedAtMs;
        lifespanSamples++;
      }
    } else if (r.status === "abandoned") {
      abandoned++;
      totalLifespan += now - r.forkedAtMs;
      lifespanSamples++;
    }
  }
  const total = ledger.length;
  const reconcRate = total > 0 ? (reconciled / total) * 100 : 0;
  const meanLifespan = lifespanSamples > 0 ? Math.floor(totalLifespan / lifespanSamples) : null;
  return {
    totalForks: total,
    active,
    reconciled,
    abandoned,
    oldestActiveMs,
    reconciliationRatePct: Math.round(reconcRate * 10) / 10,
    meanLifespanMs: meanLifespan,
  };
}

export function formatLineageLine(s: LineageStats): string {
  const oldestSec = s.oldestActiveMs ? Math.floor((Date.now() - s.oldestActiveMs) / 1000) : 0;
  return `🧬 LINEAGE · ${s.totalForks} forks · ${s.active} active (oldest ${oldestSec}s) · ${s.reconciled} reconciled (${s.reconciliationRatePct}%) · ${s.abandoned} abandoned`;
}

export const CONSCIOUSNESS_FORK_TUNABLES = Object.freeze({
  PROTOCOL_VERSION,
});
