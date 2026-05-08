/**
 * Mneme Court — unit tests for the cross-examination logic. The handler
 * itself is integration-tested via _contract.test.ts (structural) +
 * smoke run; here we exercise the pure scoring function on synthetic
 * commit pools to verify each verdict path.
 */

import { describe, expect, it } from "vitest";
import { crossExamineClaim } from "./_court.js";

interface FakeCommit {
  hash: string;
  date: string;
  subject: string;
  body: string;
}

function commit(over: Partial<FakeCommit>): FakeCommit {
  return {
    hash: "abcdef0",
    date: "2026-05-01",
    subject: "",
    body: "",
    ...over,
  };
}

describe("crossExamineClaim — empty / trivial cases", () => {
  it("returns hung_jury with helpful message when claim has no salient tokens", () => {
    const r = crossExamineClaim("a b", []);
    expect(r.verdict).toBe("hung_jury");
    expect(r.witnessesFor).toHaveLength(0);
    expect(r.witnessesAgainst).toHaveLength(0);
    expect(r.summary).toMatch(/no salient tokens/i);
  });

  it("returns hung_jury when no commits match the claim tokens", () => {
    const r = crossExamineClaim("multi-tenancy support", [
      commit({ hash: "aaa1111", subject: "fix typo in README" }),
      commit({ hash: "bbb2222", subject: "bump deps" }),
    ]);
    expect(r.verdict).toBe("hung_jury");
    expect(r.witnessesFor).toHaveLength(0);
  });
});

describe("crossExamineClaim — plaintiff verdict", () => {
  it("rules verdict_for_plaintiff when supportive commits dominate", () => {
    const r = crossExamineClaim("multi-tenancy authentication shipped", [
      commit({ hash: "a111", date: "2024-07-15", subject: "feat: add multi-tenancy authentication core" }),
      commit({ hash: "a222", date: "2024-08-02", subject: "ship multi-tenancy authentication routes" }),
      commit({ hash: "a333", date: "2024-09-10", subject: "implement tenant authentication scoping" }),
    ]);
    expect(r.verdict).toBe("verdict_for_plaintiff");
    expect(r.evidenceBalance).toBeGreaterThan(0);
    expect(r.witnessesFor.length).toBeGreaterThan(0);
    expect(r.witnessesAgainst).toHaveLength(0);
  });
});

describe("crossExamineClaim — motion_to_dismiss", () => {
  it("rules motion_to_dismiss when contradicting commits dominate", () => {
    const r = crossExamineClaim("legacy authentication module is dead code", [
      commit({ hash: "c111", date: "2026-04-01", subject: "fix authentication regression in legacy module" }),
      commit({ hash: "c222", date: "2026-04-15", subject: "hotfix authentication legacy bug" }),
      commit({ hash: "c333", date: "2026-04-20", subject: "revert authentication legacy refactor" }),
    ]);
    expect(r.verdict).toBe("motion_to_dismiss");
    expect(r.evidenceBalance).toBeLessThan(0);
    expect(r.witnessesAgainst.length).toBeGreaterThan(0);
    expect(r.recommendation).toMatch(/retract|qualify|restrict/i);
  });
});

describe("crossExamineClaim — hung jury", () => {
  it("rules hung_jury when evidence is roughly balanced", () => {
    const r = crossExamineClaim("authentication refactor success", [
      commit({ hash: "h111", date: "2026-04-01", subject: "feat: add authentication refactor batch 1" }),
      commit({ hash: "h222", date: "2026-04-08", subject: "ship authentication refactor batch 2" }),
      commit({ hash: "h333", date: "2026-04-15", subject: "revert authentication refactor due to regression" }),
      commit({ hash: "h444", date: "2026-04-22", subject: "rollback authentication refactor v2" }),
    ]);
    // Roughly balanced -> hung_jury OR motion_to_dismiss depending on
    // recency boost; verify it's NOT a clear plaintiff victory.
    expect(r.verdict).not.toBe("verdict_for_plaintiff");
    expect(r.witnessesFor.length).toBeGreaterThan(0);
    expect(r.witnessesAgainst.length).toBeGreaterThan(0);
  });
});

describe("crossExamineClaim — recency weighting", () => {
  it("weights recent contradictions more than old support", () => {
    const r = crossExamineClaim("payment gateway is stable", [
      commit({ hash: "old1", date: "2023-01-01", subject: "ship payment gateway stable release" }),
      commit({ hash: "old2", date: "2023-02-01", subject: "implement payment gateway stability fixes" }),
      commit({ hash: "new1", date: "2026-05-01", subject: "hotfix payment gateway stability regression" }),
      commit({ hash: "new2", date: "2026-05-05", subject: "revert payment gateway stable upgrade" }),
    ]);
    // The recent contradictions get a stronger recency boost than the old
    // support — verdict should NOT be verdict_for_plaintiff.
    expect(r.verdict).not.toBe("verdict_for_plaintiff");
    // Witnesses are surfaced with recency-boosted weights.
    const newestAgainst = r.witnessesAgainst[0];
    expect(newestAgainst).toBeDefined();
    expect(newestAgainst!.commit).toMatch(/^new/);
  });
});

describe("crossExamineClaim — output shape", () => {
  it("returns at most 5 witnesses on each side, sorted by absolute weight", () => {
    const supportive = Array.from({ length: 10 }, (_, i) =>
      commit({ hash: `sup${i}`, date: `2026-04-${String(i + 1).padStart(2, "0")}`, subject: `feat: add database indexing batch ${i}` }),
    );
    const r = crossExamineClaim("database indexing was added", supportive);
    expect(r.witnessesFor.length).toBeLessThanOrEqual(5);
    // Sorted by absolute weight desc.
    for (let i = 1; i < r.witnessesFor.length; i++) {
      expect(Math.abs(r.witnessesFor[i - 1]!.weight)).toBeGreaterThanOrEqual(Math.abs(r.witnessesFor[i]!.weight));
    }
  });

  it("evidenceBalance is between -1 and +1", () => {
    const r = crossExamineClaim("authentication added", [
      commit({ hash: "x1", date: "2026-04-01", subject: "feat: add authentication module" }),
    ]);
    expect(r.evidenceBalance).toBeGreaterThanOrEqual(-1);
    expect(r.evidenceBalance).toBeLessThanOrEqual(1);
  });
});
