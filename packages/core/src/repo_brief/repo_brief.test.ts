import { describe, it, expect } from "vitest";
import { buildRepoBrief, verifyBrief, repoBriefGauntlet, type BriefCommit } from "./index.js";

function cs(): BriefCommit[] {
  return Array.from({ length: 20 }, (_, i) => ({
    hash: "z" + String(i).padStart(3, "0") + "f00dcafe", author: i % 2 ? "ana" : "ben", ts: 1_700_000_000 + i * 86400,
    subject: i % 3 === 0 ? "feat(api): add search" : "fix(core): guard",
    body: i % 3 === 0 ? "Why: top request." : "", files: ["src/api.ts", i % 2 ? "src/x.ts" : "src/api.test.ts"], churn: 40,
  }));
}

describe("v3.132 · REPO BRIEF — the Context Capsule (git-native shared context)", () => {
  it("gauntlet is 100", () => expect(repoBriefGauntlet().score).toBe(100));

  it("fuses team + decisions + ranks hot files + reconciles counts", () => {
    const c = cs();
    const b = buildRepoBrief(c, { repo: "demo", repoCommits: 22, openTodos: [{ file: "src/api.ts", line: 3, text: "TODO" }] });
    expect(b.team.length).toBeGreaterThanOrEqual(1);
    expect(b.team[0]!.tier).toBeTruthy();
    expect(b.decisions.length).toBeGreaterThan(0);
    expect(b.hotFiles[0]!.file).toBe("src/api.ts");          // most-touched first
    expect(b.reconciled).toEqual({ repoCommits: 22, merges: 2, authoredCommits: 20, contributors: 2 });
  });

  it("★ grounded + tamper-evident — nothing invented", () => {
    const c = cs();
    const b = buildRepoBrief(c, { repo: "demo" });
    expect(verifyBrief(b, c).ok).toBe(true);
    expect(b.decisions.every((d) => b.citations.includes(d.hash))).toBe(true);
    const forged = { ...b, decisions: [{ hash: "ffffffffffff", subject: "invented", ts: 0 }] };
    expect(verifyBrief(forged, c).ok).toBe(false);
  });

  it("is total on hostile input", () => {
    expect(() => buildRepoBrief(null as never)).not.toThrow();
    expect(buildRepoBrief([]).brief).toBe("BRIEF/1");
  });
});
