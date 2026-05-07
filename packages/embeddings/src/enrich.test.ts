/**
 * Tests for ResilientEnricher's self-healing fallback chain.
 *
 * Strategy: mock providers that throw classified errors and verify:
 *   - chain order is honored
 *   - successful provider returns immediately
 *   - failures cool the provider down for the right duration
 *   - subsequent calls skip cooled-down providers
 *   - all-fail throws AllProvidersFailedError (so caller can degrade)
 *   - empty answers count as soft failures + try the next provider
 */
import { describe, it, expect, vi } from "vitest";
import {
  ResilientEnricher,
  AllProvidersFailedError,
  classifyFailure,
  type EnricherProvider,
} from "./enrich.js";

function mockProvider(
  name: string,
  responses: Array<string | Error>,
): EnricherProvider {
  let i = 0;
  return {
    name,
    enrich: vi.fn().mockImplementation(async () => {
      const r = responses[Math.min(i++, responses.length - 1)]!;
      if (r instanceof Error) throw r;
      return { text: r, source: name };
    }),
  };
}

const INPUT = { system: "s", user: "u" };

describe("classifyFailure — error category detection", () => {
  it("recognizes rate-limit phrases as rate-limit (long cooldown)", () => {
    expect(classifyFailure(new Error("HTTP 429: too many requests"))).toBe("rate-limit");
    expect(classifyFailure(new Error("daily quota exhausted"))).toBe("rate-limit");
  });

  it("recognizes 5xx as server (medium cooldown)", () => {
    expect(classifyFailure(new Error("503 service unavailable"))).toBe("server");
    expect(classifyFailure(new Error("Internal server error"))).toBe("server");
  });

  it("recognizes auth failures (long cooldown — needs user fix)", () => {
    expect(classifyFailure(new Error("401 invalid API key"))).toBe("auth");
    expect(classifyFailure(new Error("Forbidden"))).toBe("auth");
  });

  it("recognizes model-missing (skip until next env change)", () => {
    expect(classifyFailure(new Error("model not found"))).toBe("model-missing");
    expect(classifyFailure(new Error("no such model: qwen2.5"))).toBe("model-missing");
  });

  it("recognizes timeout / network errors", () => {
    expect(classifyFailure(new Error("aborted"))).toBe("timeout");
    expect(classifyFailure(new Error("ECONNREFUSED"))).toBe("network");
    expect(classifyFailure(new Error("fetch failed"))).toBe("network");
  });
});

describe("ResilientEnricher — fallback chain behavior", () => {
  it("returns immediately when first provider succeeds", async () => {
    const a = mockProvider("a", ["A answer"]);
    const b = mockProvider("b", ["B answer"]);
    const r = new ResilientEnricher([a, b]);
    const out = await r.enrich(INPUT);
    expect(out.text).toBe("A answer");
    expect(b.enrich).not.toHaveBeenCalled();
  });

  it("falls back to next provider on hard failure", async () => {
    const a = mockProvider("a", [new Error("503 unavailable")]);
    const b = mockProvider("b", ["B answer"]);
    const r = new ResilientEnricher([a, b]);
    const out = await r.enrich(INPUT);
    expect(out.text).toBe("B answer");
  });

  it("treats empty answer as soft failure → tries next provider", async () => {
    const a = mockProvider("a", ["   "]);   // whitespace-only = empty
    const b = mockProvider("b", ["B answer"]);
    const r = new ResilientEnricher([a, b]);
    const out = await r.enrich(INPUT);
    expect(out.text).toBe("B answer");
  });

  it("throws AllProvidersFailedError when every provider fails", async () => {
    const a = mockProvider("a", [new Error("503 unavailable")]);
    const b = mockProvider("b", [new Error("ECONNREFUSED")]);
    const r = new ResilientEnricher([a, b]);
    await expect(r.enrich(INPUT)).rejects.toThrow(AllProvidersFailedError);
  });

  it("skips a provider while it's in cooldown (5xx → 60s default)", async () => {
    // First call: a fails, b answers. a now in cooldown for 60s.
    // Second call: a should be SKIPPED (still in cooldown), b answers again.
    const a = mockProvider("a", [new Error("503"), "A would-recover"]);
    const b = mockProvider("b", ["B1", "B2"]);
    const r = new ResilientEnricher([a, b]);

    const r1 = await r.enrich(INPUT);
    expect(r1.text).toBe("B1");
    expect(a.enrich).toHaveBeenCalledTimes(1);

    const r2 = await r.enrich(INPUT);
    expect(r2.text).toBe("B2");
    // Critically, a should NOT have been retried — it's in cooldown
    expect(a.enrich).toHaveBeenCalledTimes(1);
  });

  it("emits onSwitch event with reason when falling back", async () => {
    const a = mockProvider("a", [new Error("aborted (timeout)")]);
    const b = mockProvider("b", ["B answer"]);
    const events: Array<{ from: string; to: string; kind: string }> = [];
    const r = new ResilientEnricher([a, b], (ev) => events.push(ev));
    await r.enrich(INPUT);
    expect(events).toHaveLength(1);
    expect(events[0]!.from).toBe("a");
    expect(events[0]!.to).toBe("b");
    expect(events[0]!.kind).toBe("timeout");
  });

  it("rate-limit failure cools down longer than server failure", async () => {
    const aRate = mockProvider("aRate", [new Error("429 rate limit")]);
    const aServer = mockProvider("aServer", [new Error("503")]);
    const b = mockProvider("b", ["B"]);
    const r1 = new ResilientEnricher([aRate, b]);
    const r2 = new ResilientEnricher([aServer, b]);
    await r1.enrich(INPUT);
    await r2.enrich(INPUT);
    const h1 = r1.inspectHealth().aRate?.cooldownUntil ?? 0;
    const h2 = r2.inspectHealth().aServer?.cooldownUntil ?? 0;
    expect(h1).toBeGreaterThan(h2); // rate-limit cooldown > server cooldown
  });

  it("constructor rejects empty chain (you must give SOMETHING)", () => {
    expect(() => new ResilientEnricher([])).toThrow();
  });
});
