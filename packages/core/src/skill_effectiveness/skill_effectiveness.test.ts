import { describe, it, expect } from "vitest";
import { recordUse, scoreSkill, rankSkills, skillGauntlet } from "./index.js";
import { deputyDecide, deputyGauntlet, emptyTrust, updateTrust } from "../pager/index.js";

describe("pager deputy (timeout decision)", () => {
  it("gauntlet is 100", () => expect(deputyGauntlet().score).toBe(100));
  const mk = (blast: "safe" | "moderate" | "destructive") => ({ id: "x", klass: "k", blast } as never);
  it("safe → allow; destructive → fail-safe deny (even proven)", () => {
    let proven = emptyTrust(); for (let i = 0; i < 12; i++) proven = updateTrust(proven, "k", "approved");
    expect(deputyDecide(mk("safe"), emptyTrust()).decision).toBe("allow");
    expect(deputyDecide(mk("destructive"), proven).decision).toBe("deny");          // irreversible never auto-runs
  });
  it("destructive auto-approves ONLY with explicit opt-in", () => {
    expect(deputyDecide(mk("destructive"), emptyTrust(), { allowDestructiveOnTimeout: true }).decision).toBe("allow");
  });
  it("moderate: unproven→deny, proven→allow (learns)", () => {
    let proven = emptyTrust(); for (let i = 0; i < 12; i++) proven = updateTrust(proven, "k", "approved");
    expect(deputyDecide(mk("moderate"), emptyTrust()).decision).toBe("deny");
    expect(deputyDecide(mk("moderate"), proven).decision).toBe("allow");
  });
});

describe("skill_effectiveness", () => {
  it("gauntlet is 100", () => expect(skillGauntlet().score).toBe(100));

  it("bands by Wilson-LB landing rate, abstains on thin data", () => {
    let L: ReturnType<typeof recordUse> = [];
    for (let i = 0; i < 12; i++) L = recordUse(L, { skillId: "a", landed: i < 11, at: i }); // 11/12
    for (let i = 0; i < 12; i++) L = recordUse(L, { skillId: "b", landed: i < 2, at: i });  // 2/12
    L = recordUse(L, { skillId: "c", landed: true, at: 0 });                                 // 1/1 thin
    expect(scoreSkill(L, "a").band).toBe("PROVEN");
    expect(scoreSkill(L, "b").band).toBe("INEFFECTIVE");
    expect(scoreSkill(L, "c").band).toBe("UNPROVEN");      // Padgett: thin ≠ bad
    expect(scoreSkill(L, "c").rateLB).toBeLessThan(1);     // lower bound, 1/1 ≠ 100%
  });

  it("ranks proven over thin/unproven (not popularity)", () => {
    let L: ReturnType<typeof recordUse> = [];
    for (let i = 0; i < 8; i++) L = recordUse(L, { skillId: "proven", landed: true, at: i });
    for (let i = 0; i < 50; i++) L = recordUse(L, { skillId: "popular-meh", landed: i % 2 === 0, at: i });
    const r = rankSkills(L);
    expect(r[0].skillId).toBe("proven");                   // proven beats a more-popular coin-flip
  });

  it("never throws on garbage", () => {
    expect(() => scoreSkill(null as never, "x")).not.toThrow();
    expect(() => rankSkills(undefined as never)).not.toThrow();
  });
});
