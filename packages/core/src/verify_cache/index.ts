/**
 * v2.19.51 VERIFY CACHE — concurrency-coalescing memo for the verify hot path.
 *
 * The bug it kills: user reported `mneme verify` regressed 9x under
 * 50-parallel load (58ms/call v2.19.46 → 524ms/call v2.19.49).
 * Root cause: every parallel verify rebuilt the MCP catalog (buildAllTools)
 * AND walked the filesystem (countMnemeTools), 50× over. Pure waste —
 * the catalog only changes at npm install; the file tree doesn't change
 * during a 100ms verify-storm.
 *
 * This module is a tiny, generic memo with two properties no LangChain /
 * Helicone / Portkey / Vellum cache layer composes together:
 *   1. TTL-bounded verdict memo (key = claim hash, value = verdict).
 *   2. Concurrency coalescing — if 50 callers ask for the same key in
 *      parallel, only ONE compute() runs; the other 49 await its promise.
 *      No double work, no double I/O, no double LLM call.
 *
 * Why this is the right shape:
 *   - Generic — wraps any `() => Promise<T>`, not just verify. Other
 *     hot paths (capabilities, intent, honesty) can adopt the same hook.
 *   - Bounded — MAX_MEMO_ENTRIES caps memory; oldest evicted first.
 *   - Failure-resilient — on compute() throw, the in-flight entry is
 *     released (no permanent poison) and the throw propagates to ALL
 *     coalesced awaiters (they all see the same error simultaneously).
 *   - Side-effect-free — no disk I/O, no telemetry, no HMAC chain. Pure
 *     in-process memo. Safe to drop in anywhere.
 *
 * Default TTL is short (5s) because verify verdicts can change as files
 * change. Callers can pass `ttlMs` to override (e.g., catalog memo uses
 * 30s because the catalog is stable until npm install).
 */

export interface VerifyCacheStats {
  memoSize: number;
  inflightSize: number;
  totalHits: number;
  totalMisses: number;
  totalCoalesced: number;
}

const DEFAULT_TTL_MS = 5_000;
const MAX_MEMO_ENTRIES = 1000;

// v2.19.52 — store per-entry TTL at write time so the READ honors the
// TTL chosen by the WRITER. Previously the read's opts.ttlMs was used
// as the freshness window, which let a long-TTL read resurrect a
// short-TTL write. Now we use min(storedTtl, readTtl) — both sides
// can shorten the window, neither can extend.
interface MemoEntry<T> { result: T; ts: number; ttlMs: number }

const verdictMemo = new Map<string, MemoEntry<unknown>>();
const inflight = new Map<string, Promise<unknown>>();
let totalHits = 0;
let totalMisses = 0;
let totalCoalesced = 0;

/**
 * Memoize + concurrency-coalesce an async compute by `key`.
 *
 * Semantics:
 *   1. Cache hit within TTL → return cached value immediately.
 *   2. Cache miss + no in-flight → run compute(), cache + return.
 *   3. Cache miss + IN-FLIGHT for same key → await the in-flight promise
 *      (coalesced — 50 parallel callers, 1 compute).
 *   4. compute() throws → cache NOT populated; in-flight cleared;
 *      throw propagates to ALL awaiters.
 *
 * The bound: when memo exceeds MAX_MEMO_ENTRIES, the oldest entries
 * are evicted by ts. Cheap O(n log n) sort; only fires on growth.
 */
export async function withVerifyCache<T>(
  key: string,
  compute: () => Promise<T>,
  opts?: { ttlMs?: number },
): Promise<T> {
  const ttl = opts?.ttlMs ?? DEFAULT_TTL_MS;
  const now = Date.now();

  const hit = verdictMemo.get(key);
  if (hit && (now - hit.ts) < Math.min(hit.ttlMs, ttl)) {
    totalHits++;
    return hit.result as T;
  }

  const pending = inflight.get(key);
  if (pending) {
    totalCoalesced++;
    return pending as Promise<T>;
  }

  totalMisses++;
  const p = (async () => {
    try {
      const r = await compute();
      verdictMemo.set(key, { result: r, ts: Date.now(), ttlMs: ttl });
      if (verdictMemo.size > MAX_MEMO_ENTRIES) {
        const sorted = [...verdictMemo.entries()].sort((a, b) => a[1].ts - b[1].ts);
        const evict = sorted.slice(0, verdictMemo.size - MAX_MEMO_ENTRIES);
        for (const [k] of evict) verdictMemo.delete(k);
      }
      return r;
    } finally {
      inflight.delete(key);
    }
  })();
  inflight.set(key, p as Promise<unknown>);
  return p;
}

/**
 * Synchronous variant for cheap pure-function memos (e.g., catalog spread).
 * No concurrency coalescing — JS is single-threaded for sync code, so the
 * race condition doesn't exist.
 */
export function syncMemo<T>(
  key: string,
  compute: () => T,
  opts?: { ttlMs?: number },
): T {
  const ttl = opts?.ttlMs ?? DEFAULT_TTL_MS;
  const now = Date.now();
  const hit = verdictMemo.get(key);
  if (hit && (now - hit.ts) < Math.min(hit.ttlMs, ttl)) {
    totalHits++;
    return hit.result as T;
  }
  totalMisses++;
  const r = compute();
  verdictMemo.set(key, { result: r, ts: Date.now(), ttlMs: ttl });
  if (verdictMemo.size > MAX_MEMO_ENTRIES) {
    const sorted = [...verdictMemo.entries()].sort((a, b) => a[1].ts - b[1].ts);
    const evict = sorted.slice(0, verdictMemo.size - MAX_MEMO_ENTRIES);
    for (const [k] of evict) verdictMemo.delete(k);
  }
  return r;
}

/** For tests + ritual cleanup. Clears memo + in-flight + counters. */
export function _resetVerifyCache(): void {
  verdictMemo.clear();
  inflight.clear();
  totalHits = 0;
  totalMisses = 0;
  totalCoalesced = 0;
}

export function verifyCacheStats(): VerifyCacheStats {
  return {
    memoSize: verdictMemo.size,
    inflightSize: inflight.size,
    totalHits,
    totalMisses,
    totalCoalesced,
  };
}

/**
 * Helper: deterministic claim key. Strips trivial whitespace differences
 * so 'X is registered' and 'X  is  registered' collapse to one cache slot.
 * Does NOT lowercase — claim case is semantically meaningful (file paths).
 */
export function claimKey(claim: string, salt?: string): string {
  const normalised = claim.trim().replace(/\s+/g, " ");
  return salt ? `${salt}::${normalised}` : normalised;
}
