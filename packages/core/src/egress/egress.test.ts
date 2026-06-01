import { describe, it, expect } from "vitest";
import { scanEgress, buildSecretBloom, bloomTest, egressGauntlet, shannonEntropy, entropySuspect, scanEgressChunked, type BloomFilter } from "./index.js";

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
    expect(g.entropyCatchesUnregistered).toBe(true);
    expect(g.entropySparesProse).toBe(true);
    expect(g.entropyMathSound).toBe(true);
    expect(g.streamEqualsWhole).toBe(true);
    expect(g.deterministic).toBe(true);
    expect(g.stable).toBe(true);
    expect(g.membershipCases).toBe(10_000);
  });
});

// ── v2.119: LAYER 4 — Shannon-entropy structural detection ───────────────
describe("v2.119 EGRESS — entropy/structural layer", () => {
  it("shannonEntropy is 0 for a constant and log2(n) for n equiprobable symbols", () => {
    expect(shannonEntropy("aaaaaa")).toBe(0);
    expect(Math.abs(shannonEntropy("abcd") - 2.0)).toBeLessThan(1e-9);   // 4 symbols → 2 bits
    expect(Math.abs(shannonEntropy("abcdefgh") - 3.0)).toBeLessThan(1e-9); // 8 → 3 bits
    expect(shannonEntropy("")).toBe(0);
  });

  it("catches a high-entropy unregistered key that matches NO regex and is in NO Bloom", () => {
    const key = "aB3xK9mQ2pL5vN8wR4tZ7cJ1fH6dG0sY";
    const r = scanEgress({ payload: `connect with ${key} now` });
    expect(r.entropySuspects).toBeGreaterThanOrEqual(1);
    expect(r.verdict).toBe("REDACT");
    expect(r.redactedPayload).not.toContain(key);
  });

  it("does NOT false-positive on ordinary prose, paths, URLs, or version strings", () => {
    const r = scanEgress({ payload: "the authentication module was refactored cleanly in commit yesterday afternoon" });
    expect(r.entropySuspects).toBe(0);
    expect(r.verdict).toBe("ALLOW");
    expect(scanEgress({ payload: "see https://example.com/docs/getting-started-guide-page" }).entropySuspects).toBe(0);
    expect(scanEgress({ payload: "edit /usr/local/lib/node_modules/some-package/index.js now" }).entropySuspects).toBe(0);
    expect(scanEgress({ payload: "bumped to version 12.34.567 across all packages" }).entropySuspects).toBe(0);
  });

  it("entropy layer can be disabled via { enabled: false }", () => {
    const key = "aB3xK9mQ2pL5vN8wR4tZ7cJ1fH6dG0sY";
    const r = scanEgress({ payload: `connect with ${key} now`, entropy: { enabled: false } });
    expect(r.entropySuspects).toBe(0);
    expect(r.verdict).toBe("ALLOW");
  });

  it("entropySuspect honours minLen and threshold knobs", () => {
    expect(entropySuspect("short1A")).toBe(false);                       // < default minLen 20
    expect(entropySuspect("aB3xK9mQ2pL5vN8wR4tZ7cJ1fH6dG0sY")).toBe(true);
    expect(entropySuspect("aB3xK9mQ2pL5vN8wR4tZ", { threshold: 99 })).toBe(false); // impossible threshold
  });
});

// ── v2.119: STREAMING MODE — bounded-memory scan equals whole-payload ────
describe("v2.119 EGRESS — streaming mode", () => {
  const split = (s: string, n: number) => { const a: string[] = []; for (let i = 0; i < s.length; i += n) a.push(s.slice(i, i + n)); return a; };

  it("a secret straddling chunk boundaries is still caught (chunked == whole)", () => {
    const payload = "word ".repeat(2000) + "AKIA1234567890ABCDEF" + " word".repeat(2000);
    const whole = scanEgress({ payload });
    const streamed = scanEgressChunked(split(payload, 7), { windowBytes: 1024 });
    expect(streamed.verdict).toBe(whole.verdict);
    expect(streamed.secretsRedacted).toBe(whole.secretsRedacted);
    expect(streamed.redactedPayload).toBe(whole.redactedPayload);
    expect(streamed.contentHash).toBe(whole.contentHash);
  });

  it("a canary straddling chunk boundaries still BLOCKs", () => {
    const canary = "mneme-canary-prod-deadbeef";
    const payload = "x".repeat(3000) + " " + canary + " " + "y".repeat(3000);
    const streamed = scanEgressChunked(split(payload, 5), { canaries: [canary], windowBytes: 512 });
    expect(streamed.verdict).toBe("BLOCK");
    expect(streamed.canariesTripped).toContain(canary);
  });

  it("clean streamed payload → ALLOW", () => {
    const payload = "the quick brown fox ".repeat(500);
    const streamed = scanEgressChunked(split(payload, 3), { windowBytes: 256 });
    expect(streamed.verdict).toBe("ALLOW");
    expect(streamed.contentHash).toBe(scanEgress({ payload }).contentHash);
  });

  it("is TOTAL on garbage chunk input", () => {
    expect(() => scanEgressChunked(null as never)).not.toThrow();
    expect(() => scanEgressChunked([null as never, undefined as never])).not.toThrow();
    expect(scanEgressChunked([]).verdict).toBe("ALLOW");
  });
});
