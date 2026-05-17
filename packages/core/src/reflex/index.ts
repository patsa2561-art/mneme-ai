/**
 * v2.19.22 — MNEME REFLEX (FLAGSHIP) · Automatic Pre-Execution Layer
 *
 *   "Every AI tool today is request → response. Mneme is the FIRST AI
 *    layer that pre-executes the tools an AI agent is about to call,
 *    based on what the user just did on their machine. By the time the
 *    AI agent asks, the answer is already in cache. 200ms cold ladder
 *    becomes ~0ms cached. The competitive moat is not the algorithm —
 *    it's the daemon + pheromone trail + local-first usage history.
 *    No SaaS competitor can ship this because they don't live on the
 *    user's machine."
 *
 * Pipeline:
 *   user event (file_save / git_commit / terminal_command / user_chat)
 *         ↓
 *   recordObservation(event, followupToolCall)     ← HMAC-chained pheromone store
 *         ↓
 *   later same event recurs:
 *         ↓
 *   predictFollowup(event, store)                  ← top-N tools by frequency
 *         ↓
 *   prefetch(predictions, invokeFn, budget=200ms)  ← concurrent, budget-bound
 *         ↓
 *   writeCacheEntry per result                     ← TTL=5min, HMAC-signed
 *         ↓
 *   AI agent asks: readCache(event, toolName) → INSTANT HIT (0ms)
 *
 * Honest scope:
 *   - PROTOCOL + STORE + PREDICTOR + CACHE + PREFETCH EXECUTOR ship now.
 *     Event detector lives in caller (daemon / shell hook / git hook).
 *   - PREDICTOR is frequency-based (no ML); deliberately deterministic so
 *     same store → same predictions. Confidence = matches / total within
 *     event signature.
 *   - CACHE is content-addressed on event signature + toolName + args.
 *     HMAC-signed entries; tampered entries refuse to hit.
 *   - PREFETCH uses Promise.race against budget. A slow tool gets killed
 *     at budgetMs and reported in `executed[i].ok = false`. Never blocks.
 *   - Persistence is CALLER'S job (daemon writes store/cache to disk).
 *     Mneme returns updated value; caller persists. Same pattern as
 *     v2.19.16 FEDERATED, v2.19.20 RCI, v2.19.21 SNN AUTO-PROMOTE.
 *   - Refuses to leak: cache entry only readable for matching event sig
 *     + toolName + (optionally) args predicate. No cross-event leakage.
 */

import { createHmac, timingSafeEqual } from "node:crypto";

const PROTOCOL_VERSION = 1 as const;
const DEFAULT_TTL_MS = 5 * 60 * 1000;
const DEFAULT_PREFETCH_BUDGET_MS = 200;
const DEFAULT_TOP_N = 3;

export type EventKind = "file_save" | "git_commit" | "terminal_command" | "user_chat" | "tool_call";

export interface ReflexEvent {
  v: typeof PROTOCOL_VERSION;
  kind: EventKind;
  /** Canonicalised context (sort keys; strip transient fields like cursorPos). */
  context: Record<string, unknown>;
  ts: number;
}

export interface FollowupToolCall {
  toolName: string;
  args: Record<string, unknown>;
  ts: number;
}

export interface PheromoneRecord {
  v: typeof PROTOCOL_VERSION;
  event: ReflexEvent;
  followup: FollowupToolCall;
  prevSig: string | null;
  sig: string;
}

export interface PheromoneStore {
  v: typeof PROTOCOL_VERSION;
  records: PheromoneRecord[];
}

export interface ReflexCacheEntry {
  v: typeof PROTOCOL_VERSION;
  eventKey: string;
  toolName: string;
  args: Record<string, unknown>;
  result: unknown;
  ts: number;
  ttlMs: number;
  sig: string;
}

export interface ReflexCache {
  v: typeof PROTOCOL_VERSION;
  entries: Record<string, ReflexCacheEntry[]>;
}

export interface Prediction {
  toolName: string;
  argsTemplate: Record<string, unknown>;
  confidence: number;
  sampleCount: number;
}

export interface PrefetchExecution {
  toolName: string;
  ms: number;
  ok: boolean;
  error?: string;
}

export interface PrefetchResult {
  cache: ReflexCache;
  executed: PrefetchExecution[];
  totalMs: number;
  budgetMs: number;
  withinBudget: boolean;
}

export interface ReflexStats {
  totalRecords: number;
  uniqueEventSigs: number;
  topToolsByFrequency: Array<{ toolName: string; count: number }>;
  totalCacheEntries: number;
  expiredCacheEntries: number;
  freshCacheEntries: number;
  /** hit / (hit + miss); 0 if no fetches recorded. */
  hitRate: number;
  totalHits: number;
  totalMisses: number;
}

// ─── canonical helpers ────────────────────────────────────────────────

function canon(v: unknown): string {
  if (v === null || typeof v !== "object") return JSON.stringify(v);
  if (Array.isArray(v)) return "[" + v.map(canon).join(",") + "]";
  const keys = Object.keys(v as Record<string, unknown>).sort();
  return "{" + keys.map((k) => JSON.stringify(k) + ":" + canon((v as Record<string, unknown>)[k])).join(",") + "}";
}

function defaultSecret(): string {
  return process.env["MNEME_REFLEX_SECRET"] || `mneme-reflex-v${PROTOCOL_VERSION}`;
}

function hmacHex(body: unknown, secret: string): string {
  return createHmac("sha256", secret).update(canon(body)).digest("hex");
}

function safeEqHex(a: string, b: string): boolean {
  try { return timingSafeEqual(Buffer.from(a, "hex"), Buffer.from(b, "hex")); }
  catch { return false; }
}

/** Stable signature over the EVENT (kind + context only — NOT ts). */
export function eventCacheKey(event: ReflexEvent): string {
  const body = { kind: event.kind, context: event.context };
  return createHmac("sha256", "mneme-reflex-cache-key").update(canon(body)).digest("hex").slice(0, 16);
}

// ─── pheromone store ──────────────────────────────────────────────────

export function emptyStore(): PheromoneStore {
  return { v: PROTOCOL_VERSION, records: [] };
}

export function recordObservation(input: {
  store: PheromoneStore;
  event: ReflexEvent;
  followup: FollowupToolCall;
  secret?: string;
}): PheromoneStore {
  const prev = input.store.records[input.store.records.length - 1];
  const body: Omit<PheromoneRecord, "sig"> = {
    v: PROTOCOL_VERSION,
    event: input.event,
    followup: input.followup,
    prevSig: prev ? prev.sig : null,
  };
  const sig = hmacHex(body, input.secret ?? defaultSecret());
  return {
    v: PROTOCOL_VERSION,
    records: [...input.store.records, { ...body, sig }],
  };
}

export function verifyStore(store: PheromoneStore, secret?: string): { ok: boolean; brokenAt?: number; reason?: string } {
  const sec = secret ?? defaultSecret();
  let prevSig: string | null = null;
  for (let i = 0; i < store.records.length; i++) {
    const r = store.records[i]!;
    const { sig, ...body } = r;
    if (body.prevSig !== prevSig) return { ok: false, brokenAt: i, reason: `prevSig mismatch at step ${i}` };
    if (!safeEqHex(hmacHex(body, sec), sig)) return { ok: false, brokenAt: i, reason: `HMAC mismatch at step ${i}` };
    prevSig = sig;
  }
  return { ok: true };
}

// ─── predictor ────────────────────────────────────────────────────────

/**
 * Returns top-N likely follow-up tools for the given event, ordered by
 * frequency in the pheromone store. Confidence = matches / total within
 * the event signature group.
 *
 * Deterministic: same store + same event → same predictions.
 */
export function predictFollowup(input: {
  store: PheromoneStore;
  event: ReflexEvent;
  topN?: number;
}): Prediction[] {
  const topN = input.topN ?? DEFAULT_TOP_N;
  const eventSig = eventCacheKey(input.event);
  const matching = input.store.records.filter((r) => eventCacheKey(r.event) === eventSig);
  if (matching.length === 0) return [];
  const counts = new Map<string, { count: number; argsTemplate: Record<string, unknown> }>();
  for (const r of matching) {
    const prev = counts.get(r.followup.toolName);
    if (prev) {
      prev.count++;
      prev.argsTemplate = r.followup.args;
    } else {
      counts.set(r.followup.toolName, { count: 1, argsTemplate: r.followup.args });
    }
  }
  const total = matching.length;
  return Array.from(counts.entries())
    .map(([toolName, { count, argsTemplate }]) => ({
      toolName,
      argsTemplate,
      confidence: count / total,
      sampleCount: count,
    }))
    .sort((a, b) => b.confidence - a.confidence || a.toolName.localeCompare(b.toolName))
    .slice(0, topN);
}

// ─── cache ────────────────────────────────────────────────────────────

export function emptyCache(): ReflexCache {
  return { v: PROTOCOL_VERSION, entries: {} };
}

export function writeCacheEntry(input: {
  cache: ReflexCache;
  event: ReflexEvent;
  toolName: string;
  args: Record<string, unknown>;
  result: unknown;
  ttlMs?: number;
  nowMs?: number;
  secret?: string;
}): ReflexCache {
  const eventKey = eventCacheKey(input.event);
  const ts = input.nowMs ?? Date.now();
  const ttl = input.ttlMs ?? DEFAULT_TTL_MS;
  const body: Omit<ReflexCacheEntry, "sig"> = {
    v: PROTOCOL_VERSION,
    eventKey,
    toolName: input.toolName,
    args: input.args,
    result: input.result,
    ts,
    ttlMs: ttl,
  };
  const sig = hmacHex(body, input.secret ?? defaultSecret());
  const entry: ReflexCacheEntry = { ...body, sig };
  const existing = input.cache.entries[eventKey] ?? [];
  return {
    v: PROTOCOL_VERSION,
    entries: { ...input.cache.entries, [eventKey]: [...existing, entry] },
  };
}

export function readCache(input: {
  cache: ReflexCache;
  event: ReflexEvent;
  toolName: string;
  argsMatch?: (args: Record<string, unknown>) => boolean;
  nowMs?: number;
  secret?: string;
}): { hit: boolean; entry?: ReflexCacheEntry; reason?: string } {
  const eventKey = eventCacheKey(input.event);
  const now = input.nowMs ?? Date.now();
  const sec = input.secret ?? defaultSecret();
  const entries = input.cache.entries[eventKey] ?? [];
  for (let i = entries.length - 1; i >= 0; i--) {
    const e = entries[i]!;
    if (e.toolName !== input.toolName) continue;
    if (input.argsMatch && !input.argsMatch(e.args)) continue;
    if (now > e.ts + e.ttlMs) continue;
    const { sig, ...body } = e;
    if (!safeEqHex(hmacHex(body, sec), sig)) {
      return { hit: false, reason: "HMAC mismatch -- cache entry tampered" };
    }
    return { hit: true, entry: e };
  }
  return { hit: false, reason: "no fresh entry" };
}

/** Drops expired entries; returns compacted cache. Pure. */
export function gcCache(input: { cache: ReflexCache; nowMs?: number }): { cache: ReflexCache; removed: number } {
  const now = input.nowMs ?? Date.now();
  const newEntries: Record<string, ReflexCacheEntry[]> = {};
  let removed = 0;
  for (const [k, arr] of Object.entries(input.cache.entries)) {
    const kept = arr.filter((e) => now <= e.ts + e.ttlMs);
    removed += arr.length - kept.length;
    if (kept.length > 0) newEntries[k] = kept;
  }
  return { cache: { v: PROTOCOL_VERSION, entries: newEntries }, removed };
}

// ─── prefetch executor ────────────────────────────────────────────────

/**
 * Concurrent prefetch of up to N candidate tool calls, each raced against
 * a per-tool budget. Always returns within budgetMs + small dispatch
 * overhead — even if individual tools hang. Failed calls land in
 * `executed[i].ok = false` and are NOT written to cache.
 */
export async function prefetch(input: {
  cache: ReflexCache;
  event: ReflexEvent;
  candidates: Array<{ toolName: string; args: Record<string, unknown> }>;
  invoke: (toolName: string, args: Record<string, unknown>) => Promise<unknown>;
  budgetMs?: number;
  ttlMs?: number;
  nowMs?: number;
  secret?: string;
}): Promise<PrefetchResult> {
  const budget = input.budgetMs ?? DEFAULT_PREFETCH_BUDGET_MS;
  const t0 = Date.now();
  let cache = input.cache;
  const executed: PrefetchExecution[] = [];
  await Promise.all(input.candidates.map(async (c) => {
    const start = Date.now();
    let timeoutHandle: NodeJS.Timeout | undefined;
    try {
      const result = await Promise.race([
        input.invoke(c.toolName, c.args),
        new Promise((_, reject) => {
          timeoutHandle = setTimeout(() => reject(new Error("prefetch_timeout")), budget);
        }),
      ]);
      if (timeoutHandle) clearTimeout(timeoutHandle);
      const ms = Date.now() - start;
      cache = writeCacheEntry({
        cache,
        event: input.event,
        toolName: c.toolName,
        args: c.args,
        result,
        ttlMs: input.ttlMs,
        nowMs: input.nowMs,
        secret: input.secret,
      });
      executed.push({ toolName: c.toolName, ms, ok: true });
    } catch (e) {
      if (timeoutHandle) clearTimeout(timeoutHandle);
      executed.push({ toolName: c.toolName, ms: Date.now() - start, ok: false, error: (e as Error).message });
    }
  }));
  const totalMs = Date.now() - t0;
  return { cache, executed, totalMs, budgetMs: budget, withinBudget: totalMs <= budget + 50 };
}

// ─── stats + telemetry ────────────────────────────────────────────────

export interface FetchTelemetry {
  hits: number;
  misses: number;
}

export function emptyTelemetry(): FetchTelemetry {
  return { hits: 0, misses: 0 };
}

export function recordFetch(input: { telemetry: FetchTelemetry; hit: boolean }): FetchTelemetry {
  return {
    hits: input.telemetry.hits + (input.hit ? 1 : 0),
    misses: input.telemetry.misses + (input.hit ? 0 : 1),
  };
}

export function computeStats(input: {
  store: PheromoneStore;
  cache: ReflexCache;
  telemetry?: FetchTelemetry;
  nowMs?: number;
}): ReflexStats {
  const now = input.nowMs ?? Date.now();
  const uniqueSigs = new Set(input.store.records.map((r) => eventCacheKey(r.event)));
  const toolCounts = new Map<string, number>();
  for (const r of input.store.records) {
    toolCounts.set(r.followup.toolName, (toolCounts.get(r.followup.toolName) ?? 0) + 1);
  }
  const topTools = Array.from(toolCounts.entries())
    .map(([toolName, count]) => ({ toolName, count }))
    .sort((a, b) => b.count - a.count || a.toolName.localeCompare(b.toolName))
    .slice(0, 10);
  let totalEntries = 0, expired = 0, fresh = 0;
  for (const eventEntries of Object.values(input.cache.entries)) {
    for (const e of eventEntries) {
      totalEntries++;
      if (now > e.ts + e.ttlMs) expired++;
      else fresh++;
    }
  }
  const t = input.telemetry ?? emptyTelemetry();
  const total = t.hits + t.misses;
  return {
    totalRecords: input.store.records.length,
    uniqueEventSigs: uniqueSigs.size,
    topToolsByFrequency: topTools,
    totalCacheEntries: totalEntries,
    expiredCacheEntries: expired,
    freshCacheEntries: fresh,
    hitRate: total === 0 ? 0 : t.hits / total,
    totalHits: t.hits,
    totalMisses: t.misses,
  };
}

export function formatStatsLine(s: ReflexStats): string {
  const hitPct = (s.hitRate * 100).toFixed(1);
  return `🥇 REFLEX · ${s.totalRecords} obs · ${s.uniqueEventSigs} events · ${s.freshCacheEntries}/${s.totalCacheEntries} fresh · hit-rate ${hitPct}% (${s.totalHits}/${s.totalHits + s.totalMisses})`;
}
