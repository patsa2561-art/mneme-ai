import { describe, it, expect } from "vitest";
import { buildAxiaLedger, axiaSummary, verifyAxiaChain, recordEvent, normalizeEvent, axiaGauntlet, AXIA_KINDS, type AxiaEvent } from "./index.js";

const events: Partial<AxiaEvent>[] = [
  { kind: "tokens-saved", count: 5000, source: "treasury" },
  { kind: "destructive-gated", count: 3, source: "heph" },
  { kind: "secret-redacted", count: 2, source: "egress" },
  { kind: "claim-corrected", count: 4, source: "savant" },
];

describe("v2.138 · AXIA — signed, offline-verifiable value ledger", () => {
  it("gauntlet is 100", () => {
    expect(axiaGauntlet().score).toBe(100);
  });

  it("chain verifies offline and counts by kind", () => {
    const led = buildAxiaLedger(events);
    expect(verifyAxiaChain(led).ok).toBe(true);
    const s = axiaSummary(led);
    expect(s.tokensSaved).toBe(5000);
    expect(s.byKind["destructive-gated"]).toBe(3);
    expect(s.byKind["secret-redacted"]).toBe(2);
    expect(s.byKind["claim-corrected"]).toBe(4);
    expect(s.totalEvents).toBe(3 + 2 + 4); // tokens-saved excluded from event count
  });

  it("tampering is localized to the exact seq", () => {
    const led = buildAxiaLedger(events);
    const tampered = led.map((r) => r.seq === 2 ? { ...r, event: { ...r.event, count: 999 } } : r);
    const v = verifyAxiaChain(tampered);
    expect(v.ok).toBe(false);
    expect(v.firstBrokenSeq).toBe(2);
  });

  it("USD comes ONLY from the user-supplied rate (never invented)", () => {
    const led = buildAxiaLedger(events);
    expect(axiaSummary(led).usdSaved).toBeNull();
    expect(axiaSummary(led, { pricePer1k: 3 }).usdSaved).toBe(15); // 5000/1000*3
  });

  it("has NO damage-$ field and frames counts as GATED not 'attacks prevented'", () => {
    const s = axiaSummary(buildAxiaLedger(events));
    expect("damageUsd" in s).toBe(false);
    expect("damagePrevented" in s).toBe(false);
    expect(s.note).toMatch(/NOT estimated \$ damage/);
    expect(s.note).toMatch(/GATED/);
  });

  it("normalizeEvent coerces hostile input; unknown kind → tokens-saved, neg → 0", () => {
    const e = normalizeEvent({ kind: "bogus" as never, count: -5, source: 123 as never });
    expect(AXIA_KINDS.includes(e.kind)).toBe(true);
    expect(e.count).toBe(0);
    expect(typeof e.source).toBe("string");
  });

  it("is total on hostile input", () => {
    expect(() => buildAxiaLedger(null as never)).not.toThrow();
    expect(() => axiaSummary(undefined as never)).not.toThrow();
    expect(() => verifyAxiaChain(null as never)).not.toThrow();
    expect(() => recordEvent("nothex", { count: NaN }, 1)).not.toThrow();
    expect(buildAxiaLedger([]).length).toBe(0);
  });
});
