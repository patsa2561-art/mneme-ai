/**
 * v2.19.14 — MNEME TEMPORAL CONSEQUENCE LEDGER (causal-aware CLI)
 *
 *   "Every `mneme verify` you run gets logged with a sha of the repo state
 *    at T+0. Twenty-four hours later, you (or the daemon) pushes the new
 *    state sha — Mneme computes the delta and links it to the original
 *    run. After 90 days you can ask: 'what does `mneme verify` tend to
 *    cause within 24 hours?' Answer: 'on average, you delete 3 commits
 *    in the next 24h after running it.' CLI that knows what its OWN
 *    output causes — the first causal-aware AI tool."
 *
 * Architecture:
 *   - HMAC-chained record: { cmd, args, resultDigest, repoStateBefore,
 *     repoStateAfter?, deltaSummary?, ts, prevSig, sig }
 *   - At record time: caller pushes cmd + args + resultDigest + state-now.
 *   - At T+~24h: caller (or daemon) pushes the new state + a deltaSummary
 *     (free-text JSON e.g. {commitsAdded, commitsRemoved, filesChanged}).
 *   - Query: aggregate { cmd → { avgDeltaSummary, n, lastSeen } } over
 *     records whose delta was recorded.
 *
 * Honest scope:
 *   - We don't compute the delta ourselves — caller supplies it (git diff,
 *     filesystem snapshot, whatever). Caller decides what 'delta' means.
 *   - Correlation, not causation. We can say "X happened after Y" not
 *     "Y caused X" — caller's responsibility to interpret.
 *   - Aggregation is mean over numeric fields the caller chose to record.
 *     Non-numeric fields are tallied via top-K most common values.
 */

import { createHmac, createHash, timingSafeEqual } from "node:crypto";

const PROTOCOL_VERSION = 1 as const;

export interface ConsequenceRecord {
  v: typeof PROTOCOL_VERSION;
  id: string;
  cmd: string;
  args: Record<string, unknown>;
  /** SHA-256 of the canonicalised result, so callers can dedupe identical results. */
  resultDigest: string;
  repoStateBefore: string;
  repoStateAfter: string | null;
  /** Caller-defined summary of what changed (keys are caller's choice). */
  deltaSummary: Record<string, unknown> | null;
  recordedAtMs: number;
  deltaRecordedAtMs: number | null;
  prevSig: string | null;
  sig: string;
}

export interface ConsequenceLedger {
  v: typeof PROTOCOL_VERSION;
  records: ConsequenceRecord[];
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

function defaultSecret(): string {
  return process.env["MNEME_CONSEQ_SECRET"] || `mneme-consequence-ledger-v${PROTOCOL_VERSION}`;
}

function signRecord(body: Omit<ConsequenceRecord, "sig">, secret: string): string {
  return createHmac("sha256", secret).update(canon(body)).digest("hex");
}

function safeEqHex(a: string, b: string): boolean {
  try { return timingSafeEqual(Buffer.from(a, "hex"), Buffer.from(b, "hex")); }
  catch { return false; }
}

function makeRunId(cmd: string, recordedAtMs: number): string {
  return "csq-" + createHmac("sha256", "mneme-consequence-id")
    .update(`${cmd}|${recordedAtMs}`)
    .digest("hex").slice(0, 14);
}

export function emptyConsequenceLedger(): ConsequenceLedger {
  return { v: PROTOCOL_VERSION, records: [] };
}

export interface RecordRunInput {
  ledger: ConsequenceLedger;
  cmd: string;
  args?: Record<string, unknown>;
  result: unknown;
  repoStateBefore: string;
  recordedAtMs?: number;
  secret?: string;
}

export function recordRun(input: RecordRunInput): ConsequenceLedger {
  const recordedAtMs = input.recordedAtMs ?? Date.now();
  const resultDigest = sha256Hex(canon(input.result));
  const prevSig = input.ledger.records[input.ledger.records.length - 1]?.sig ?? null;
  const body: Omit<ConsequenceRecord, "sig"> = {
    v: PROTOCOL_VERSION,
    id: makeRunId(input.cmd, recordedAtMs),
    cmd: input.cmd,
    args: input.args ?? {},
    resultDigest,
    repoStateBefore: input.repoStateBefore,
    repoStateAfter: null,
    deltaSummary: null,
    recordedAtMs,
    deltaRecordedAtMs: null,
    prevSig,
  };
  const sig = signRecord(body, input.secret ?? defaultSecret());
  return { v: PROTOCOL_VERSION, records: [...input.ledger.records, { ...body, sig }] };
}

export interface RecordDeltaInput {
  ledger: ConsequenceLedger;
  runId: string;
  repoStateAfter: string;
  deltaSummary: Record<string, unknown>;
  recordedAtMs?: number;
  secret?: string;
}

/**
 * Append a delta record for a previous run. The original record stays
 * appendable (we don't rewrite its sig); the latest record per `id` is
 * the source of truth for queries.
 */
export function recordDelta(input: RecordDeltaInput): { ledger: ConsequenceLedger; ok: boolean; reason?: string } {
  const orig = input.ledger.records.slice().reverse().find((r) => r.id === input.runId);
  if (!orig) return { ledger: input.ledger, ok: false, reason: `run id '${input.runId}' not found` };
  if (orig.deltaSummary !== null) {
    return { ledger: input.ledger, ok: false, reason: `delta for run '${input.runId}' already recorded` };
  }
  const nowMs = input.recordedAtMs ?? Date.now();
  const prevSig = input.ledger.records[input.ledger.records.length - 1]!.sig;
  const body: Omit<ConsequenceRecord, "sig"> = {
    v: PROTOCOL_VERSION,
    id: orig.id,
    cmd: orig.cmd,
    args: orig.args,
    resultDigest: orig.resultDigest,
    repoStateBefore: orig.repoStateBefore,
    repoStateAfter: input.repoStateAfter,
    deltaSummary: input.deltaSummary,
    recordedAtMs: orig.recordedAtMs,
    deltaRecordedAtMs: nowMs,
    prevSig,
  };
  const sig = signRecord(body, input.secret ?? defaultSecret());
  return {
    ledger: { v: PROTOCOL_VERSION, records: [...input.ledger.records, { ...body, sig }] },
    ok: true,
  };
}

export interface ConsequenceQuery {
  cmd: string;
  windowMs?: number;
  nowMs?: number;
}

export interface ConsequenceAggregate {
  cmd: string;
  totalRuns: number;
  runsWithDelta: number;
  averages: Record<string, number>;
  histograms: Record<string, Array<{ value: string; count: number }>>;
  oldestRunMs: number | null;
  newestRunMs: number | null;
}

/**
 * Aggregate delta summaries for a given cmd. Numeric fields → mean over
 * runs with a recorded delta. Non-numeric fields → top-5 most common values
 * with counts. Pure read; no side effects.
 */
export function queryConsequences(opts: { ledger: ConsequenceLedger } & ConsequenceQuery): ConsequenceAggregate {
  const nowMs = opts.nowMs ?? Date.now();
  const windowStart = typeof opts.windowMs === "number" ? nowMs - opts.windowMs : -Infinity;
  // Latest record per id. Preference: a record with deltaSummary set wins
  // over one without; among records of the same kind, the latest-appended wins.
  // Iterating in insertion order and always overwriting preserves that.
  const byId = new Map<string, ConsequenceRecord>();
  for (const r of opts.ledger.records) {
    if (r.cmd !== opts.cmd) continue;
    if (r.recordedAtMs < windowStart) continue;
    const prev = byId.get(r.id);
    if (!prev) { byId.set(r.id, r); continue; }
    if (prev.deltaSummary === null && r.deltaSummary !== null) { byId.set(r.id, r); continue; }
    if (prev.deltaSummary !== null && r.deltaSummary === null) continue;
    // both same kind → keep the later one (records are appended in order, so r is later)
    byId.set(r.id, r);
  }
  const all = Array.from(byId.values());
  const withDelta = all.filter((r) => r.deltaSummary !== null);
  // Numeric aggregates
  const numSums = new Map<string, { sum: number; count: number }>();
  const strCounts = new Map<string, Map<string, number>>();
  for (const r of withDelta) {
    for (const [k, v] of Object.entries(r.deltaSummary!)) {
      if (typeof v === "number" && Number.isFinite(v)) {
        const entry = numSums.get(k) ?? { sum: 0, count: 0 };
        entry.sum += v;
        entry.count++;
        numSums.set(k, entry);
      } else {
        const stringified = String(v);
        const m = strCounts.get(k) ?? new Map<string, number>();
        m.set(stringified, (m.get(stringified) ?? 0) + 1);
        strCounts.set(k, m);
      }
    }
  }
  const averages: Record<string, number> = {};
  for (const [k, { sum, count }] of numSums) averages[k] = sum / count;
  const histograms: Record<string, Array<{ value: string; count: number }>> = {};
  for (const [k, m] of strCounts) {
    histograms[k] = Array.from(m.entries())
      .map(([value, count]) => ({ value, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 5);
  }
  const times = all.map((r) => r.recordedAtMs);
  return {
    cmd: opts.cmd,
    totalRuns: all.length,
    runsWithDelta: withDelta.length,
    averages,
    histograms,
    oldestRunMs: times.length ? Math.min(...times) : null,
    newestRunMs: times.length ? Math.max(...times) : null,
  };
}

export function verifyConsequenceLedger(ledger: ConsequenceLedger, secret?: string): { ok: boolean; brokenAt?: number; reason?: string } {
  const sec = secret ?? defaultSecret();
  let prevSig: string | null = null;
  for (let i = 0; i < ledger.records.length; i++) {
    const r = ledger.records[i]!;
    const { sig, ...body } = r;
    if (body.prevSig !== prevSig) {
      return { ok: false, brokenAt: i, reason: `prevSig mismatch at step ${i}` };
    }
    if (!safeEqHex(signRecord(body, sec), sig)) {
      return { ok: false, brokenAt: i, reason: `HMAC mismatch at step ${i}` };
    }
    prevSig = sig;
  }
  return { ok: true };
}

export function listRecentRuns(ledger: ConsequenceLedger, opts: { limit?: number } = {}): ConsequenceRecord[] {
  const limit = opts.limit ?? 20;
  const byId = new Map<string, ConsequenceRecord>();
  for (const r of ledger.records) {
    const prev = byId.get(r.id);
    if (!prev) { byId.set(r.id, r); continue; }
    if (prev.deltaSummary === null && r.deltaSummary !== null) { byId.set(r.id, r); continue; }
    if (prev.deltaSummary !== null && r.deltaSummary === null) continue;
    byId.set(r.id, r);
  }
  return Array.from(byId.values())
    .sort((a, b) => b.recordedAtMs - a.recordedAtMs)
    .slice(0, limit);
}

export function formatConsequenceLine(a: ConsequenceAggregate): string {
  const summary = Object.entries(a.averages)
    .map(([k, v]) => `${k}=${v.toFixed(1)}`)
    .slice(0, 3)
    .join(", ");
  return `⏳ CSQ · ${a.cmd} · runs=${a.totalRuns} (delta=${a.runsWithDelta}) · avg{ ${summary} }`;
}
