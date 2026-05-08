/**
 * court — unit tests for the foreman algorithm.
 *
 * The end-to-end juror voting touches store + git, covered by smoke tests
 * elsewhere. We test the deterministic foreman + markdown rendering here,
 * which are the fairness guarantees of the court.
 */

import { describe, it, expect } from "vitest";
import {
  _tallyForTests,
  _renderRulingMarkdownForTests,
  _ALL_JURORS_COUNT_FOR_TESTS,
} from "./court.js";

describe("court — jury composition", () => {
  it("ships exactly 12 jurors", () => {
    expect(_ALL_JURORS_COUNT_FOR_TESTS).toBe(12);
  });
});

describe("court — foreman tally", () => {
  it("ACQUITTED when 8/12 acquit", () => {
    const votes = makeVotes(([
      ...times(8, "ACQUITTED"),
      ...times(4, "GUILTY"),
    ]) as V[]);
    const r = _tallyForTests(votes);
    expect(r.majorityVerdict).toBe("ACQUITTED");
    expect(r.consensus).toBeCloseTo(8 / 12);
  });

  it("GUILTY when 9/12 say guilty", () => {
    const votes = makeVotes(([
      ...times(9, "GUILTY"),
      ...times(3, "ACQUITTED"),
    ]) as V[]);
    const r = _tallyForTests(votes);
    expect(r.majorityVerdict).toBe("GUILTY");
    expect(r.consensus).toBeCloseTo(9 / 12);
  });

  it("MISTRIAL when no clear majority (6-6)", () => {
    const votes = makeVotes(([
      ...times(6, "GUILTY"),
      ...times(6, "ACQUITTED"),
    ]) as V[]);
    const r = _tallyForTests(votes);
    expect(r.majorityVerdict).toBe("MISTRIAL");
  });

  it("MISTRIAL when consensus < 50%", () => {
    const votes = makeVotes(([
      ...times(5, "GUILTY"),
      ...times(4, "ACQUITTED"),
      ...times(3, "ABSTAIN"),
    ]) as V[]);
    const r = _tallyForTests(votes);
    // 5/12 = 41.7% — below 50% threshold
    expect(r.majorityVerdict).toBe("MISTRIAL");
  });

  it("includes majorityOpinion + dissent", () => {
    const votes = makeVotes(([
      ...times(7, "GUILTY"),
      ...times(5, "ACQUITTED"),
    ]) as V[]);
    const r = _tallyForTests(votes);
    expect(r.majorityOpinion).toContain("juror");
    expect(r.dissent).toBeTruthy();
    expect(r.dissent!.length).toBeGreaterThan(0);
  });

  it("dissent is null when ALL jurors agree", () => {
    const votes = makeVotes(times(12, "ACQUITTED" as V));
    const r = _tallyForTests(votes);
    expect(r.dissent).toBe(null);
  });
});

describe("court — markdown ruling rendering", () => {
  it("includes verdict, consensus, jury table, majority opinion, signature", () => {
    const md = _renderRulingMarkdownForTests({
      rulingVersion: 1,
      generatedAt: "2026-05-08T12:00:00Z",
      generatedByMneme: "1.7.0",
      commit: "a3f9b21abcdef",
      commitShortHash: "a3f9b21",
      jurySize: 12,
      votes: [
        { jurorId: "j-x", jurorRole: "Test juror", verdict: "ACQUITTED", confidence: 0.8, reasoning: "everything looks fine." },
      ],
      consensus: 1,
      majorityVerdict: "ACQUITTED",
      majorityOpinion: "all jurors agree",
      dissent: null,
      evidenceHashes: ["a3f9b21"],
      signature: "abcdef0123",
      signatureAlgorithm: "ed25519",
      signatureKeyId: "court-key-v1",
    });
    expect(md).toContain("Mneme Court — ruling for commit a3f9b21");
    expect(md).toContain("**Verdict:** ACQUITTED");
    expect(md).toContain("100% of jurors");
    expect(md).toContain("Test juror");
    expect(md).toContain("Cryptographic signature");
    expect(md).toContain("ed25519");
  });

  it("renders dissent section when non-null", () => {
    const md = _renderRulingMarkdownForTests({
      rulingVersion: 1,
      generatedAt: "x",
      generatedByMneme: "1.7.0",
      commit: "x",
      commitShortHash: "x",
      jurySize: 12,
      votes: [],
      consensus: 0.7,
      majorityVerdict: "GUILTY",
      majorityOpinion: "majority view",
      dissent: "the minority disagrees",
      evidenceHashes: [],
      signature: "x",
      signatureAlgorithm: "ed25519",
      signatureKeyId: "x",
    });
    expect(md).toContain("## Dissent");
    expect(md).toContain("the minority disagrees");
  });
});

// Helpers

function times<T>(n: number, value: T): T[] {
  return Array.from({ length: n }, () => value);
}

type V = "GUILTY" | "ACQUITTED" | "MISTRIAL" | "ABSTAIN";

function makeVotes(verdicts: V[]) {
  return verdicts.map((v, i) => ({
    jurorId: `juror-${i}`,
    jurorRole: `juror-${i} role`,
    verdict: v,
    confidence: 0.6,
    reasoning: `juror ${i} reasoning here.`,
  }));
}
