import { describe, expect, it } from "vitest";
import { rewriteInVoice, type AuthorVoice } from "./profile.js";

const aliceVoice: AuthorVoice = {
  email: "alice@x.com",
  name: "Alice",
  sampleSize: 200,
  subjectLengthAvg: 50,
  subjectLengthP25: 35,
  subjectLengthP75: 70,
  convCommitPct: 80,
  topPrefixes: [{ prefix: "feat", count: 100, pct: 50 }],
  topOpeners: [{ word: "add", count: 60 }],
  topPhrases: [],
  punctuation: {
    emDashPct: 20,
    colonPct: 80,
    parenScopePct: 30,
    endsWithPeriodPct: 70,
  },
  lowercasePct: 90,
  bulletBodyPct: 40,
  bodyLineAvg: 5,
  fingerprint: "deadbeef",
};

describe("twin — rewriteInVoice", () => {
  it("prepends dominant conv-commit prefix", () => {
    const r = rewriteInVoice(aliceVoice, "Reorganize the auth module");
    expect(r.rewritten).toMatch(/^feat:/);
    expect(r.rules).toContain("prepend prefix 'feat:'");
  });

  it("lowercases first word after prefix", () => {
    const r = rewriteInVoice(aliceVoice, "Add tracing to the payment path");
    // After prefix prepend + lowercase rule
    expect(r.rewritten).toMatch(/^feat:\s+a/);
  });

  it("appends period when author ends with periods >= 50%", () => {
    const r = rewriteInVoice(aliceVoice, "tighten log levels");
    expect(r.rewritten.endsWith(".")).toBe(true);
  });

  it("does NOT add period when author rarely ends with periods", () => {
    const bobVoice: AuthorVoice = {
      ...aliceVoice,
      email: "bob@x.com",
      name: "Bob",
      punctuation: { ...aliceVoice.punctuation, endsWithPeriodPct: 10 },
    };
    const r = rewriteInVoice(bobVoice, "add cache");
    expect(r.rewritten.endsWith(".")).toBe(false);
  });

  it("returns higher confidence with larger sample size", () => {
    const small = rewriteInVoice({ ...aliceVoice, sampleSize: 5 }, "x");
    const big = rewriteInVoice({ ...aliceVoice, sampleSize: 500 }, "x");
    expect(big.confidence).toBeGreaterThanOrEqual(small.confidence);
  });

  it("does not double-prepend when input already has a prefix", () => {
    const r = rewriteInVoice(aliceVoice, "fix: bad cache key");
    expect(r.rewritten.startsWith("feat:")).toBe(false);
  });

  it("preserves fingerprint shape (8 hex chars)", () => {
    expect(aliceVoice.fingerprint).toMatch(/^[0-9a-f]{8}$/);
  });
});
