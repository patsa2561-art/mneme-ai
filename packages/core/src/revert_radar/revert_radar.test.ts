import { describe, it, expect } from "vitest";
import { detectReverts, survivalByAgent, revertGauntlet, type CommitLite } from "./index.js";

const DAY = 86_400_000, t0 = 1_700_000_000_000;
const commits: CommitLite[] = [
  { sha: "aaa1111", subject: "feat: login", agent: "claude-code", files: ["auth.ts"], ts: t0 },
  { sha: "bbb2222", subject: "feat: cache", agent: "cursor", files: ["cache.ts"], ts: t0 + DAY },
  { sha: "ccc3333", subject: 'Revert "feat: login"', agent: "human", files: ["auth.ts"], ts: t0 + 2 * DAY },
  { sha: "ddd4444", subject: "fix: hotfix cache regression", agent: "human", files: ["cache.ts"], ts: t0 + 3 * DAY },
  { sha: "eee5555", subject: "feat: solid", agent: "claude-code", files: ["solid.ts"], ts: t0 + 4 * DAY },
];

describe("REVERT RADAR — the regret flywheel (did the work survive)", () => {
  it("detects an explicit revert (conf 1.0) and a same-file hotfix window (conf 0.5)", () => {
    const r = detectReverts(commits, { windowDays: 14 });
    expect(r.find((x) => x.sha === "aaa1111")?.kind).toBe("explicit-revert");
    expect(r.find((x) => x.sha === "aaa1111")?.confidence).toBe(1.0);
    expect(r.find((x) => x.sha === "bbb2222")?.kind).toBe("hotfix-window");
    expect(r.find((x) => x.sha === "bbb2222")?.confidence).toBe(0.5);
  });
  it("a clean commit is never flagged (no false positive)", () => {
    expect(detectReverts(commits).some((x) => x.sha === "eee5555")).toBe(false);
  });
  it("joins agent → survival rate", () => {
    const s = survivalByAgent(commits, detectReverts(commits));
    const c = s.find((x) => x.agent === "claude-code")!;
    expect(c.commits).toBe(2);
    expect(c.regretted).toBe(1);
    expect(c.survivalRate).toBeLessThan(1);
  });
  it("total on garbage", () => {
    expect(() => detectReverts(null as never)).not.toThrow();
    expect(() => survivalByAgent([], [])).not.toThrow();
  });
  it("MEASURED: revertGauntlet = 100", () => {
    const g = revertGauntlet(); if (g.score !== 100) console.error(g.checks.filter((c) => !c.pass));
    expect(g.score).toBe(100);
  });
});
