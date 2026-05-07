import { describe, it, expect } from "vitest";
import { tokenOverlap, verifyAnswerLeviathan } from "./leviathan.js";
import { InMemorySink } from "./stream.js";

const ev = (hash: string, subject: string) => ({
  hash,
  shortHash: hash.slice(0, 7),
  subject,
});

describe("verifyAnswerLeviathan — verdicts", () => {
  it("verifies a hash that is in evidence and contextually matches the subject", () => {
    const result = verifyAnswerLeviathan({
      answer: "We fixed the Stripe bigint overflow in `abc1234`.",
      evidence: [ev("abc1234567890abc", "Fix Stripe bigint overflow")],
    });
    expect(result.verifications).toHaveLength(1);
    expect(result.verifications[0]!.verdict).toBe("verified");
    expect(result.trustScore).toBe(1);
    expect(result.degraded).toBe(false);
    // Verified spans are NOT wrapped.
    expect(result.cleanedAnswer).not.toContain("[unverified");
  });

  it("flags hash-not-in-evidence and wraps the offending sentence", () => {
    const result = verifyAnswerLeviathan({
      answer: "See `bad9999` for details.",
      evidence: [ev("abc1234567890abc", "Fix Stripe bigint overflow")],
    });
    expect(result.verifications[0]!.verdict).toBe("hash-not-in-evidence");
    expect(result.cleanedAnswer).toContain("[unverified");
    expect(result.trustScore).toBe(0);
    expect(result.degraded).toBe(true);
  });

  it("flags claim-not-supported when hash exists but subject overlap is below floor", () => {
    const result = verifyAnswerLeviathan({
      // Sentence is about authentication; subject is about a Stripe overflow.
      answer: "Authentication tokens are rotated every hour, see `abc1234`.",
      evidence: [ev("abc1234567890abc", "Fix Stripe bigint overflow")],
    });
    expect(result.verifications[0]!.verdict).toBe("claim-not-supported");
    expect(result.cleanedAnswer).toContain("[unverified");
  });

  it("marks no-citation sentences as no-citation but keeps them in the cleaned answer", () => {
    const result = verifyAnswerLeviathan({
      answer: "This is the verdict. The history is clear.",
      evidence: [ev("abc1234567890abc", "Fix Stripe bigint overflow")],
    });
    expect(result.verifications.every((v) => v.verdict === "no-citation")).toBe(true);
    // Both intro/conclusion sentences kept as-is.
    expect(result.cleanedAnswer).toContain("This is the verdict");
    expect(result.cleanedAnswer).toContain("The history is clear");
  });

  it("trust score is fraction of citation-bearing claims that verified", () => {
    const result = verifyAnswerLeviathan({
      answer:
        "Stripe bigint fix landed in `abc1234`. Auth rotation lives in `bad9999`.",
      evidence: [ev("abc1234567890abc", "Fix Stripe bigint overflow")],
    });
    // 1 verified, 1 hash-not-in-evidence → 0.5
    expect(result.trustScore).toBe(0.5);
    expect(result.degraded).toBe(true); // 0.5 < 0.6 floor
  });

  it("trustScore = 1.0 when no citations are present (intro/conclusion only)", () => {
    const result = verifyAnswerLeviathan({
      answer: "The evidence is mixed. We cannot commit to a verdict.",
      evidence: [ev("abc1234567890abc", "Fix Stripe bigint overflow")],
    });
    expect(result.trustScore).toBe(1.0);
    expect(result.degraded).toBe(false);
  });

  it("matches by hash prefix in either direction (short hash <-> long hash)", () => {
    const result = verifyAnswerLeviathan({
      answer: "Stripe bigint fix landed in `abc12345678`.",
      evidence: [ev("abc1234", "Fix Stripe bigint overflow")],
    });
    expect(result.verifications[0]!.verdict).toBe("verified");
  });

  it("emits verify events to the sink", () => {
    const sink = new InMemorySink();
    verifyAnswerLeviathan({
      answer:
        "Stripe bigint fix landed in `abc1234`. See `bad9999` for unrelated.",
      evidence: [ev("abc1234567890abc", "Fix Stripe bigint overflow")],
      events: sink,
    });
    const verifies = sink.byKind("verify");
    expect(verifies).toHaveLength(2);
    expect(verifies[0]!.ok).toBe(true);
    expect(verifies[1]!.ok).toBe(false);
    expect(verifies[1]!.reason).toContain("not in the evidence pool");
  });

  it("degraded flag flips when too many rejections accumulate", () => {
    const result = verifyAnswerLeviathan({
      answer:
        "See `dead0001`. Also `dead0002`. Lastly `abc1234`.",
      evidence: [ev("abc1234567890abc", "Fix Stripe bigint overflow")],
    });
    // 1 of 3 verified → 0.33 → degraded.
    expect(result.degraded).toBe(true);
    expect(result.trustScore).toBeLessThan(0.6);
  });

  it("preserves verified sentences verbatim in cleanedAnswer", () => {
    const result = verifyAnswerLeviathan({
      answer: "We fixed the Stripe bigint overflow in `abc1234`.",
      evidence: [ev("abc1234567890abc", "Fix Stripe bigint overflow")],
    });
    expect(result.cleanedAnswer).toContain("Stripe bigint overflow");
    expect(result.cleanedAnswer).toContain("`abc1234`");
  });
});

describe("tokenOverlap", () => {
  it("returns 1 for identical sentences", () => {
    expect(tokenOverlap("stripe bigint overflow", "stripe bigint overflow")).toBe(1);
  });

  it("returns 0 for disjoint token sets", () => {
    expect(tokenOverlap("authentication tokens", "Stripe bigint")).toBe(0);
  });

  it("ignores stopwords and the cited hash itself", () => {
    // Only 'stripe' overlaps; everything else is stopwords or the hash.
    const overlap = tokenOverlap("This is the stripe fix `abc1234`.", "Stripe bigint");
    expect(overlap).toBeGreaterThan(0);
  });

  it("is symmetric", () => {
    const a = "stripe bigint overflow";
    const b = "fix overflow in stripe";
    expect(tokenOverlap(a, b)).toBeCloseTo(tokenOverlap(b, a), 6);
  });
});
