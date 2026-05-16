import { describe, it, expect } from "vitest";
import {
  gateClaim,
  verifyCertificate,
  emptyTaxLedger,
  initMonthlyBudget,
  chargeTax,
  verifyTaxLedger,
  vendorStatus,
  routingDecision,
  formatGateLine,
  type SearchResult,
  type TaxLedger,
} from "./index.js";

const SECRET = "negev-test-secret-99887766";

describe("v2.19.13 NEGATIVE-EVIDENCE FIREWALL · gateClaim verdicts", () => {
  it("Rule 5: empty refutations → UNKNOWN (never auto-accept untested)", () => {
    const r = gateClaim({ claim: "X is true", refutations: [], searchResults: [], secret: SECRET });
    expect(r.verdict).toBe("UNKNOWN");
    expect(r.certificate).toBeUndefined();
  });

  it("Rule 3: every refutation has at least one NOT_FOUND search → ACCEPTED + certificate", () => {
    const refutations = ["X is actually false in case A", "X contradicts B", "X has known counter-example C"];
    const searchResults: SearchResult[] = refutations.flatMap((r) => [
      { refutation: r, source: "git", verdict: "not_found" },
      { refutation: r, source: "file", verdict: "not_found" },
    ]);
    const r = gateClaim({ claim: "X is true", refutations, searchResults, secret: SECRET, nowMs: 1_000_000 });
    expect(r.verdict).toBe("ACCEPTED");
    expect(r.certificate).toBeDefined();
    expect(r.certificate!.refutationCount).toBe(3);
    expect(r.certificate!.searchCount).toBe(6);
  });

  it("Rule 1: ANY found is fatal → REJECTED, returns the defeating evidence", () => {
    const r = gateClaim({
      claim: "Y is true",
      refutations: ["Y is false in case A", "Y contradicts B"],
      searchResults: [
        { refutation: "Y is false in case A", source: "git", verdict: "not_found" },
        { refutation: "Y contradicts B", source: "file", verdict: "found", evidence: "src/foo.ts:42 contradicts Y" },
        { refutation: "Y contradicts B", source: "git", verdict: "not_found" },
      ],
      secret: SECRET,
    });
    expect(r.verdict).toBe("REJECTED");
    expect(r.rejectedBy?.evidence).toContain("contradicts");
  });

  it("Rule 2: any INCONCLUSIVE (no found) → UNKNOWN, returns pending searches", () => {
    const r = gateClaim({
      claim: "Z is true",
      refutations: ["Z fails on input A"],
      searchResults: [
        { refutation: "Z fails on input A", source: "test", verdict: "inconclusive", evidence: "test timed out" },
      ],
      secret: SECRET,
    });
    expect(r.verdict).toBe("UNKNOWN");
    expect(r.pendingSearches?.length).toBe(1);
  });

  it("Rule 4: refutation with NO search at all → UNKNOWN (don't auto-accept uncovered refutations)", () => {
    const r = gateClaim({
      claim: "W is true",
      refutations: ["W fails on edge case", "W is undefined for inputs > 1e9"],
      searchResults: [
        { refutation: "W fails on edge case", source: "git", verdict: "not_found" },
        // second refutation has zero searches
      ],
      secret: SECRET,
    });
    expect(r.verdict).toBe("UNKNOWN");
  });

  it("REJECTED wins even when some refutations are inconclusive (FOUND is always fatal)", () => {
    const r = gateClaim({
      claim: "A",
      refutations: ["r1", "r2"],
      searchResults: [
        { refutation: "r1", source: "web", verdict: "inconclusive" },
        { refutation: "r2", source: "git", verdict: "found", evidence: "commit deadbeef refutes r2" },
      ],
      secret: SECRET,
    });
    expect(r.verdict).toBe("REJECTED");
  });
});

describe("v2.19.13 NEGATIVE-EVIDENCE FIREWALL · certificate", () => {
  it("certificate is HMAC-verifiable + deterministic given same inputs", () => {
    const refs = ["r1"];
    const searches: SearchResult[] = [{ refutation: "r1", source: "git", verdict: "not_found" }];
    const a = gateClaim({ claim: "claim-A", refutations: refs, searchResults: searches, secret: SECRET, nowMs: 5_000_000 });
    const b = gateClaim({ claim: "claim-A", refutations: refs, searchResults: searches, secret: SECRET, nowMs: 5_000_000 });
    expect(a.certificate!.hmac).toBe(b.certificate!.hmac);
    expect(verifyCertificate(a.certificate!, SECRET).ok).toBe(true);
  });

  it("forged certificate (tampered claim) is rejected", () => {
    const refs = ["r1"];
    const searches: SearchResult[] = [{ refutation: "r1", source: "git", verdict: "not_found" }];
    const r = gateClaim({ claim: "real-claim", refutations: refs, searchResults: searches, secret: SECRET });
    const forged = { ...r.certificate!, claim: "evil-claim" };
    expect(verifyCertificate(forged, SECRET).ok).toBe(false);
  });

  it("verifyCertificate fails with wrong secret", () => {
    const refs = ["r1"];
    const searches: SearchResult[] = [{ refutation: "r1", source: "git", verdict: "not_found" }];
    const r = gateClaim({ claim: "A", refutations: refs, searchResults: searches, secret: SECRET });
    expect(verifyCertificate(r.certificate!, "wrong-secret").ok).toBe(false);
  });
});

describe("v2.19.13 NEGATIVE-EVIDENCE FIREWALL · TokenTaxLedger", () => {
  it("emptyTaxLedger has no entries", () => {
    expect(emptyTaxLedger().entries).toHaveLength(0);
  });

  it("initMonthlyBudget grants 1000 credits + is IDEMPOTENT within the same month", () => {
    const t0 = 1715817600000; // 2024-05-16
    let l = initMonthlyBudget({ ledger: emptyTaxLedger(), vendor: "v-anthropic", nowMs: t0, secret: SECRET });
    expect(l.entries).toHaveLength(1);
    expect(l.entries[0]!.amount).toBe(1000);
    // second call same month → no-op
    l = initMonthlyBudget({ ledger: l, vendor: "v-anthropic", nowMs: t0 + 1000, secret: SECRET });
    expect(l.entries).toHaveLength(1);
  });

  it("chargeTax appends a charge; positive amount required", () => {
    let l = initMonthlyBudget({ ledger: emptyTaxLedger(), vendor: "v-openai", nowMs: 1_000_000, secret: SECRET });
    l = chargeTax({ ledger: l, vendor: "v-openai", amount: 10, reason: "refuted claim X", nowMs: 1_001_000, secret: SECRET });
    expect(l.entries).toHaveLength(2);
    expect(l.entries[1]!.kind).toBe("charge");
    expect(() => chargeTax({ ledger: l, vendor: "v-openai", amount: -5, reason: "bad", secret: SECRET })).toThrow();
  });

  it("HMAC chain integrity: ledger verifies before tamper, fails after", () => {
    let l = initMonthlyBudget({ ledger: emptyTaxLedger(), vendor: "v-a", nowMs: 1_000_000, secret: SECRET });
    l = chargeTax({ ledger: l, vendor: "v-a", amount: 10, reason: "x", nowMs: 1_000_100, secret: SECRET });
    l = chargeTax({ ledger: l, vendor: "v-a", amount: 10, reason: "y", nowMs: 1_000_200, secret: SECRET });
    expect(verifyTaxLedger(l, SECRET).ok).toBe(true);
    const tampered: TaxLedger = {
      ...l,
      entries: l.entries.map((e, i) => (i === 1 ? { ...e, amount: 1000000 } : e)),
    };
    const v = verifyTaxLedger(tampered, SECRET);
    expect(v.ok).toBe(false);
    expect(v.brokenAt).toBe(1);
  });

  it("vendorStatus: budget - charged = remaining; exhausted=true when remaining<=0", () => {
    let l = initMonthlyBudget({ ledger: emptyTaxLedger(), vendor: "v-x", nowMs: 1_000_000, secret: SECRET, amount: 100 });
    for (let i = 0; i < 9; i++) {
      l = chargeTax({ ledger: l, vendor: "v-x", amount: 10, reason: `r${i}`, nowMs: 1_000_000 + i, secret: SECRET });
    }
    let s = vendorStatus({ ledger: l, vendor: "v-x", nowMs: 1_000_010 });
    expect(s.remaining).toBe(10);
    expect(s.exhausted).toBe(false);
    expect(s.rejectedClaimCount).toBe(9);
    l = chargeTax({ ledger: l, vendor: "v-x", amount: 10, reason: "r9", nowMs: 1_000_020, secret: SECRET });
    s = vendorStatus({ ledger: l, vendor: "v-x", nowMs: 1_000_030 });
    expect(s.remaining).toBe(0);
    expect(s.exhausted).toBe(true);
  });

  it("vendor status is scoped to current month (last month's charges don't count)", () => {
    const may = new Date(Date.UTC(2024, 4, 16)).getTime(); // 2024-05-16
    const june = new Date(Date.UTC(2024, 5, 16)).getTime(); // 2024-06-16
    let l = initMonthlyBudget({ ledger: emptyTaxLedger(), vendor: "v-z", nowMs: may, secret: SECRET });
    l = chargeTax({ ledger: l, vendor: "v-z", amount: 500, reason: "may charge", nowMs: may + 1000, secret: SECRET });
    // June: status should show full new budget (June grant) minus zero charges
    l = initMonthlyBudget({ ledger: l, vendor: "v-z", nowMs: june, secret: SECRET });
    const s = vendorStatus({ ledger: l, vendor: "v-z", nowMs: june + 1000 });
    expect(s.budget).toBe(1000);
    expect(s.charged).toBe(0);
    expect(s.remaining).toBe(1000);
  });
});

describe("v2.19.13 NEGATIVE-EVIDENCE FIREWALL · routingDecision", () => {
  it("not-exhausted primary → route=primary", () => {
    let l = initMonthlyBudget({ ledger: emptyTaxLedger(), vendor: "v-claude", nowMs: 1_000_000, secret: SECRET });
    l = chargeTax({ ledger: l, vendor: "v-claude", amount: 100, reason: "x", nowMs: 1_000_001, secret: SECRET });
    const d = routingDecision({ ledger: l, primaryVendor: "v-claude", fallbackVendor: "v-llama", nowMs: 1_000_002 });
    expect(d.route).toBe("primary");
    expect(d.primaryStatus.remaining).toBe(900);
  });

  it("exhausted primary → route=fallback with explanatory reason", () => {
    let l = initMonthlyBudget({ ledger: emptyTaxLedger(), vendor: "v-claude", nowMs: 1_000_000, secret: SECRET, amount: 50 });
    l = chargeTax({ ledger: l, vendor: "v-claude", amount: 50, reason: "x", nowMs: 1_000_001, secret: SECRET });
    const d = routingDecision({ ledger: l, primaryVendor: "v-claude", fallbackVendor: "v-llama", nowMs: 1_000_002 });
    expect(d.route).toBe("fallback");
    expect(d.reason).toContain("exhausted hallucination budget");
    expect(d.reason).toContain("v-llama");
  });

  it("primary that was never granted any budget = exhausted = fallback", () => {
    const l = emptyTaxLedger();
    const d = routingDecision({ ledger: l, primaryVendor: "v-unknown", fallbackVendor: "v-llama", nowMs: 1_000_000 });
    expect(d.route).toBe("fallback");
  });
});

describe("v2.19.13 NEGATIVE-EVIDENCE FIREWALL · formatter", () => {
  it("formatter line uses ✅/❌/❓ per verdict", () => {
    const accept = formatGateLine({ verdict: "ACCEPTED", refutationCount: 3, searchCount: 6 });
    const reject = formatGateLine({ verdict: "REJECTED", refutationCount: 3, searchCount: 6 });
    const unknown = formatGateLine({ verdict: "UNKNOWN", refutationCount: 1, searchCount: 0 });
    expect(accept).toContain("✅");
    expect(reject).toContain("❌");
    expect(unknown).toContain("❓");
  });
});
