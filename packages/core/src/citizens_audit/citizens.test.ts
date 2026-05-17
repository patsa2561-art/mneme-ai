import { describe, it, expect } from "vitest";
import {
  anonymizeReceipt,
  aggregateCitizens,
  renderQuarterlyReport,
  quarterIdFromMs,
  computeAuditStats,
  formatAuditLine,
  CITIZENS_AUDIT_TUNABLES,
  type AnonymizedReceipt,
} from "./index.js";
import { mintProtocolReceipt } from "../mneme_receipt_protocol/index.js";

describe("v2.19.37 CITIZEN'S AUDIT — anonymize", () => {
  it("strips PII fields (promptSha256, files, note, contentHash, implementation)", () => {
    const r = mintProtocolReceipt({
      vendor: "claude", modelVersion: "opus", tsMs: 1_700_000_000_000,
      promptText: "secret prompt", filesTouched: ["/home/user/.ssh/id_rsa"],
      note: "PII commit message", implementation: "@user-tool/123",
    });
    const a = anonymizeReceipt(r);
    expect(a).not.toHaveProperty("promptSha256");
    expect(a).not.toHaveProperty("filesTouched");
    expect(a).not.toHaveProperty("note");
    expect(a).not.toHaveProperty("contentHash");
    expect(a).not.toHaveProperty("implementation");
  });

  it("preserves stats fields (vendor, model, tokens, cost, outcome, vaccines)", () => {
    const r = mintProtocolReceipt({
      vendor: "gpt", modelVersion: "4o", tsMs: 1_700_000_000_000,
      tokensIn: 100, tokensOut: 200, costUsdMicros: 5000,
      vaccinesTriggered: ["xss"], outcomeClass: "merged",
    });
    const a = anonymizeReceipt(r);
    expect(a.vendor).toBe("gpt");
    expect(a.modelVersion).toBe("4o");
    expect(a.tokensIn).toBe(100);
    expect(a.tokensOut).toBe(200);
    expect(a.costUsdMicros).toBe(5000);
    expect(a.vaccineCount).toBe(1);
    expect(a.outcomeClass).toBe("merged");
  });

  it("dayBucketMs floors ts to day boundary (k-anonymity)", () => {
    const r1 = mintProtocolReceipt({ vendor: "v", modelVersion: "m", tsMs: 1_700_000_001_234 });
    const r2 = mintProtocolReceipt({ vendor: "v", modelVersion: "m", tsMs: 1_700_000_055_678 });
    const a1 = anonymizeReceipt(r1);
    const a2 = anonymizeReceipt(r2);
    expect(a1.dayBucketMs).toBe(a2.dayBucketMs); // same day → same bucket
  });

  it("anonymizedId is deterministic + 16-char hex", () => {
    const r = mintProtocolReceipt({ vendor: "v", modelVersion: "m", tsMs: 1 });
    const a1 = anonymizeReceipt(r);
    const a2 = anonymizeReceipt(r);
    expect(a1.anonymizedId).toBe(a2.anonymizedId);
    expect(a1.anonymizedId).toMatch(/^[0-9a-f]{16}$/);
  });
});

describe("v2.19.37 CITIZEN'S AUDIT — aggregate", () => {
  function makeAnon(vendor: string, opts: Partial<AnonymizedReceipt> = {}): AnonymizedReceipt {
    return {
      v: 1, vendor, modelVersion: opts.modelVersion ?? "default",
      dayBucketMs: opts.dayBucketMs ?? 1_700_000_000_000,
      tokensIn: opts.tokensIn ?? 100, tokensOut: opts.tokensOut ?? 200,
      costUsdMicros: opts.costUsdMicros ?? 1000,
      vaccineCount: opts.vaccineCount ?? 0,
      outcomeClass: opts.outcomeClass ?? "merged",
      frameworks: opts.frameworks ?? [],
      anonymizedId: opts.anonymizedId ?? "deadbeef00000000",
    };
  }

  it("groups receipts by vendor + counts correctly", () => {
    const receipts = [
      makeAnon("claude"), makeAnon("claude"), makeAnon("claude"),
      makeAnon("gpt"), makeAnon("gpt"),
    ];
    const agg = aggregateCitizens({ receipts });
    expect(agg.totalReceipts).toBe(5);
    expect(agg.uniqueVendors).toBe(2);
    expect(agg.vendorRows.find((v) => v.vendor === "claude")!.totalReceipts).toBe(3);
    expect(agg.vendorRows.find((v) => v.vendor === "gpt")!.totalReceipts).toBe(2);
  });

  it("vaccineHitRate computed correctly", () => {
    const receipts = [
      makeAnon("claude", { vaccineCount: 0 }),
      makeAnon("claude", { vaccineCount: 0 }),
      makeAnon("claude", { vaccineCount: 1 }),
      makeAnon("claude", { vaccineCount: 2 }),
    ];
    const agg = aggregateCitizens({ receipts });
    expect(agg.vendorRows[0]!.vaccineHitRate).toBe(0.5); // 2 of 4
  });

  it("blockedRate counts blocked_by_* outcomes", () => {
    const receipts = [
      makeAnon("v", { outcomeClass: "merged" }),
      makeAnon("v", { outcomeClass: "blocked_by_guard" }),
      makeAnon("v", { outcomeClass: "blocked_by_apoptosis" }),
      makeAnon("v", { outcomeClass: "blocked_by_truth" }),
    ];
    const agg = aggregateCitizens({ receipts });
    expect(agg.vendorRows[0]!.blockedRate).toBe(0.75); // 3 of 4
  });

  it("leaderboards require ≥10 receipts (statistical floor)", () => {
    const fewReceipts = [makeAnon("v", { vaccineCount: 1 })];
    const agg = aggregateCitizens({ receipts: fewReceipts });
    expect(agg.hallucinationLeaderboard.length).toBe(0);
  });

  it("leaderboard ranks vendors by vaccineHitRate desc", () => {
    const receipts: AnonymizedReceipt[] = [];
    for (let i = 0; i < 12; i++) receipts.push(makeAnon("claude", { vaccineCount: i < 3 ? 1 : 0 }));
    for (let i = 0; i < 12; i++) receipts.push(makeAnon("gpt", { vaccineCount: i < 6 ? 1 : 0 }));
    const agg = aggregateCitizens({ receipts });
    expect(agg.hallucinationLeaderboard[0]!.vendor).toBe("gpt"); // higher hit rate
  });
});

describe("v2.19.37 CITIZEN'S AUDIT — quarterly report", () => {
  it("renderQuarterlyReport emits markdown with required sections", () => {
    const receipts = [];
    for (let i = 0; i < 15; i++) {
      receipts.push(anonymizeReceipt(mintProtocolReceipt({
        vendor: "claude", modelVersion: "opus", tsMs: 1_700_000_000_000,
        vaccinesTriggered: i % 3 === 0 ? ["x"] : [],
      })));
    }
    const agg = aggregateCitizens({ receipts });
    const md = renderQuarterlyReport(agg, "Test Org");
    expect(md).toContain("State of AI Accountability");
    expect(md).toContain("Test Org");
    expect(md).toContain("Hallucination Leaderboard");
    expect(md).toContain("Vendor Volume Breakdown");
    expect(md).toContain("Methodology");
  });

  it("quarterIdFromMs formats correctly", () => {
    expect(quarterIdFromMs(new Date("2026-05-17T00:00:00Z").getTime())).toBe("2026-Q2");
    expect(quarterIdFromMs(new Date("2026-11-30T00:00:00Z").getTime())).toBe("2026-Q4");
    expect(quarterIdFromMs(new Date("2026-01-01T00:00:00Z").getTime())).toBe("2026-Q1");
  });
});

describe("v2.19.37 CITIZEN'S AUDIT — A/B before vs after", () => {
  it("A: pre-v2.19.37 = no cross-user aggregation; B: anonymized aggregation now possible", () => {
    const receipts = Array.from({ length: 20 }, (_, i) => anonymizeReceipt(mintProtocolReceipt({
      vendor: i % 2 === 0 ? "claude" : "gpt", modelVersion: "x", tsMs: 1_700_000_000_000,
    })));
    const agg = aggregateCitizens({ receipts });
    expect(agg.totalReceipts).toBe(20);
    expect(agg.uniqueVendors).toBe(2);
    // Anonymized data MUST NOT leak any PII
    for (const r of receipts) {
      expect(r).not.toHaveProperty("promptSha256");
    }
  });
});

describe("v2.19.37 CITIZEN'S AUDIT — stats + tunables + 1000-iter fuzz", () => {
  it("computeAuditStats + format line", () => {
    const agg = aggregateCitizens({ receipts: [] });
    const s = computeAuditStats(agg);
    expect(s.totalReceipts).toBe(0);
    expect(formatAuditLine(s)).toContain("CITIZENS");
  });

  it("STATISTICAL_FLOOR_RECEIPTS = 10", () => {
    expect(CITIZENS_AUDIT_TUNABLES.STATISTICAL_FLOOR_RECEIPTS).toBe(10);
  });

  it("1000 random anonymize+aggregate cycles never crash", () => {
    for (let i = 0; i < 1000; i++) {
      const r = mintProtocolReceipt({
        vendor: `v${i % 10}`, modelVersion: `m${i % 5}`, tsMs: 1_700_000_000_000 + i,
        tokensIn: i % 1000, tokensOut: i % 700, costUsdMicros: i,
        vaccinesTriggered: i % 50 === 0 ? [`x${i}`] : [],
      });
      const a = anonymizeReceipt(r);
      const agg = aggregateCitizens({ receipts: [a] });
      expect(agg.totalReceipts).toBe(1);
    }
  });
});
