import { describe, it, expect } from "vitest";
import { emptyState, applyCommit, foldCommits, queryWarm, chainEvent, verifyEventChain, warmGauntlet, type WarmInput, type WarmEvent } from "./index.js";

const DAY = 86_400_000, t0 = 1_700_000_000_000;
const commits: WarmInput[] = [
  { sha: "aaaa111", agent: "claude-code", ts: t0, subject: "feat: login", files: ["auth.ts"] },
  { sha: "bbbb222", agent: "cursor", ts: t0 + DAY, subject: "feat: cache", files: ["cache.ts"] },
  { sha: "cccc333", agent: "human", ts: t0 + 2 * DAY, subject: 'Revert "feat: login"', files: ["auth.ts"] },
  { sha: "dddd444", agent: "claude-code", ts: t0 + 3 * DAY, subject: "feat: solid", files: ["solid.ts"] },
  { sha: "ffff666", agent: "cursor", ts: t0 + 5 * DAY, subject: "chore: x", body: "This reverts commit bbbb222", files: ["cache.ts"] },
];

describe("ALWAYS-WARM ACCOUNTABILITY STATE — never cold, provably == recompute", () => {
  it("WARM == COLD: applying commits one-by-one equals folding them all at once", () => {
    let inc = emptyState(); for (const c of commits) inc = applyCommit(inc, c);
    expect(JSON.stringify(inc)).toBe(JSON.stringify(foldCommits(commits)));
  });
  it("O(1) query gives exact survival driven by EXPLICIT reverts", () => {
    const q = queryWarm(foldCommits(commits));
    const claude = q.agents.find((a) => a.agent === "claude-code")!;
    expect(claude.commits).toBe(2);
    expect(claude.survived).toBe(1);          // aaaa111 reverted, dddd444 survives
    expect(q.stability.explicitReverts).toBe(2); // login (cccc) + cache (ffff)
    expect(q.commits).toBe(5);
  });
  it("the hotfix signal is informational only — never moves survival", () => {
    const withHotfix: WarmInput[] = [...commits, { sha: "ggg777", agent: "human", ts: t0 + 6 * DAY, subject: "fix: hotfix cache regression", files: ["cache.ts"] }];
    const s = foldCommits(withHotfix);
    expect(s.stability.hotfixSignals).toBe(1);
    expect(s.stability.didNotSurvive).toBe(2); // unchanged — hotfix did NOT count as undone
  });
  it("the event chain is tamper-evident", () => {
    let prev: WarmEvent | null = null; const events: WarmEvent[] = [];
    for (const c of commits) { prev = chainEvent(prev, c); events.push(prev); }
    expect(verifyEventChain(events).ok).toBe(true);
    const bad = events.map((e) => ({ ...e })); bad[1].agent = "attacker";
    expect(verifyEventChain(bad).ok).toBe(false);
  });
  it("total on garbage", () => {
    expect(() => applyCommit(emptyState(), null as never)).not.toThrow();
    expect(() => queryWarm(null as never)).not.toThrow();
    expect(() => foldCommits(null as never)).not.toThrow();
  });
  it("MEASURED: warmGauntlet = 100", () => {
    const g = warmGauntlet(); if (g.score !== 100) console.error(g.checks.filter((c) => !c.pass));
    expect(g.score).toBe(100);
  });
});
