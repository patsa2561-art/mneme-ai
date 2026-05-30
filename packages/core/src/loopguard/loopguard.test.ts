import { describe, it, expect } from "vitest";
import { detectStuck, summarizeSession, loopguardGauntlet, parseLedger, toEvent, baseKey, type LoopEvent } from "./index.js";

const T = 2_000_000;
const ev = (cmd: string, sig: string, hadError: boolean, at: number, excerpt = ""): LoopEvent =>
  toEvent({ command: cmd, signature: sig, hadError, excerpt }, at);

describe("v2.110 MNEME LOOPGUARD — objective thrash detection + deterministic resume", () => {
  it("detects a thrash: same failure-signature repeated ≥threshold in window", () => {
    const evs = [
      ev("git push", "git:push:1:no-upstream", true, T),
      ev("git push", "git:push:1:no-upstream", true, T + 1000),
      ev("git push", "git:push:1:no-upstream", true, T + 2000),
    ];
    const v = detectStuck(evs, { now: T + 2500 });
    expect(v.stuck).toBe(true);
    expect(v.repeats).toBe(3);
    expect(v.signature).toBe("git:push:1:no-upstream");
  });

  it("an intervening success on the same base BREAKS the loop (not stuck)", () => {
    const evs = [
      ev("git push", "git:push:1:no-upstream", true, T),
      ev("git push", "git:push:1:no-upstream", true, T + 1000),
      ev("git push", "git:push:1:no-upstream", true, T + 2000),
      ev("git push -u origin HEAD", "", false, T + 3000),
    ];
    expect(detectStuck(evs, { now: T + 3500 }).stuck).toBe(false);
  });

  it("below threshold → no false alarm", () => {
    const evs = [
      ev("git push", "git:push:1:no-upstream", true, T),
      ev("git push", "git:push:1:no-upstream", true, T + 1000),
    ];
    expect(detectStuck(evs, { now: T + 1500, threshold: 3 }).stuck).toBe(false);
  });

  it("three DISTINCT failures do not aggregate into a thrash", () => {
    const evs = [
      ev("git push", "git:push:1:no-upstream", true, T),
      ev("npm test", "npm:test:1:", true, T + 1000),
      ev("python a.py", "python:1:oom", true, T + 2000),
    ];
    expect(detectStuck(evs, { now: T + 2500 }).stuck).toBe(false);
  });

  it("failures OUTSIDE the trailing window don't count", () => {
    const evs = [
      ev("git push", "git:push:1:no-upstream", true, T),
      ev("git push", "git:push:1:no-upstream", true, T + 1000),
      ev("git push", "git:push:1:no-upstream", true, T + 20 * 60_000), // 20m later
    ];
    // 15m window from the last event excludes the first two
    const v = detectStuck(evs, { now: T + 20 * 60_000, windowMs: 15 * 60_000 });
    expect(v.stuck).toBe(false);
  });

  it("resume reconstructs last command, the open error, and a recalled fix", () => {
    const evs = [
      ev("git push", "git:push:1:no-upstream", true, T, "no upstream branch"),
      ev("git push", "git:push:1:no-upstream", true, T + 1000, "no upstream branch"),
      ev("git push", "git:push:1:no-upstream", true, T + 2000, "no upstream branch"),
    ];
    const recall = (s: string) => (s === "git:push:1:no-upstream" ? "git push -u origin HEAD" : null);
    const r = summarizeSession(evs, recall, { now: T + 2500 });
    expect(r.lastCommand).toBe("git push");
    expect(r.resolved).toBe(false);
    expect(r.lastError).toContain("upstream");
    expect(r.suggestion).toBe("git push -u origin HEAD");
    expect(r.stuck.stuck).toBe(true);
    expect(r.repeatedFailures[0]!.count).toBe(3);
  });

  it("resume reports no open error once the failure was resolved", () => {
    const evs = [
      ev("npm test", "npm:test:1:", true, T),
      ev("npm test", "", false, T + 1000),
    ];
    const r = summarizeSession(evs, undefined, { now: T + 1500 });
    expect(r.resolved).toBe(true);
    expect(r.lastError).toBe(null);
  });

  it("baseKey + parseLedger + toEvent round-trip", () => {
    expect(baseKey("git push origin x")).toBe("git:push");
    const line = JSON.stringify(toEvent({ command: "git push", signature: "s", hadError: true }, T));
    const parsed = parseLedger(line + "\n\n{bad json}\n");
    expect(parsed.length).toBe(1);
    expect(parsed[0]!.base).toBe("git:push");
  });

  it("gauntlet scores 100", () => {
    const g = loopguardGauntlet();
    expect(g.detectsThrash).toBe(true);
    expect(g.successBreaksLoop).toBe(true);
    expect(g.noFalseAlarm).toBe(true);
    expect(g.distinctNotStuck).toBe(true);
    expect(g.resumeReconstructs).toBe(true);
    expect(g.score).toBe(100);
  });

  it("STABILITY — total on garbage", () => {
    expect(() => detectStuck(null as never)).not.toThrow();
    expect(detectStuck(null as never).stuck).toBe(false);
    expect(() => summarizeSession(null as never)).not.toThrow();
    expect(() => parseLedger(null as never)).not.toThrow();
    expect(() => toEvent(null as never, NaN)).not.toThrow();
    expect(() => baseKey(null as never)).not.toThrow();
  });
});
