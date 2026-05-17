import { describe, it, expect } from "vitest";
import { classifyEvent, routeEvent, formatRoute, type ThalamusEvent, type RouteContext, type TierHandlers } from "./index.js";

const SECRET = "thalamus-test-secret-997744";

function evt(kind: ThalamusEvent["kind"], ts = 1): ThalamusEvent {
  return { v: 1, kind, context: {}, ts };
}

function ctx(over: Partial<RouteContext> = {}): RouteContext {
  return { hasReflexCacheHit: false, daemonAlive: true, idleMs: 0, ...over };
}

describe("v2.19.23 THALAMUS · classifyEvent (deterministic routing)", () => {
  it("daemon dead -> breath (highest priority)", () => {
    const d = classifyEvent({ event: evt("tool_call"), context: ctx({ daemonAlive: false }), secret: SECRET });
    expect(d.tier).toBe("breath");
    expect(d.reason).toContain("daemon_dead");
  });

  it("daemon alive + cache hit -> reflex", () => {
    const d = classifyEvent({ event: evt("tool_call"), context: ctx({ hasReflexCacheHit: true }), secret: SECRET });
    expect(d.tier).toBe("reflex");
    expect(d.reason).toContain("cache_hit");
  });

  it("daemon alive + no cache + active -> cortex (fallback)", () => {
    const d = classifyEvent({ event: evt("tool_call"), context: ctx({ idleMs: 100 }), secret: SECRET });
    expect(d.tier).toBe("cortex");
    expect(d.reason).toContain("no_cache");
  });

  it("explicit idle_tick event -> dream regardless of idleMs", () => {
    const d = classifyEvent({ event: evt("idle_tick"), context: ctx(), secret: SECRET });
    expect(d.tier).toBe("dream");
    expect(d.reason).toContain("idle");
  });

  it("idleMs > threshold -> dream", () => {
    const d = classifyEvent({
      event: evt("tool_call"),
      context: ctx({ idleMs: 31 * 60 * 1000, dreamIdleThresholdMs: 30 * 60 * 1000 }),
      secret: SECRET,
    });
    expect(d.tier).toBe("dream");
  });

  it("breath beats cache_hit beats dream beats cortex (priority order)", () => {
    const allTriggers = ctx({ hasReflexCacheHit: true, idleMs: 9_999_999, daemonAlive: false });
    expect(classifyEvent({ event: evt("idle_tick"), context: allTriggers, secret: SECRET }).tier).toBe("breath");
    expect(classifyEvent({ event: evt("idle_tick"), context: { ...allTriggers, daemonAlive: true }, secret: SECRET }).tier).toBe("reflex");
    expect(classifyEvent({ event: evt("idle_tick"), context: { ...allTriggers, daemonAlive: true, hasReflexCacheHit: false }, secret: SECRET }).tier).toBe("dream");
  });

  it("MEASURED 100% determinism: same input -> same HMAC sig (50 trials)", () => {
    const input = { event: evt("tool_call", 42), context: ctx({ hasReflexCacheHit: true }), secret: SECRET };
    const firstSig = classifyEvent(input).sig;
    let allEqual = true;
    for (let i = 0; i < 50; i++) {
      if (classifyEvent(input).sig !== firstSig) { allEqual = false; break; }
    }
    expect(allEqual).toBe(true);
  });
});

describe("v2.19.23 THALAMUS · routeEvent (dispatch)", () => {
  function mkHandlers(): { handlers: TierHandlers<string>; calls: Record<string, number> } {
    const calls: Record<string, number> = { reflex: 0, cortex: 0, dream: 0, breath: 0 };
    return {
      handlers: {
        reflex: async () => { calls["reflex"]!++; return "reflex_result"; },
        cortex: async () => { calls["cortex"]!++; return "cortex_result"; },
        dream:  async () => { calls["dream"]!++;  return "dream_result"; },
        breath: async () => { calls["breath"]!++; return "breath_result"; },
      },
      calls,
    };
  }

  it("routes to reflex handler on cache_hit", async () => {
    const { handlers, calls } = mkHandlers();
    const r = await routeEvent({ event: evt("tool_call"), context: ctx({ hasReflexCacheHit: true }), handlers, secret: SECRET });
    expect(r.decision.tier).toBe("reflex");
    expect(r.result).toBe("reflex_result");
    expect(calls).toEqual({ reflex: 1, cortex: 0, dream: 0, breath: 0 });
  });

  it("routes to breath handler when daemon dead (highest priority)", async () => {
    const { handlers, calls } = mkHandlers();
    const r = await routeEvent({ event: evt("tool_call"), context: ctx({ daemonAlive: false, hasReflexCacheHit: true }), handlers, secret: SECRET });
    expect(r.decision.tier).toBe("breath");
    expect(r.result).toBe("breath_result");
    expect(calls["breath"]).toBe(1);
    expect(calls["reflex"]).toBe(0);
  });

  it("routes to dream handler on idle_tick", async () => {
    const { handlers, calls } = mkHandlers();
    const r = await routeEvent({ event: evt("idle_tick"), context: ctx(), handlers, secret: SECRET });
    expect(r.decision.tier).toBe("dream");
    expect(calls["dream"]).toBe(1);
  });
});

describe("v2.19.23 THALAMUS · formatter", () => {
  it("formatRoute uses ⚡/🧠/💤/🫁 per tier", () => {
    expect(formatRoute({ v: 1, tier: "reflex", reason: "x", sig: "" })).toContain("⚡");
    expect(formatRoute({ v: 1, tier: "cortex", reason: "x", sig: "" })).toContain("🧠");
    expect(formatRoute({ v: 1, tier: "dream", reason: "x", sig: "" })).toContain("💤");
    expect(formatRoute({ v: 1, tier: "breath", reason: "x", sig: "" })).toContain("🫁");
  });
});
