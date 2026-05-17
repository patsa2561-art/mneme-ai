import { describe, it, expect } from "vitest";
import {
  mintReceipt,
  verifyReceipt,
  emptyLedger,
  appendToLedger,
  verifyLedger,
  queryLedger,
  generateAuditBinder,
  mapToComplianceControls,
  computeApostilleStats,
  formatApostilleLine,
  APOSTILLE_TUNABLES,
  type AICallReceipt,
  type ComplianceFramework,
  type OutcomeClass,
  type ApostilleLedger,
} from "./index.js";

const SECRET = "apostille-test-77";

describe("v2.19.34 APOSTILLE -- mintReceipt + verify", () => {
  it("mintReceipt returns valid HMAC-chained receipt with minimal input", () => {
    const r = mintReceipt({ vendor: "claude", modelVersion: "opus-4.7", tsMs: 1_700_000_000_000, secret: SECRET });
    expect(r.v).toBe(APOSTILLE_TUNABLES.PROTOCOL_VERSION);
    expect(r.receiptId).toMatch(/^[0-9a-f]{24}$/);
    expect(r.sig).toMatch(/^[0-9a-f]{64}$/);
    expect(verifyReceipt(r, SECRET)).toBe(true);
  });

  it("verifyReceipt rejects tampered receipts", () => {
    const r = mintReceipt({ vendor: "claude", modelVersion: "opus-4.7", tsMs: 1_700_000_000_000, secret: SECRET });
    const t: AICallReceipt = { ...r, vendor: "evil" };
    expect(verifyReceipt(t, SECRET)).toBe(false);
  });

  it("auto-derives controls across 6 frameworks", () => {
    const r = mintReceipt({
      vendor: "gpt", modelVersion: "4o",
      filesTouched: ["src/auth.ts"],
      vaccinesTriggered: ["sql_injection_v3"],
      outcomeClass: "blocked_by_guard",
      tsMs: 1, secret: SECRET,
    });
    expect(r.controls.SOC2.length).toBeGreaterThan(0);
    expect(r.controls.EU_AI_ACT).toContain("Art.9");
    expect(r.controls.GDPR.length).toBeGreaterThan(0);
  });

  it("extraControls merge with auto-derived", () => {
    const r = mintReceipt({
      vendor: "claude", modelVersion: "x",
      extraControls: { GDPR: ["Art.17"], EU_AI_ACT: ["Art.50"] },
      tsMs: 1, secret: SECRET,
    });
    expect(r.controls.GDPR).toContain("Art.17");
    expect(r.controls.EU_AI_ACT).toContain("Art.50");
  });

  it("DEFENSIVE: malformed input never throws", () => {
    const bad: unknown[] = [{}, { vendor: 123 }, { tokensIn: -1 }, { costUsdMicros: NaN }];
    for (const b of bad) {
      const r = mintReceipt(b as Parameters<typeof mintReceipt>[0]);
      expect(verifyReceipt(r)).toBe(true);
    }
  });
});

describe("v2.19.34 APOSTILLE -- ledger chain integrity", () => {
  it("emptyLedger has zero-merkle root + blank fingerprint", () => {
    const L = emptyLedger();
    expect(L.merkleRoot).toBe("0".repeat(64));
    expect(L.binderFingerprint).toBe("0".repeat(16));
    expect(verifyLedger(L)).toBe(true);
  });

  it("appendToLedger chains prevSig + recomputes merkle root", () => {
    let L = emptyLedger();
    const r1 = mintReceipt({ vendor: "v1", modelVersion: "m1", tsMs: 1, prevReceipt: null, secret: SECRET });
    L = appendToLedger(L, r1, SECRET);
    expect(L.receipts.length).toBe(1);
    expect(L.merkleRoot).not.toBe("0".repeat(64));
    expect(verifyLedger(L, SECRET)).toBe(true);

    const last = L.receipts[L.receipts.length - 1]!;
    const r2 = mintReceipt({ vendor: "v2", modelVersion: "m2", tsMs: 2, prevReceipt: last, secret: SECRET });
    L = appendToLedger(L, r2, SECRET);
    expect(L.receipts.length).toBe(2);
    expect(verifyLedger(L, SECRET)).toBe(true);
  });

  it("appendToLedger refuses broken-chain receipt (prevSig mismatch)", () => {
    let L = emptyLedger();
    const r1 = mintReceipt({ vendor: "v1", modelVersion: "m", tsMs: 1, prevReceipt: null, secret: SECRET });
    L = appendToLedger(L, r1, SECRET);
    // r2 has wrong prevSig
    const r2 = mintReceipt({ vendor: "v2", modelVersion: "m", tsMs: 2, prevReceipt: null, secret: SECRET });
    const after = appendToLedger(L, r2, SECRET);
    expect(after.receipts.length).toBe(1); // unchanged
  });

  it("appendToLedger refuses forged receipt", () => {
    let L = emptyLedger();
    const r1 = mintReceipt({ vendor: "v", modelVersion: "m", tsMs: 1, secret: SECRET });
    const forged: AICallReceipt = { ...r1, sig: "deadbeef".repeat(8) };
    L = appendToLedger(L, forged, SECRET);
    expect(L.receipts.length).toBe(0);
  });

  it("verifyLedger DETECTS tampering anywhere in the chain", () => {
    let L = emptyLedger();
    let prev: AICallReceipt | null = null;
    for (let i = 0; i < 10; i++) {
      const r = mintReceipt({ vendor: "v", modelVersion: "m", tsMs: i, prevReceipt: prev, secret: SECRET });
      L = appendToLedger(L, r, SECRET);
      prev = r;
    }
    expect(verifyLedger(L, SECRET)).toBe(true);
    const tampered: ApostilleLedger = { ...L, receipts: [...L.receipts] };
    tampered.receipts[5] = { ...tampered.receipts[5]!, vendor: "attacker" };
    expect(verifyLedger(tampered, SECRET)).toBe(false);
  });

  it("verifyLedger DETECTS recomputed merkle root mismatch", () => {
    let L = emptyLedger();
    const r1 = mintReceipt({ vendor: "v", modelVersion: "m", tsMs: 1, secret: SECRET });
    L = appendToLedger(L, r1, SECRET);
    const wrongRoot: ApostilleLedger = { ...L, merkleRoot: "f".repeat(64), binderFingerprint: "ffffffffffffffff" };
    expect(verifyLedger(wrongRoot, SECRET)).toBe(false);
  });
});

describe("v2.19.34 APOSTILLE -- queryLedger filters", () => {
  function buildLedger(n: number): ApostilleLedger {
    let L = emptyLedger();
    let prev: AICallReceipt | null = null;
    for (let i = 0; i < n; i++) {
      const r = mintReceipt({
        vendor: i % 2 === 0 ? "claude" : "gpt",
        modelVersion: `v${i % 3}`,
        filesTouched: [`src/file_${i}.ts`],
        vaccinesTriggered: i % 7 === 0 ? ["xss_v1"] : [],
        outcomeClass: (["merged", "reverted", "blocked_by_guard", "pending"] as OutcomeClass[])[i % 4]!,
        tsMs: 1_000_000 + i * 1000,
        prevReceipt: prev, secret: SECRET,
      });
      L = appendToLedger(L, r, SECRET);
      prev = r;
    }
    return L;
  }

  it("filter by vendor", () => {
    const L = buildLedger(20);
    const claudes = queryLedger(L, { vendor: "claude" });
    expect(claudes.length).toBe(10);
    expect(claudes.every((r) => r.vendor === "claude")).toBe(true);
  });

  it("filter by outcomeClass", () => {
    const L = buildLedger(20);
    const merged = queryLedger(L, { outcomeClass: "merged" });
    expect(merged.length).toBe(5);
  });

  it("filter by filePath", () => {
    const L = buildLedger(5);
    const f = queryLedger(L, { filePath: "src/file_2.ts" });
    expect(f.length).toBe(1);
  });

  it("filter by vaccineTriggered", () => {
    const L = buildLedger(14);
    const vax = queryLedger(L, { vaccineTriggered: "xss_v1" });
    expect(vax.length).toBe(2);
  });

  it("filter by dateRangeMs", () => {
    const L = buildLedger(10);
    const r = queryLedger(L, { dateRangeMs: { from: 1_005_000, to: 1_007_000 } });
    expect(r.length).toBeGreaterThan(0);
    expect(r.every((x) => x.tsMs >= 1_005_000 && x.tsMs <= 1_007_000)).toBe(true);
  });

  it("filter by framework (control non-empty)", () => {
    const L = buildLedger(10);
    const r = queryLedger(L, { framework: "SOC2" });
    // All receipts touch files → SOC2 CC8.1 triggers
    expect(r.length).toBe(10);
  });
});

describe("v2.19.34 APOSTILLE -- generateAuditBinder", () => {
  it("emits deterministic markdown with fingerprint", () => {
    let L = emptyLedger();
    for (let i = 0; i < 5; i++) {
      const prev = i > 0 ? L.receipts[L.receipts.length - 1]! : null;
      const r = mintReceipt({
        vendor: "claude", modelVersion: "opus", filesTouched: [`f${i}.ts`],
        costUsdMicros: 100_000, tokensIn: 50, tokensOut: 100,
        tsMs: 1000 + i, prevReceipt: prev, secret: SECRET,
      });
      L = appendToLedger(L, r, SECRET);
    }
    const binder = generateAuditBinder({
      ledger: L, framework: "SOC2",
      organisationName: "Acme Corp", preparedBy: "Mneme",
    }, SECRET);
    expect(binder.markdown).toContain("Mneme APOSTILLE");
    expect(binder.markdown).toContain("Acme Corp");
    expect(binder.fingerprint).toBe(L.binderFingerprint);
    expect(binder.totalReceiptsInScope).toBe(5);
    expect(binder.totalCostUsdMicros).toBe(500_000);
    expect(binder.sig).toMatch(/^[0-9a-f]{64}$/);
  });

  it("binder respects framework filter", () => {
    let L = emptyLedger();
    for (let i = 0; i < 4; i++) {
      const prev = i > 0 ? L.receipts[L.receipts.length - 1]! : null;
      // No files → SOC2 CC8.1 won't fire
      const r = mintReceipt({ vendor: "v", modelVersion: "m", tsMs: i, prevReceipt: prev, secret: SECRET });
      L = appendToLedger(L, r, SECRET);
    }
    const binder = generateAuditBinder({ ledger: L, framework: "SOC2" }, SECRET);
    // All receipts have NO files but still SOC2 CC6.1 + CC7.2 from "always trigger"
    expect(binder.totalReceiptsInScope).toBeGreaterThan(0);
  });

  it("binder fingerprint stable: same ledger → same fingerprint", () => {
    let L = emptyLedger();
    const r = mintReceipt({ vendor: "v", modelVersion: "m", tsMs: 1, secret: SECRET });
    L = appendToLedger(L, r, SECRET);
    const a = generateAuditBinder({ ledger: L }, SECRET);
    const b = generateAuditBinder({ ledger: L }, SECRET);
    expect(a.fingerprint).toBe(b.fingerprint);
  });
});

describe("v2.19.34 APOSTILLE -- mapToComplianceControls registry", () => {
  it("EU_AI_ACT Art.12 always fires (every call captured)", () => {
    const r = mintReceipt({ vendor: "v", modelVersion: "m", tsMs: 1, secret: SECRET });
    expect(r.controls.EU_AI_ACT).toContain("Art.12");
  });

  it("HIPAA file-access control only when filesTouched not empty", () => {
    const without = mintReceipt({ vendor: "v", modelVersion: "m", tsMs: 1, secret: SECRET });
    expect(without.controls.HIPAA).not.toContain("164.312(a)(1)");
    const withFile = mintReceipt({ vendor: "v", modelVersion: "m", filesTouched: ["x.ts"], tsMs: 1, secret: SECRET });
    expect(withFile.controls.HIPAA).toContain("164.312(a)(1)");
  });

  it("ISO_27001 A.5.7 only when vaccines triggered", () => {
    const r = mintReceipt({ vendor: "v", modelVersion: "m", vaccinesTriggered: ["x"], tsMs: 1, secret: SECRET });
    expect(r.controls.ISO_27001).toContain("A.5.7");
  });
});

describe("v2.19.34 APOSTILLE -- computeApostilleStats", () => {
  it("counts vendors / cost / tokens / outcomes / vaccine hits", () => {
    let L = emptyLedger();
    for (let i = 0; i < 10; i++) {
      const prev = i > 0 ? L.receipts[L.receipts.length - 1]! : null;
      const r = mintReceipt({
        vendor: i < 5 ? "claude" : "gpt", modelVersion: `v${i}`,
        costUsdMicros: 100_000, tokensIn: 10, tokensOut: 20,
        vaccinesTriggered: i % 2 === 0 ? ["xss"] : [],
        outcomeClass: i % 3 === 0 ? "merged" : "pending",
        tsMs: i, prevReceipt: prev, secret: SECRET,
      });
      L = appendToLedger(L, r, SECRET);
    }
    const s = computeApostilleStats(L);
    expect(s.totalReceipts).toBe(10);
    expect(s.uniqueVendors).toBe(2);
    expect(s.uniqueModels).toBe(10);
    expect(s.totalCostUsdMicros).toBe(1_000_000);
    expect(s.totalTokens).toBe(300);
    expect(s.vaccineHits).toBe(5);
    expect(s.outcomeBreakdown.merged).toBe(4);
    expect(formatApostilleLine(s)).toContain("APOSTILLE");
  });
});

describe("v2.19.34 APOSTILLE -- 25,000 FUZZ ITERATIONS (chain stays valid under random ops)", () => {
  it("25,000 random receipts in chain → all verify; ledger merkle stays consistent", () => {
    const N = 25_000;
    let L = emptyLedger();
    let prev: AICallReceipt | null = null;
    for (let i = 0; i < N; i++) {
      const r = mintReceipt({
        vendor: `v${i % 10}`, modelVersion: `m${i % 5}`,
        filesTouched: i % 3 === 0 ? [`f${i}.ts`] : [],
        tokensIn: i % 1000, tokensOut: i % 700,
        costUsdMicros: i * 100,
        vaccinesTriggered: i % 100 === 0 ? [`vax${i}`] : [],
        outcomeClass: (["merged", "reverted", "pending"] as OutcomeClass[])[i % 3]!,
        tsMs: 1_000_000_000_000 + i,
        prevReceipt: prev, secret: SECRET,
      });
      L = appendToLedger(L, r, SECRET);
      prev = r;
    }
    expect(L.receipts.length).toBe(N);
    expect(verifyLedger(L, SECRET)).toBe(true);
    const stats = computeApostilleStats(L);
    expect(stats.totalReceipts).toBe(N);
  }, 60_000);

  it("DEFENSIVE: 1,000 random malformed inputs to mintReceipt never throw", () => {
    for (let i = 0; i < 1000; i++) {
      const r = mintReceipt({
        vendor: Math.random() > 0.5 ? "v" : (undefined as unknown as string),
        modelVersion: Math.random() > 0.5 ? "m" : (null as unknown as string),
        tokensIn: Math.random() > 0.5 ? 10 : (NaN as number),
        costUsdMicros: Math.random() > 0.5 ? 100 : -1,
        tsMs: Math.random() > 0.5 ? i : 0,
        secret: SECRET,
      });
      expect(verifyReceipt(r, SECRET)).toBe(true);
    }
  });
});
