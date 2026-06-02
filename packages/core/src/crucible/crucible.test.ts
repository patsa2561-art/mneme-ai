import { describe, it, expect } from "vitest";
import { planSettlement, decideSettlement, failureBrief, crucibleGauntlet, type VerifyResult } from "./index.js";

describe("v2.142 · CRUCIBLE — File-level Settlement Gate", () => {
  it("gauntlet is 100", () => {
    expect(crucibleGauntlet().score).toBe(100);
  });

  it("SAFETY INVARIANT: realTreeWritten ⟺ verdict===MERGE across exit codes", () => {
    for (const code of [0, 1, 2, 127, -1, 255, 137]) {
      const d = decideSettlement({ exitCode: code });
      expect(d.realTreeWritten).toBe(code === 0);
      if (d.realTreeWritten) expect(d.verdict).toBe("MERGE");
      else expect(d.verdict).toBe("ROLLBACK");
    }
  });

  it("a passing shadow MERGEs; a failing one ROLLs BACK and never writes", () => {
    expect(decideSettlement({ exitCode: 0 }).verdict).toBe("MERGE");
    const fail = decideSettlement({ exitCode: 1, output: "FAIL\n  AssertionError: nope" });
    expect(fail.verdict).toBe("ROLLBACK");
    expect(fail.realTreeWritten).toBe(false);
    expect(fail.failureBrief).toMatch(/AssertionError|FAIL/i);
  });

  it("review-mode holds a PASS for human merge (never auto-writes)", () => {
    const r = decideSettlement({ exitCode: 0 }, { requireHumanMerge: true });
    expect(r.verdict).toBe("REVIEW");
    expect(r.realTreeWritten).toBe(false);
  });

  it("fails closed on garbage input (never writes the real tree)", () => {
    const e = decideSettlement(undefined as never);
    expect(e.verdict).toBe("ROLLBACK");
    expect(e.realTreeWritten).toBe(false);
  });

  it("plans touched paths from a diff", () => {
    const diff = ["diff --git a/src/m.ts b/src/m.ts", "@@ -1 +1,2 @@", " a", "+b", "diff --git a/old.ts b/old.ts", "deleted file mode 100644", "-x"].join("\n");
    const p = planSettlement(diff);
    expect(p.touchedPaths).toContain("src/m.ts");
    expect(p.deletedFiles).toContain("old.ts");
  });

  it("is total on hostile input", () => {
    expect(() => planSettlement(null as never)).not.toThrow();
    expect(() => decideSettlement(null as never)).not.toThrow();
    expect(() => failureBrief(undefined)).not.toThrow();
  });
});
