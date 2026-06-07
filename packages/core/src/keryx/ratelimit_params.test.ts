import { describe, it, expect } from "vitest";
import { checkRate, pruneRate, RATE_POLICY } from "./ratelimit.js";
import type { RateState } from "./ratelimit.js";

describe("ratelimit · checkRate — every parameter", () => {
  it("allows exactly `burst` requests, then blocks", () => {
    const st: RateState = {}; const o = { burst: 3, refillPerSec: 0 };
    expect(checkRate(st, "k", 0, o).allowed).toBe(true);
    expect(checkRate(st, "k", 0, o).allowed).toBe(true);
    expect(checkRate(st, "k", 0, o).allowed).toBe(true);
    expect(checkRate(st, "k", 0, o).allowed).toBe(false);
  });
  it("remaining counts down from burst-1", () => {
    const st: RateState = {};
    expect(checkRate(st, "k", 0, { burst: 5, refillPerSec: 0 }).remaining).toBe(4);
    expect(checkRate(st, "k", 0, { burst: 5, refillPerSec: 0 }).remaining).toBe(3);
  });
  it("retryAfterMs is positive when blocked, 0 when allowed", () => {
    const st: RateState = {}; const o = { burst: 1, refillPerSec: 1 };
    expect(checkRate(st, "k", 0, o).retryAfterMs).toBe(0);
    const blocked = checkRate(st, "k", 0, o);
    expect(blocked.allowed).toBe(false); expect(blocked.retryAfterMs).toBeGreaterThan(0);
  });
  it("refills at refillPerSec (1 token per 1000ms)", () => {
    const st: RateState = {}; const o = { burst: 1, refillPerSec: 1 };
    checkRate(st, "k", 0, o);                       // consume the 1 token
    expect(checkRate(st, "k", 500, o).allowed).toBe(false);   // 0.5 token after 500ms
    expect(checkRate(st, "k", 1000, o).allowed).toBe(true);   // 1 token after 1000ms
  });
  it("tokens never exceed burst (no over-refill after idle)", () => {
    const st: RateState = {}; const o = { burst: 2, refillPerSec: 10 };
    checkRate(st, "k", 0, o);
    let allowed = 0; for (let i = 0; i < 10; i++) if (checkRate(st, "k", 1_000_000, o).allowed) allowed++;
    expect(allowed).toBe(2);   // capped at burst, not 10
  });
  it("per-key isolation — one key's exhaustion doesn't affect another", () => {
    const st: RateState = {}; const o = { burst: 1, refillPerSec: 0 };
    checkRate(st, "a", 0, o); checkRate(st, "a", 0, o);
    expect(checkRate(st, "b", 0, o).allowed).toBe(true);
  });
  it("burst < 1 is clamped to 1 (no zero-capacity lockout)", () => {
    const st: RateState = {};
    expect(checkRate(st, "k", 0, { burst: 0, refillPerSec: 0 }).allowed).toBe(true);
  });
  it("refillPerSec 0 → blocks past burst with a finite retry (no div0/NaN)", () => {
    const st: RateState = {}; checkRate(st, "k", 0, { burst: 1, refillPerSec: 0 });
    const b = checkRate(st, "k", 0, { burst: 1, refillPerSec: 0 });
    expect(b.allowed).toBe(false); expect(Number.isFinite(b.retryAfterMs)).toBe(true);
  });
  it("null/garbage opts + null store never throw (total)", () => {
    expect(() => checkRate({}, "k", 0, null as never)).not.toThrow();
    expect(checkRate(null as never, "k", 0, { burst: 1, refillPerSec: 1 }).allowed).toBe(true);
  });
});

describe("ratelimit · pruneRate", () => {
  it("drops idle keys, keeps recent ones", () => {
    const st: RateState = { old: { tokens: 0, last: 0 }, recent: { tokens: 1, last: 999_000 } };
    pruneRate(st, 1_000_000, 600_000);
    expect("old" in st).toBe(false); expect("recent" in st).toBe(true);
  });
  it("null store → no throw", () => { expect(() => pruneRate(null as never, 0)).not.toThrow(); });
});

describe("ratelimit · RATE_POLICY", () => {
  it("defines burst+refill for every public endpoint", () => {
    for (const k of ["pair-register", "webhook", "drain", "expect"]) {
      expect(RATE_POLICY[k].burst).toBeGreaterThan(0);
      expect(RATE_POLICY[k].refillPerSec).toBeGreaterThan(0);
    }
  });
  it("pairing is the tightest (rare op), drain the loosest (daemon polls)", () => {
    expect(RATE_POLICY["pair-register"].burst).toBeLessThan(RATE_POLICY["drain"].burst);
  });
});
