import { describe, it, expect } from "vitest";
import { analyzeBranch, analyzeBranches, branchOracleGauntlet, type BranchInput } from "./index.js";
import { verifyReceipt } from "../notary/receipt.js";

const mk = (over: number, extra: Partial<BranchInput> = {}): BranchInput => ({
  name: `branch-${over}`, ahead: 2, behind: 0,
  changedFiles: ["a.ts", "b.ts", "c.ts", "d.ts"],
  baseChangedFiles: ["a.ts", "b.ts", "c.ts", "d.ts"].slice(0, over),
  ageDays: 1, staleFiles: 0, ...extra,
});

describe("v2.103 BRANCH ORACLE — multi-branch real-signal analysis (no fortune-telling)", () => {
  it("conflict risk rises monotonically with file overlap", () => {
    expect(analyzeBranch(mk(0)).conflictRisk).toBe("low");
    expect(analyzeBranch(mk(2)).conflictRisk).toBe("medium");
    expect(analyzeBranch(mk(4)).conflictRisk).toBe("high");
  });

  it("a clean, fresh, in-sync branch is healthy; a conflicting one is risky", () => {
    expect(analyzeBranch(mk(0)).band).toBe("healthy");
    expect(analyzeBranch(mk(4)).band).toBe("risky");
  });

  it("flags being behind base + stale touched files in reasons", () => {
    const s = analyzeBranch(mk(1, { behind: 3, staleFiles: 2, ageDays: 60 }));
    expect(s.behind).toBe(3);
    expect(s.staleness).toBe("stale");
    expect(s.reasons.join(" ")).toContain("behind base");
    expect(s.reasons.join(" ")).toContain("stale");
  });

  it("ranks the safest branch + signs the report (offline-verifiable)", () => {
    const r = analyzeBranches(process.cwd(), [mk(4), mk(0), mk(2)], 1700000000000);
    expect(r.summary.branches).toBe(3);
    expect(r.summary.safestBranch).toBe("branch-0");          // lowest risk first
    expect(verifyReceipt(r.receipt).valid).toBe(true);
  });

  it("is deterministic — same git state ⇒ same bands", () => {
    const a = analyzeBranches(process.cwd(), [mk(2), mk(4)], 1700000000000);
    const b = analyzeBranches(process.cwd(), [mk(2), mk(4)], 1700000000000);
    expect(JSON.stringify(a.signals)).toBe(JSON.stringify(b.signals));
  });

  it("branch-oracle gauntlet scores 100", () => {
    const g = branchOracleGauntlet(process.cwd(), 1700000000000);
    expect(g.monotonicConflict).toBe(true);
    expect(g.deterministic).toBe(true);
    expect(g.signed).toBe(true);
    expect(g.stable).toBe(true);
    expect(g.score).toBe(100);
  });

  it("STABILITY — total on garbage", () => {
    expect(() => analyzeBranch(null as never)).not.toThrow();
    expect(analyzeBranch(null as never).name).toBe("?");
    expect(analyzeBranches(process.cwd(), null as never, 0).summary.branches).toBe(0);
  });
});
