import { describe, it, expect } from "vitest";
import { scanEgress, buildSecretBloom, bloomTest, egressGauntlet, type BloomFilter } from "./index.js";

// ── skeleton: the three layers behave at the contract level ──────────────
describe("v2.118 SOVEREIGN EGRESS GUARD — skeleton", () => {
  it("clean prose → ALLOW, nothing redacted", () => {
    const r = scanEgress({ payload: "the auth module was refactored cleanly today" });
    expect(r.verdict).toBe("ALLOW");
    expect(r.secretsRedacted).toBe(0);
    expect(r.canariesTripped).toEqual([]);
    expect(r.contentHash).toHaveLength(64);
  });

  it("a known secret class → REDACT and the raw key is GONE", () => {
    const r = scanEgress({ payload: "deploy with AKIA1234567890ABCDEF please" });
    expect(r.verdict).toBe("REDACT");
    expect(r.secretsRedacted).toBeGreaterThanOrEqual(1);
    expect(r.redactedPayload).not.toContain("AKIA1234567890ABCDEF");
    expect(r.redactedPayload).toContain("«REDACTED:");
  });

  it("a honeytoken canary in the payload → BLOCK (exfiltration tripwire)", () => {
    const r = scanEgress({ payload: "leaking mneme-canary-abc123 to the world", canaries: ["mneme-canary-abc123"] });
    expect(r.verdict).toBe("BLOCK");
    expect(r.canariesTripped).toContain("mneme-canary-abc123");
    expect(r.residualRisk).toBe(1);
  });

  it("BLOCK takes precedence over REDACT (canary wins even with secrets present)", () => {
    const r = scanEgress({ payload: "AKIA1234567890ABCDEF and mneme-canary-xy", canaries: ["mneme-canary-xy"] });
    expect(r.verdict).toBe("BLOCK");
  });

  it("redacts multiple distinct secret classes in one payload", () => {
    const r = scanEgress({ payload: "key AKIA1234567890ABCDEF tok sk-proj-abcdefghij1234567890" });
    expect(r.verdict).toBe("REDACT");
    expect(r.secretsRedacted).toBeGreaterThanOrEqual(2);
    expect(r.findings.length).toBeGreaterThanOrEqual(2);
  });
});

// ── discrete-math / property: the Bloom filter's defining guarantee ──────
describe("v2.118 EGRESS — Bloom membership properties (discrete-math sweep)", () => {
  it("NO FALSE NEGATIVES: every registered secret tests positive (10,000-case sweep)", () => {
    const N = 10_000;
    const secrets = Array.from({ length: N }, (_, i) => `SECRET_${i}_${(i * 2654435761 >>> 0).toString(36)}`);
    const bloom = buildSecretBloom(secrets, { m: 1 << 18, k: 5 });
    let allPositive = true;
    for (const s of secrets) if (!bloomTest(bloom, s)) { allPositive = false; break; }
    expect(allPositive).toBe(true); // the load-bearing security invariant: no secret slips
  });

  it("LOW FALSE POSITIVE: random non-members stay below 5% at default capacity", () => {
    const secrets = Array.from({ length: 10_000 }, (_, i) => `SECRET_${i}_${(i * 2654435761 >>> 0).toString(36)}`);
    const bloom = buildSecretBloom(secrets, { m: 1 << 18, k: 5 });
    let fp = 0; const probes = 10_000;
    for (let i = 0; i < probes; i++) if (bloomTest(bloom, `NOTASECRET_${i}_${(i * 40503 >>> 0).toString(36)}`)) fp++;
    expect(fp / probes).toBeLessThan(0.05);
  });

  it("DETERMINISTIC: same secrets → byte-identical filter; same token → same verdict", () => {
    const a = buildSecretBloom(["one_secret_value", "two_secret_value"], { m: 4096, k: 4 });
    const b = buildSecretBloom(["one_secret_value", "two_secret_value"], { m: 4096, k: 4 });
    expect(Buffer.from(a.bits).equals(Buffer.from(b.bits))).toBe(true);
    expect(bloomTest(a, "one_secret_value")).toBe(bloomTest(b, "one_secret_value"));
  });

  it("ONE-WAY: the filter stores no recoverable secret (only set bits)", () => {
    const bloom = buildSecretBloom(["super_secret_password_value"], { m: 4096, k: 4 });
    const serialized = JSON.stringify({ m: bloom.m, k: bloom.k, bits: Array.from(bloom.bits) });
    expect(serialized).not.toContain("super_secret_password_value");
  });

  it("ignores trivially-short fingerprints (< 6 chars never poison the filter)", () => {
    const bloom = buildSecretBloom(["abc", "de"], { m: 4096, k: 4 });
    expect(bloomTest(bloom, "abc")).toBe(false);
  });
});

// ── integration: full scan with a real Bloom catches a no-regex custom key ──
describe("v2.118 EGRESS — integration", () => {
  it("catches a registered custom key that matches NO regex, via the Bloom", () => {
    const bloom: BloomFilter = buildSecretBloom(["CUSTOMKEY_zzz_42_not_a_known_pattern"], { m: 4096, k: 5 });
    const r = scanEgress({ payload: "connect using CUSTOMKEY_zzz_42_not_a_known_pattern now", secretBloom: bloom });
    expect(r.bloomHits).toBeGreaterThanOrEqual(1);
    expect(r.verdict).toBe("REDACT");
    expect(r.redactedPayload).not.toContain("CUSTOMKEY_zzz_42_not_a_known_pattern");
  });

  it("the certificate binds the payload HASH, never the payload or secret", () => {
    const r = scanEgress({ payload: "deploy AKIA1234567890ABCDEF" });
    const certView = JSON.stringify({ verdict: r.verdict, contentHash: r.contentHash, secretsRedacted: r.secretsRedacted });
    expect(r.contentHash).toHaveLength(64);
    expect(certView).not.toContain("AKIA1234567890ABCDEF");
  });

  it("is TOTAL — never throws on garbage input (108-error rule)", () => {
    expect(() => scanEgress(null as never)).not.toThrow();
    expect(() => scanEgress({ payload: null as never })).not.toThrow();
    expect(() => buildSecretBloom(null as never)).not.toThrow();
    expect(() => bloomTest(null as never, null as never)).not.toThrow();
    expect(scanEgress(null as never).verdict).toBe("ALLOW");
  });

  it("egressGauntlet() = 100 with the full 10,000-case membership proof", () => {
    const g = egressGauntlet();
    expect(g.score).toBe(100);
    expect(g.canaryBlocks).toBe(true);
    expect(g.patternRedacts).toBe(true);
    expect(g.cleanAllows).toBe(true);
    expect(g.bloomNoFalseNegative).toBe(true);
    expect(g.bloomLowFalsePositive).toBe(true);
    expect(g.certBindsHashOnly).toBe(true);
    expect(g.deterministic).toBe(true);
    expect(g.stable).toBe(true);
    expect(g.membershipCases).toBe(10_000);
  });
});
