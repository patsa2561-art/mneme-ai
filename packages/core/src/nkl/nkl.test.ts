import { describe, it, expect } from "vitest";
import { deriveDeadEnds, checkApproach, nklStats, nklGauntlet } from "./index.js";
import { baseKey, type LoopEvent } from "../loopguard/index.js";

const T = 3_000_000;
const ev = (cmd: string, sig: string, hadError: boolean, at: number, excerpt = ""): LoopEvent =>
  ({ command: cmd, signature: sig, base: baseKey(cmd), hadError, at, excerpt });

describe("v2.112 NKL — auto-derived proven dead-ends", () => {
  it("a base that failed ≥2× and never succeeded is a dead-end", () => {
    const evs = [
      ev("docker build", "docker:build:1:", true, T, "cache miss"),
      ev("docker build", "docker:build:1:", true, T + 1000, "cache miss"),
    ];
    const de = deriveDeadEnds(evs);
    expect(de.length).toBe(1);
    expect(de[0]!.base).toBe("docker:build");
    expect(de[0]!.failures).toBe(2);
  });

  it("one success on that base CLEARS the dead-end (it worked once)", () => {
    const evs = [
      ev("docker build", "docker:build:1:", true, T),
      ev("docker build", "docker:build:1:", true, T + 1000),
      ev("docker build", "", false, T + 2000),
    ];
    expect(deriveDeadEnds(evs).length).toBe(0);
  });

  it("a single failure is NOT condemned (no premature dead-end)", () => {
    expect(deriveDeadEnds([ev("x", "x:1:", true, T)]).length).toBe(0);
  });

  it("checkApproach is advisory + consistent with deriveDeadEnds", () => {
    const evs = [
      ev("terraform apply", "terraform:apply:1:", true, T, "lock held"),
      ev("terraform apply", "terraform:apply:1:", true, T + 1000, "lock held"),
    ];
    const v = checkApproach(evs, "terraform apply -auto-approve");
    expect(v.isDeadEnd).toBe(true);
    expect(v.base).toBe("terraform:apply");
    expect(v.failures).toBe(2);
    expect(v.reason).toContain("advisory"); // never forbids
    expect(checkApproach(evs, "npm test").isDeadEnd).toBe(false);
  });

  it("nklStats summarises the corpus", () => {
    const evs = [
      ev("a b", "a:b:1:", true, T), ev("a b", "a:b:1:", true, T + 1),
      ev("c d", "", false, T + 2),
    ];
    const s = nklStats(evs);
    expect(s.totalEvents).toBe(3);
    expect(s.totalFailures).toBe(2);
    expect(s.deadEnds).toBe(1);
  });

  it("gauntlet scores 100", () => {
    const g = nklGauntlet();
    expect(g.detectsDeadEnd).toBe(true);
    expect(g.successClears).toBe(true);
    expect(g.noPrematureCondemn).toBe(true);
    expect(g.checkConsistent).toBe(true);
    expect(g.score).toBe(100);
  });

  it("STABILITY — total on garbage", () => {
    expect(() => deriveDeadEnds(null as never)).not.toThrow();
    expect(() => checkApproach(null as never, null as never)).not.toThrow();
    expect(() => nklStats(null as never)).not.toThrow();
    expect(deriveDeadEnds(null as never)).toEqual([]);
  });
});
