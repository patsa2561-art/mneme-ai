import { describe, it, expect } from "vitest";
import {
  generatePairCode,
  normaliseCode,
  isValidCodeShape,
  bindEnvelope,
  verifyPairRecord,
  lookupByCode,
  markUsed,
  pruneExpired,
  sasEmoji,
  computePairStats,
  formatPairStatsLine,
  PAIR_CODE_TUNABLES,
  type PairRecord,
} from "./index.js";

const SECRET = "pair-test-secret-22";

describe("v2.19.32 PAIR CODE -- 6-char human-friendly handle", () => {
  it("generatePairCode produces shape XXX-XXX from confusable-free alphabet", () => {
    for (let i = 0; i < 50; i++) {
      const c = generatePairCode();
      expect(c).toMatch(/^[ACDEFGHJKMNPRTUVWXY2346789]{3}-[ACDEFGHJKMNPRTUVWXY2346789]{3}$/);
    }
  });

  it("alphabet excludes 0/O/Q/1/I/L/5/S/8/B (confusables)", () => {
    expect(PAIR_CODE_TUNABLES.ALPHABET).not.toContain("0");
    expect(PAIR_CODE_TUNABLES.ALPHABET).not.toContain("O");
    expect(PAIR_CODE_TUNABLES.ALPHABET).not.toContain("Q");
    expect(PAIR_CODE_TUNABLES.ALPHABET).not.toContain("1");
    expect(PAIR_CODE_TUNABLES.ALPHABET).not.toContain("I");
    expect(PAIR_CODE_TUNABLES.ALPHABET).not.toContain("L");
    expect(PAIR_CODE_TUNABLES.ALPHABET).not.toContain("5");
    expect(PAIR_CODE_TUNABLES.ALPHABET).not.toContain("S");
    expect(PAIR_CODE_TUNABLES.ALPHABET).not.toContain("8");
    expect(PAIR_CODE_TUNABLES.ALPHABET).not.toContain("B");
  });

  it("normaliseCode handles user typing: spaces / lowercase / no-dash (shape only)", () => {
    expect(normaliseCode("cat-dad")).toBe("CAT-DAD");
    expect(normaliseCode("catdad")).toBe("CAT-DAD");
    expect(normaliseCode("C AT - DAD")).toBe("CAT-DAD");
    expect(normaliseCode("cat  dad")).toBe("CAT-DAD");
    expect(normaliseCode("")).toBe("");
    expect(normaliseCode("toolong")).toBe(""); // 7 chars
    expect(normaliseCode(123 as unknown as string)).toBe("");
  });

  it("isValidCodeShape rejects out-of-alphabet chars (0/O/1/I/B/S etc)", () => {
    expect(isValidCodeShape("CAT-DAD")).toBe(true);
    expect(isValidCodeShape("ZOZ-CAT")).toBe(false); // O not in alphabet
    expect(isValidCodeShape("0CD-EFG")).toBe(false); // 0 not in alphabet
    expect(isValidCodeShape("1CD-EFG")).toBe(false); // 1 not in alphabet
    expect(isValidCodeShape("BCD-EFG")).toBe(false); // B not in alphabet
    expect(isValidCodeShape("SCD-EFG")).toBe(false); // S not in alphabet
  });

  it("MEASURED low collision rate: 10000 generates → expect < 1% collisions", () => {
    const seen = new Set<string>();
    let collisions = 0;
    for (let i = 0; i < 10_000; i++) {
      const c = generatePairCode();
      if (seen.has(c)) collisions++;
      seen.add(c);
    }
    // Alphabet 26 chars, 6 chars total = 26^6 = ~309M space. 10000 picks expect ~0 collisions
    expect(collisions).toBeLessThan(100); // < 1% even with bad RNG
  });
});

describe("v2.19.32 PAIR CODE -- bind/lookup/markUsed lifecycle", () => {
  it("bindEnvelope creates HMAC-signed PairRecord", () => {
    const r = bindEnvelope({
      envelopeSig: "abc123",
      envelopeId: "env-001",
      nowMs: 1_700_000_000_000,
      secret: SECRET,
    });
    expect(r.code).toMatch(/^[A-Z2-9]{3}-[A-Z2-9]{3}$/);
    expect(r.envelopeSig).toBe("abc123");
    expect(r.expiresAtMs).toBe(1_700_000_000_000 + PAIR_CODE_TUNABLES.DEFAULT_TTL_MS);
    expect(r.usedAtMs).toBeNull();
    expect(r.sig).toMatch(/^[0-9a-f]{64}$/);
    expect(verifyPairRecord(r, SECRET)).toBe(true);
  });

  it("bindEnvelope accepts caller-supplied code (for deterministic tests)", () => {
    const r = bindEnvelope({
      code: "CAT-DAD",
      envelopeSig: "x",
      envelopeId: "y",
      nowMs: 0,
      secret: SECRET,
    });
    expect(r.code).toBe("CAT-DAD");
  });

  it("verifyPairRecord rejects tampering", () => {
    const r = bindEnvelope({ envelopeSig: "x", envelopeId: "y", nowMs: 0, secret: SECRET });
    const tampered: PairRecord = { ...r, envelopeSig: "different" };
    expect(verifyPairRecord(tampered, SECRET)).toBe(false);
  });

  it("lookupByCode returns 'found' for active code", () => {
    const r = bindEnvelope({ envelopeSig: "x", envelopeId: "y", nowMs: 1000, secret: SECRET });
    const result = lookupByCode({ records: [r], code: r.code, nowMs: 1500, secret: SECRET });
    expect(result.verdict).toBe("found");
    expect(result.record?.envelopeId).toBe("y");
  });

  it("lookupByCode handles user-typed lowercase + no-dash", () => {
    const r = bindEnvelope({ code: "CAT-DAD", envelopeSig: "x", envelopeId: "y", nowMs: 1000, secret: SECRET });
    const result = lookupByCode({ records: [r], code: "catdad", nowMs: 1500, secret: SECRET });
    expect(result.verdict).toBe("found");
  });

  it("lookupByCode returns 'not_found' for unknown code", () => {
    const result = lookupByCode({ records: [], code: "ZZZ-ZZZ", nowMs: 1000, secret: SECRET });
    expect(result.verdict).toBe("not_found");
    expect(result.record).toBeNull();
  });

  it("lookupByCode returns 'expired' after TTL passes", () => {
    const r = bindEnvelope({ envelopeSig: "x", envelopeId: "y", nowMs: 0, ttlMs: 1000, secret: SECRET });
    const result = lookupByCode({ records: [r], code: r.code, nowMs: 2000, secret: SECRET });
    expect(result.verdict).toBe("expired");
  });

  it("lookupByCode returns 'tampered' if HMAC fails", () => {
    const r = bindEnvelope({ envelopeSig: "x", envelopeId: "y", nowMs: 0, secret: SECRET });
    const tampered: PairRecord = { ...r, envelopeSig: "evil" };
    const result = lookupByCode({ records: [tampered], code: r.code, nowMs: 100, secret: SECRET });
    expect(result.verdict).toBe("tampered");
  });

  it("markUsed implements one-shot: 2nd lookup returns 'already_used'", () => {
    const r = bindEnvelope({ envelopeSig: "x", envelopeId: "y", nowMs: 1000, secret: SECRET });
    const used = markUsed({ record: r, usedByDeviceId: "phone-1", nowMs: 1500, secret: SECRET });
    expect(used.usedAtMs).toBe(1500);
    expect(used.usedByDeviceId).toBe("phone-1");
    expect(verifyPairRecord(used, SECRET)).toBe(true);
    const result = lookupByCode({ records: [used], code: r.code, nowMs: 2000, secret: SECRET });
    expect(result.verdict).toBe("already_used");
  });

  it("pruneExpired removes only past-TTL records", () => {
    const fresh = bindEnvelope({ envelopeSig: "a", envelopeId: "1", nowMs: 1000, ttlMs: 10_000, secret: SECRET });
    const expired = bindEnvelope({ envelopeSig: "b", envelopeId: "2", nowMs: 0, ttlMs: 500, secret: SECRET });
    const all = [fresh, expired];
    const pruned = pruneExpired(all, 5000);
    expect(pruned.length).toBe(1);
    expect(pruned[0]!.envelopeId).toBe("1");
  });

  it("computePairStats categorises records correctly", () => {
    const fresh = bindEnvelope({ envelopeSig: "a", envelopeId: "1", nowMs: 1000, ttlMs: 10_000, secret: SECRET });
    const expired = bindEnvelope({ envelopeSig: "b", envelopeId: "2", nowMs: 0, ttlMs: 500, secret: SECRET });
    const usedRec = markUsed({
      record: bindEnvelope({ envelopeSig: "c", envelopeId: "3", nowMs: 1000, secret: SECRET }),
      usedByDeviceId: "phone", nowMs: 1500, secret: SECRET,
    });
    const tampered: PairRecord = { ...fresh, envelopeId: "bad" };
    const stats = computePairStats([fresh, expired, usedRec, tampered], 5000, SECRET);
    expect(stats.active).toBe(1);
    expect(stats.expired).toBe(1);
    expect(stats.used).toBe(1);
    expect(stats.tampered).toBe(1);
    expect(formatPairStatsLine(stats)).toContain("PAIR");
  });
});

describe("v2.19.32 PAIR CODE -- SAS EMOJI (MITM defense)", () => {
  it("sasEmoji is deterministic from envelopeSig", () => {
    const sig = "a".repeat(64);
    const a = sasEmoji(sig);
    const b = sasEmoji(sig);
    expect(a).toEqual(b);
    expect(a.length).toBe(4);
  });

  it("sasEmoji DIFFERENT envelopeSigs produce DIFFERENT emoji (low collision)", async () => {
    const { randomBytes } = await import("node:crypto");
    const seen = new Set<string>();
    for (let i = 0; i < 200; i++) {
      // Truly random first 4 bytes — this exercises the emoji alphabet uniformly
      const sig = randomBytes(4).toString("hex") + "0".repeat(56);
      seen.add(sasEmoji(sig).join(""));
    }
    // 64-emoji alphabet × 4 slots = 16M combinations; 200 random sigs → expect
    // very few collisions (birthday: ~200^2 / 2 / 16M ≈ 0.00125 → essentially 0)
    expect(seen.size).toBeGreaterThan(180);
  });

  it("sasEmoji returns 4 fallback emoji for malformed input", () => {
    expect(sasEmoji("")).toEqual(["❓", "❓", "❓", "❓"]);
    expect(sasEmoji("xyz")).toEqual(["❓", "❓", "❓", "❓"]);
    expect(sasEmoji(null as unknown as string)).toEqual(["❓", "❓", "❓", "❓"]);
  });

  it("SAS_EMOJI_SPACE is wide enough to defend MITM (~16M)", () => {
    expect(PAIR_CODE_TUNABLES.SAS_EMOJI_SPACE).toBeGreaterThan(10_000_000);
  });
});

describe("v2.19.32 PAIR CODE -- 24/7 RESILIENCE", () => {
  it("1000 random bind/lookup/markUsed cycles never crash", () => {
    let records: PairRecord[] = [];
    for (let i = 0; i < 1000; i++) {
      const env = `env-${Math.floor(Math.random() * 100)}`;
      const r = bindEnvelope({
        envelopeSig: `sig-${Math.random()}`,
        envelopeId: env,
        nowMs: i * 100,
        ttlMs: 30_000,
        secret: SECRET,
      });
      records.push(r);
      const lookup = lookupByCode({ records, code: r.code, nowMs: i * 100 + 50, secret: SECRET });
      expect(["found", "not_found", "already_used", "expired", "tampered"]).toContain(lookup.verdict);
      if (Math.random() < 0.3 && lookup.verdict === "found") {
        const used = markUsed({ record: lookup.record!, usedByDeviceId: `dev-${i}`, nowMs: i * 100 + 60, secret: SECRET });
        records = records.map((x) => x.code === used.code ? used : x);
      }
      if (i % 100 === 0) records = pruneExpired(records, i * 100);
    }
    expect(records.length).toBeGreaterThan(0);
  });
});
