import { describe, it, expect } from "vitest";
import {
  aggregateNarrativeTrust,
  classifyClaim,
  extractClaimSentences,
  fileTouched,
  hasContradiction,
  verifyNarrative,
} from "./verify.js";

describe("audit/verify — extractClaimSentences", () => {
  it("returns [] for empty message", () => {
    expect(extractClaimSentences("")).toEqual([]);
  });

  it("splits a multi-sentence message", () => {
    const out = extractClaimSentences("Adds caching. Fixes a typo. No change to db.ts.");
    expect(out.length).toBeGreaterThanOrEqual(3);
    expect(out.some((s) => /[Cc]aching/.test(s))).toBe(true);
  });

  it("strips trailers like Co-Authored-By", () => {
    const out = extractClaimSentences("fix bug\n\nCo-Authored-By: Claude <c@anthropic.com>");
    expect(out.some((s) => /Co-Authored-By/.test(s))).toBe(false);
  });

  it("captures bullet items", () => {
    const out = extractClaimSentences("- Adds foo\n- Removes bar");
    expect(out).toContain("Adds foo");
    expect(out).toContain("Removes bar");
  });
});

describe("audit/verify — classifyClaim", () => {
  it("identifies negation claims", () => {
    expect(classifyClaim("no change to db.ts")).toBe("negation");
    expect(classifyClaim("does not touch payment.ts")).toBe("negation");
  });

  it("identifies additive claims", () => {
    expect(classifyClaim("adds a retry helper")).toBe("additive");
    expect(classifyClaim("introduces a logger")).toBe("additive");
    expect(classifyClaim("new function fooBar")).toBe("additive");
  });

  it("identifies fix claims", () => {
    expect(classifyClaim("fix a typo")).toBe("fix");
    expect(classifyClaim("corrects a regression")).toBe("fix");
  });

  it("identifies scope claims", () => {
    expect(classifyClaim("only touches utils.ts")).toBe("scope");
    expect(classifyClaim("just a typo")).toBe("scope");
  });

  it("falls back to 'other' when no rule matches", () => {
    expect(classifyClaim("the quick brown fox")).toBe("other");
  });
});

describe("audit/verify — fileTouched matcher", () => {
  it("matches exact + suffix paths", () => {
    expect(fileTouched(["src/db.ts"], "db.ts")).toBe(true);
    expect(fileTouched(["src/db.ts"], "src/db.ts")).toBe(true);
    expect(fileTouched(["src/db.ts"], "other.ts")).toBe(false);
  });
});

describe("audit/verify — verifyNarrative end-to-end", () => {
  it("flags a contradicted negation when the file IS touched", () => {
    const msg = "Refactor handler. No change to db.ts.";
    const diff = "+ const x = 1;\n- const y = 2;";
    const filesTouched = ["src/handler.ts", "src/db.ts"];
    const r = verifyNarrative(msg, diff, filesTouched, "abc123");
    const contradicted = r.verifications.find((v) => v.verdict === "contradicted");
    expect(contradicted).toBeDefined();
    expect(contradicted!.reason).toMatch(/db\.ts/);
    expect(r.narrativeTrustScore).toBeLessThan(1);
  });

  it("verifies a negation when the file is NOT touched", () => {
    const msg = "Tweak handler. No change to db.ts.";
    const diff = "+ x";
    const filesTouched = ["src/handler.ts"];
    const r = verifyNarrative(msg, diff, filesTouched);
    const negation = r.verifications.find((v) =>
      /db\.ts/.test(v.claim) && /db\.ts/.test(v.reason),
    );
    expect(negation?.verdict).toBe("verified");
  });

  it("flags a contradicted additive claim when the named symbol is missing", () => {
    const msg = "Adds function fooBar.";
    const diff = "+ const x = 1;\n+ const y = 2;";
    const r = verifyNarrative(msg, diff, ["src/x.ts"]);
    const additive = r.verifications.find((v) => /fooBar/i.test(v.claim));
    expect(additive?.verdict).toBe("contradicted");
  });

  it("verifies an additive claim when the named symbol IS in the diff", () => {
    const msg = "Adds function fooBar.";
    const diff = "+ export function fooBar() { return 1; }";
    const r = verifyNarrative(msg, diff, ["src/x.ts"]);
    const additive = r.verifications.find((v) => /fooBar/i.test(v.claim));
    expect(additive?.verdict).toBe("verified");
  });

  it("flags a fix-typo claim when the diff is suspiciously large", () => {
    const msg = "fix typo";
    const diff = ["+ a", "+ b", "+ c", "+ d", "+ e"]
      .concat(Array.from({ length: 30 }, (_, i) => `+ line ${i}`))
      .join("\n");
    const r = verifyNarrative(msg, diff, ["src/x.ts"]);
    const fix = r.verifications.find((v) => /typo/i.test(v.claim));
    expect(fix?.verdict).toBe("contradicted");
  });

  it("treats unrelated free-form text as unverifiable (trust stays 1.0)", () => {
    const msg = "the quick brown fox";
    const r = verifyNarrative(msg, "+ x", []);
    expect(r.narrativeTrustScore).toBe(1.0);
    expect(r.verifications.every((v) => v.verdict === "unverifiable")).toBe(true);
  });

  it("commitHash is round-tripped into the result", () => {
    const r = verifyNarrative("fix typo", "+ x", ["a.ts"], "deadbeef");
    expect(r.commitHash).toBe("deadbeef");
  });
});

describe("audit/verify — aggregate helpers", () => {
  it("aggregateNarrativeTrust averages across checks", () => {
    const checks = [
      { commitHash: "a", claims: [], filesTouched: [], verifications: [], narrativeTrustScore: 1.0 },
      { commitHash: "b", claims: [], filesTouched: [], verifications: [], narrativeTrustScore: 0.5 },
    ];
    expect(aggregateNarrativeTrust(checks)).toBe(0.75);
  });

  it("aggregateNarrativeTrust returns 1.0 for empty input", () => {
    expect(aggregateNarrativeTrust([])).toBe(1.0);
  });

  it("hasContradiction returns true if any check has contradicted verdict", () => {
    const checks = [
      {
        commitHash: "a",
        claims: [],
        filesTouched: [],
        verifications: [{ claim: "x", verdict: "contradicted" as const, reason: "" }],
        narrativeTrustScore: 0,
      },
    ];
    expect(hasContradiction(checks)).toBe(true);
    expect(hasContradiction([])).toBe(false);
  });
});
