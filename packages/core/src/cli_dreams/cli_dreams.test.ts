import { describe, it, expect } from "vitest";
import {
  emptyDreamLedger,
  enqueueDreams,
  recordDreamVerdict,
  morningDigest,
  verifyDreamLedger,
  listPendingDreams,
  formatDigestLine,
  type DreamLedger,
} from "./index.js";

const SECRET = "dream-test-secret-44551122";

function seed3(): DreamLedger {
  const r = enqueueDreams({
    ledger: emptyDreamLedger(),
    seeds: [
      { claim: "src/foo.ts exports `bar`", source: "ollama:llama3:70b" },
      { claim: "tests pass for all files matching `*.test.ts`", source: "ollama:llama3:70b" },
      { claim: "deps array in package.json has no v0.x packages", source: "claude:sonnet" },
    ],
    nowMs: 1_000_000,
    secret: SECRET,
  });
  return r.ledger;
}

describe("v2.19.14 CLI DREAMS · enqueueDreams", () => {
  it("enqueues fresh seeds, returns count + HMAC-signed records", () => {
    const r = enqueueDreams({
      ledger: emptyDreamLedger(),
      seeds: [{ claim: "claim A", source: "ollama" }],
      nowMs: 1_000_000,
      secret: SECRET,
    });
    expect(r.enqueued).toBe(1);
    expect(r.duplicatesSkipped).toBe(0);
    expect(r.ledger.records[0]!.status).toBe("pending");
    expect(r.ledger.records[0]!.prevSig).toBeNull();
    expect(r.ledger.records[0]!.sig).toMatch(/^[a-f0-9]{64}$/);
  });

  it("dedups exact-match pending claims", () => {
    let ledger = enqueueDreams({
      ledger: emptyDreamLedger(),
      seeds: [{ claim: "X is true", source: "ollama" }],
      nowMs: 1_000_000,
      secret: SECRET,
    }).ledger;
    const r = enqueueDreams({
      ledger,
      seeds: [{ claim: "X is true", source: "ollama" }, { claim: "Y is true", source: "ollama" }],
      nowMs: 1_001_000,
      secret: SECRET,
    });
    expect(r.enqueued).toBe(1);
    expect(r.duplicatesSkipped).toBe(1);
  });

  it("hard cap MAX_DREAMS_PER_NIGHT=1000 prevents runaway queue", () => {
    let ledger = emptyDreamLedger();
    const bigSeeds = Array.from({ length: 1500 }, (_, i) => ({ claim: `claim-${i}`, source: "ollama" }));
    const r = enqueueDreams({ ledger, seeds: bigSeeds, nowMs: 1_000_000, secret: SECRET });
    expect(r.enqueued).toBe(1000);
    expect(r.rejectedAtCap).toBe(500);
  });

  it("multiple chains link via prevSig (record N points at record N-1's sig)", () => {
    const ledger = seed3();
    expect(ledger.records).toHaveLength(3);
    expect(ledger.records[0]!.prevSig).toBeNull();
    expect(ledger.records[1]!.prevSig).toBe(ledger.records[0]!.sig);
    expect(ledger.records[2]!.prevSig).toBe(ledger.records[1]!.sig);
  });
});

describe("v2.19.14 CLI DREAMS · recordDreamVerdict + state machine", () => {
  it("recording a verdict appends a new record (chain stays append-only)", () => {
    const ledger = seed3();
    const target = ledger.records[0]!.id;
    const r = recordDreamVerdict({
      ledger, dreamId: target, verdict: "verified",
      evidence: "src/foo.ts:42 exports bar", confidence: 0.9,
      nowMs: 1_010_000, secret: SECRET,
    });
    expect(r.ok).toBe(true);
    expect(r.ledger.records).toHaveLength(4);
    expect(r.ledger.records[3]!.status).toBe("verified");
    expect(r.ledger.records[3]!.evidence).toBe("src/foo.ts:42 exports bar");
  });

  it("refuses to re-resolve a dream that's already verified/refuted", () => {
    let ledger = seed3();
    const id = ledger.records[1]!.id;
    ledger = recordDreamVerdict({ ledger, dreamId: id, verdict: "refuted", evidence: "tests don't pass", nowMs: 1_010_000, secret: SECRET }).ledger;
    const second = recordDreamVerdict({ ledger, dreamId: id, verdict: "verified", nowMs: 1_011_000, secret: SECRET });
    expect(second.ok).toBe(false);
    expect(second.reason).toContain("already resolved");
  });

  it("refuses to resolve an unknown dream id", () => {
    const ledger = seed3();
    const r = recordDreamVerdict({ ledger, dreamId: "drm-doesnt-exist", verdict: "verified", secret: SECRET });
    expect(r.ok).toBe(false);
    expect(r.reason).toContain("not found");
  });
});

describe("v2.19.14 CLI DREAMS · morningDigest", () => {
  it("returns crystallised/refuted/inconclusive/pending counts + crystallised ratio", () => {
    let ledger = seed3();
    const ids = ledger.records.slice(0, 3).map((r) => r.id);
    ledger = recordDreamVerdict({ ledger, dreamId: ids[0]!, verdict: "verified", nowMs: 1_010_000, secret: SECRET }).ledger;
    ledger = recordDreamVerdict({ ledger, dreamId: ids[1]!, verdict: "refuted", nowMs: 1_010_001, secret: SECRET }).ledger;
    // ids[2] stays pending
    const d = morningDigest({ ledger, since: 0, nowMs: 1_100_000 });
    expect(d.totalDreamed).toBe(3);
    expect(d.crystallised.length).toBe(1);
    expect(d.refuted.length).toBe(1);
    expect(d.stillPending).toBe(1);
    expect(d.ratioCrystallised).toBeCloseTo(1 / 3, 3);
  });

  it("`since` filter excludes older dreams from the digest", () => {
    let ledger = seed3(); // generatedAt around 1_000_000
    const ids = ledger.records.slice(0, 3).map((r) => r.id);
    ledger = recordDreamVerdict({ ledger, dreamId: ids[0]!, verdict: "verified", nowMs: 2_000_000, secret: SECRET }).ledger;
    const d = morningDigest({ ledger, since: 1_500_000, nowMs: 2_100_000 });
    // none generated after 1_500_000 → totalDreamed=0
    expect(d.totalDreamed).toBe(0);
  });

  it("digest never includes more than 1 record per dream id (dedup by latest verdict)", () => {
    let ledger = seed3();
    const id = ledger.records[0]!.id;
    ledger = recordDreamVerdict({ ledger, dreamId: id, verdict: "verified", nowMs: 1_010_000, secret: SECRET }).ledger;
    // ledger now has 4 records but only 3 distinct ids
    const d = morningDigest({ ledger, since: 0, nowMs: 1_100_000 });
    expect(d.totalDreamed).toBe(3);
  });
});

describe("v2.19.14 CLI DREAMS · verifyDreamLedger + listPending + formatter", () => {
  it("verifyDreamLedger passes for an untampered chain", () => {
    let ledger = seed3();
    ledger = recordDreamVerdict({ ledger, dreamId: ledger.records[0]!.id, verdict: "verified", nowMs: 1_010_000, secret: SECRET }).ledger;
    expect(verifyDreamLedger(ledger, SECRET).ok).toBe(true);
  });

  it("verifyDreamLedger detects tampered claim text at exact step", () => {
    const ledger = seed3();
    const tampered: DreamLedger = {
      ...ledger,
      records: ledger.records.map((r, i) => (i === 1 ? { ...r, claim: "evil rewrite" } : r)),
    };
    const v = verifyDreamLedger(tampered, SECRET);
    expect(v.ok).toBe(false);
    expect(v.brokenAt).toBe(1);
  });

  it("listPendingDreams returns only dreams whose latest record is 'pending'", () => {
    let ledger = seed3();
    ledger = recordDreamVerdict({ ledger, dreamId: ledger.records[0]!.id, verdict: "verified", nowMs: 1_010_000, secret: SECRET }).ledger;
    const pending = listPendingDreams(ledger);
    expect(pending.length).toBe(2);
    expect(pending.every((r) => r.status === "pending")).toBe(true);
  });

  it("formatter line uses 🦠 + crystallised/refuted/pending counts", () => {
    const line = formatDigestLine({
      generatedAt: "2026-05-16T00:00:00.000Z",
      windowStartMs: 0,
      totalDreamed: 100,
      crystallised: Array(5).fill(null) as any[],
      refuted: Array(20).fill(null) as any[],
      inconclusive: Array(10).fill(null) as any[],
      stillPending: 65,
      ratioCrystallised: 0.05,
    });
    expect(line).toContain("🦠");
    expect(line).toContain("crystallised");
    expect(line).toContain("0.05");
  });
});
