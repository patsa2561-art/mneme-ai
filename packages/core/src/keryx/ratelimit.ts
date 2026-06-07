/**
 * KERYX RATE LIMIT — a tiny, deterministic token-bucket so the public relay endpoints can't be
 * flooded (DoS) by an attacker hammering /keryx/webhook · /pair-register · /drain. Per-key (IP for
 * the open endpoints, daemonId for the authed drain): a burst capacity that refills at a steady rate.
 * Pure + total — the relay holds the bucket map in process memory (ephemeral, never on disk) and
 * prunes idle keys so the limiter itself can't grow unbounded.
 *
 * ★HONEST (DIAKRISIS): this is an application-layer throttle (per-key burst+rate) — it blunts a
 * naive flood and protects the single relay's CPU/disk, NOT a substitute for network-edge DDoS
 * protection (Caddy/Cloudflare) against a large distributed attack. Defense in depth, not a force field.
 */
export interface Bucket { tokens: number; last: number }
export interface RateState { [key: string]: Bucket }
export interface RateOpts { burst: number; refillPerSec: number }

/** Consume one token for `key`. Returns allowed + how long until the next token if blocked. Mutates st. */
export function checkRate(st: RateState, key: string, now: number, opts: RateOpts): { allowed: boolean; retryAfterMs: number; remaining: number } {
  if (!st || typeof st !== "object") return { allowed: true, retryAfterMs: 0, remaining: 0 };   // total: no store ⇒ don't block
  const burst = Math.max(1, Number(opts?.burst) || 1);
  const refillPerMs = Math.max(0, Number(opts?.refillPerSec) || 0) / 1000;
  const k = String(key || "anon");
  const b = st[k] ?? { tokens: burst, last: now };
  b.tokens = Math.min(burst, b.tokens + Math.max(0, now - b.last) * refillPerMs);
  b.last = now;
  if (b.tokens >= 1) { b.tokens -= 1; st[k] = b; return { allowed: true, retryAfterMs: 0, remaining: Math.floor(b.tokens) }; }
  const retryAfterMs = refillPerMs > 0 ? Math.ceil((1 - b.tokens) / refillPerMs) : 60_000;
  st[k] = b;
  return { allowed: false, retryAfterMs, remaining: 0 };
}

/** Drop buckets untouched for `idleMs` (bounded memory). Call periodically or every N requests. */
export function pruneRate(st: RateState, now: number, idleMs = 600_000): void {
  if (!st || typeof st !== "object") return;
  for (const k of Object.keys(st)) { if (now - (st[k]?.last ?? 0) > idleMs) delete st[k]; }
}

// per-endpoint policy (burst, sustained/sec) — generous for real providers, tight enough to blunt a flood
export const RATE_POLICY: Record<string, RateOpts> = {
  "pair-register": { burst: 20, refillPerSec: 0.2 },   // pairing is rare
  webhook: { burst: 120, refillPerSec: 10 },           // providers can batch
  drain: { burst: 240, refillPerSec: 4 },              // the daemon polls ~every 3s
  expect: { burst: 60, refillPerSec: 2 },
};

// ── gauntlet ──────────────────────────────────────────────────────────────────
export interface RateGauntlet { score: 0 | 100; checks: Array<{ name: string; pass: boolean; detail: string }> }
export function rateGauntlet(): RateGauntlet {
  const opts: RateOpts = { burst: 5, refillPerSec: 1 };
  // burst: first 5 allowed, 6th blocked
  let st: RateState = {}; let allowed = 0;
  for (let i = 0; i < 5; i++) if (checkRate(st, "ip1", 1000, opts).allowed) allowed++;
  const sixth = checkRate(st, "ip1", 1000, opts);
  const burstOK = allowed === 5 && !sixth.allowed && sixth.retryAfterMs > 0;

  // refill: after 3s (3 tokens at 1/s), 3 more allowed
  let refilled = 0; for (let i = 0; i < 4; i++) if (checkRate(st, "ip1", 4000, opts).allowed) refilled++;
  const refillOK = refilled === 3;

  // isolation: a different key has its own full bucket
  const otherOK = checkRate(st, "ip2", 1000, opts).allowed === true;

  // prune: an idle key is dropped, a fresh one kept
  const st2: RateState = { old: { tokens: 0, last: 1000 }, fresh: { tokens: 1, last: 600000 } };
  pruneRate(st2, 700000, 600000);
  const pruneOK = !("old" in st2) && "fresh" in st2;

  // a zero/negative refill never divides-by-zero + still blocks past burst
  const st3: RateState = {}; checkRate(st3, "x", 0, { burst: 1, refillPerSec: 0 });
  const blocked = checkRate(st3, "x", 0, { burst: 1, refillPerSec: 0 });
  const safeOK = !blocked.allowed && Number.isFinite(blocked.retryAfterMs);

  const total = (() => { try { checkRate(null as never, "", 0, null as never); pruneRate(null as never, 0); return true; } catch { return false; } })();

  const checks = [
    { name: "BURST-THEN-BLOCK", pass: burstOK, detail: "first `burst` requests pass, the next is blocked with a retry-after" },
    { name: "REFILL-OVER-TIME", pass: refillOK, detail: "tokens refill at the steady rate (3s → 3 more at 1/s)" },
    { name: "PER-KEY-ISOLATION", pass: otherOK, detail: "each key (IP/daemon) has its own bucket — one flooder can't starve others" },
    { name: "PRUNE-BOUNDED-MEMORY", pass: pruneOK, detail: "idle buckets are dropped — the limiter can't grow unbounded" },
    { name: "DIV0-SAFE", pass: safeOK, detail: "a zero refill rate never NaNs + still blocks past burst" },
    { name: "TOTAL", pass: total, detail: "never throws on garbage/null" },
  ];
  return { score: checks.every((c) => c.pass) ? 100 : 0, checks };
}
