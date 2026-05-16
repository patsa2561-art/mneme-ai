import { describe, it, expect } from "vitest";
import {
  emptyLedger,
  learnPhrase,
  resolvePhrase,
  verifyLedger,
  exportDialect,
  formatResolveLine,
  type DialectLedger,
} from "./index.js";

const SECRET = "dialect-test-secret-119911";

function learnNTimes(opts: { ledger: DialectLedger; callerKey: string; phrase: string; intent: string; n: number; accepted: boolean; secret?: string }) {
  let l = opts.ledger;
  for (let i = 0; i < opts.n; i++) {
    l = learnPhrase({ ledger: l, callerKey: opts.callerKey, phrase: opts.phrase, intent: opts.intent, accepted: opts.accepted, nowMs: 1_000_000 + i, secret: opts.secret ?? SECRET });
  }
  return l;
}

describe("v2.19.12 DIALECT · learn + chain integrity", () => {
  it("first record has prevSig=null; subsequent records chain to prior sig", () => {
    let l = emptyLedger();
    l = learnPhrase({ ledger: l, callerKey: "ck-shin", phrase: "ลูกเป็นไง", intent: "mneme.soul.feel", accepted: true, secret: SECRET });
    l = learnPhrase({ ledger: l, callerKey: "ck-shin", phrase: "ลูกเป็นไง", intent: "mneme.soul.feel", accepted: true, secret: SECRET });
    expect(l.records[0]!.prevSig).toBeNull();
    expect(l.records[1]!.prevSig).toBe(l.records[0]!.sig);
  });

  it("verifyLedger passes for an untampered chain", () => {
    const l = learnNTimes({ ledger: emptyLedger(), callerKey: "ck-a", phrase: "ship it", intent: "mneme.ship", n: 6, accepted: true });
    expect(verifyLedger(l, SECRET).ok).toBe(true);
  });

  it("verifyLedger detects HMAC tamper at the exact step", () => {
    const l = learnNTimes({ ledger: emptyLedger(), callerKey: "ck-a", phrase: "ship it", intent: "mneme.ship", n: 5, accepted: true });
    const tampered: DialectLedger = {
      ...l,
      records: l.records.map((r, i) => (i === 2 ? { ...r, intent: "evil_intent" } : r)),
    };
    const r = verifyLedger(tampered, SECRET);
    expect(r.ok).toBe(false);
    expect(r.brokenAt).toBe(2);
  });

  it("verifyLedger detects prevSig mismatch (record reordering)", () => {
    const l = learnNTimes({ ledger: emptyLedger(), callerKey: "ck-a", phrase: "x", intent: "mneme.x", n: 3, accepted: true });
    const swapped: DialectLedger = { ...l, records: [l.records[0]!, l.records[2]!, l.records[1]!] };
    const r = verifyLedger(swapped, SECRET);
    expect(r.ok).toBe(false);
  });
});

describe("v2.19.12 DIALECT · resolvePhrase verdict bands", () => {
  it("returns ask_clarify for an unseen phrase", () => {
    const l = emptyLedger();
    const r = resolvePhrase({ ledger: l, callerKey: "ck-unknown", phrase: "blah blah" });
    expect(r.verdict).toBe("ask_clarify");
    expect(r.totalHits).toBe(0);
    expect(r.topIntent).toBeUndefined();
  });

  it("returns speak_native after 5 accepted hits at acceptedRatio >= 0.8", () => {
    let l = emptyLedger();
    l = learnNTimes({ ledger: l, callerKey: "ck-shin", phrase: "update mneme", intent: "mneme.system.upgrade", n: 5, accepted: true });
    const r = resolvePhrase({ ledger: l, callerKey: "ck-shin", phrase: "update mneme" });
    expect(r.verdict).toBe("speak_native");
    expect(r.topIntent).toBe("mneme.system.upgrade");
    expect(r.acceptedRatio).toBe(1);
  });

  it("returns ask_with_hint at 2-4 hits", () => {
    let l = emptyLedger();
    l = learnNTimes({ ledger: l, callerKey: "ck-shin", phrase: "audit this", intent: "mneme.aurelian.score", n: 3, accepted: true });
    const r = resolvePhrase({ ledger: l, callerKey: "ck-shin", phrase: "audit this" });
    expect(r.verdict).toBe("ask_with_hint");
    expect(r.topIntent).toBe("mneme.aurelian.score");
  });

  it("downgrades to ask_with_hint when acceptedRatio drops below 0.8 even with many hits", () => {
    let l = emptyLedger();
    l = learnNTimes({ ledger: l, callerKey: "ck-x", phrase: "go", intent: "mneme.ship", n: 6, accepted: true });
    l = learnNTimes({ ledger: l, callerKey: "ck-x", phrase: "go", intent: "mneme.ship", n: 4, accepted: false });
    const r = resolvePhrase({ ledger: l, callerKey: "ck-x", phrase: "go" });
    // top still has 10 count but acceptedRatio = 6/10 = 0.6 < 0.8
    expect(r.verdict).toBe("ask_with_hint");
  });

  it("is per-callerKey scoped — phrase learned by user A does NOT auto-resolve for user B", () => {
    let l = emptyLedger();
    l = learnNTimes({ ledger: l, callerKey: "ck-a", phrase: "deploy", intent: "mneme.ship", n: 10, accepted: true });
    const rA = resolvePhrase({ ledger: l, callerKey: "ck-a", phrase: "deploy" });
    const rB = resolvePhrase({ ledger: l, callerKey: "ck-b", phrase: "deploy" });
    expect(rA.verdict).toBe("speak_native");
    expect(rB.verdict).toBe("ask_clarify");
  });

  it("phrase normalisation: case + whitespace insensitive", () => {
    let l = emptyLedger();
    l = learnNTimes({ ledger: l, callerKey: "ck-z", phrase: "Ship It", intent: "mneme.ship", n: 6, accepted: true });
    const r = resolvePhrase({ ledger: l, callerKey: "ck-z", phrase: "  SHIP   IT " });
    expect(r.verdict).toBe("speak_native");
  });

  it("alternatives are sorted by count desc, then by acceptedRatio desc", () => {
    let l = emptyLedger();
    l = learnNTimes({ ledger: l, callerKey: "ck-y", phrase: "go", intent: "intent_A", n: 3, accepted: true });
    l = learnNTimes({ ledger: l, callerKey: "ck-y", phrase: "go", intent: "intent_B", n: 5, accepted: true });
    l = learnNTimes({ ledger: l, callerKey: "ck-y", phrase: "go", intent: "intent_C", n: 1, accepted: true });
    const r = resolvePhrase({ ledger: l, callerKey: "ck-y", phrase: "go" });
    expect(r.alternatives.map((a) => a.intent)).toEqual(["intent_B", "intent_A", "intent_C"]);
  });
});

describe("v2.19.12 DIALECT · exportDialect", () => {
  it("exports only the caller's records, with count and ISO timestamp", () => {
    let l = emptyLedger();
    l = learnNTimes({ ledger: l, callerKey: "ck-a", phrase: "p1", intent: "i1", n: 3, accepted: true });
    l = learnNTimes({ ledger: l, callerKey: "ck-b", phrase: "p2", intent: "i2", n: 7, accepted: true });
    const ex = exportDialect({ ledger: l, callerKey: "ck-a" });
    expect(ex.callerKey).toBe("ck-a");
    expect(ex.recordCount).toBe(3);
    expect(ex.records.every((r) => r.callerKey === "ck-a")).toBe(true);
    expect(typeof ex.exportedAt).toBe("string");
  });
});

describe("v2.19.12 DIALECT · formatters", () => {
  it("formatter reflects verdict + top intent + confidence", () => {
    const line = formatResolveLine({
      verdict: "speak_native",
      topIntent: "mneme.ship",
      confidence: 0.83,
      totalHits: 7,
      acceptedRatio: 1,
      alternatives: [],
    });
    expect(line).toContain("speak_native");
    expect(line).toContain("mneme.ship");
    expect(line).toContain("0.83");
  });
});
