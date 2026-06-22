import { describe, it, expect } from "vitest";
import { reconstructSeance, verifySeance, seanceGauntlet, type PastCommit } from "./index.js";

const MONTH = 30 * 24 * 3600;
function cs(n: number): PastCommit[] {
  return Array.from({ length: n }, (_, i) => ({
    hash: "h" + String(i).padStart(3, "0") + "deadbeef", author: "a", ts: 1_700_000_000 + i * MONTH,
    subject: i === 4 ? "revert the redis layer" : "feat(cache): work on the cache layer",
    body: i === 6 ? "Why: chose redis for multi-instance." : "", files: ["src/cache.ts"],
  }));
}

describe("v3.128 · SÉANCE — talk to your past self (grounded, cited)", () => {
  it("gauntlet is 100", () => expect(seanceGauntlet().score).toBe(100));

  it("reconstructs the decision at the ref + a real context window", () => {
    const c = cs(12);
    const p = reconstructSeance(c, c[6]!.hash, { now: c[11]!.ts });
    expect(p.decision.subject).toBe(c[6]!.subject);
    expect(p.decision.body).toContain("redis");
    expect(p.window.length).toBeGreaterThanOrEqual(5);
  });

  it("★ is grounded — nothing references a commit not in the history (verifySeance)", () => {
    const c = cs(10);
    const p = reconstructSeance(c, c[5]!.hash);
    expect(verifySeance(p, c).ok).toBe(true);
    // every cited window hash is a real commit
    const real = new Set(c.map((x) => x.hash.slice(0, 12)));
    expect(p.window.every((w) => real.has(w.hash))).toBe(true);
  });

  it("surfaces an abandoned path + is tamper-evident", () => {
    const c = cs(12);
    const p = reconstructSeance(c, c[4]!.hash, { windowBefore: 2, windowAfter: 2 });
    expect(p.abandoned.some((a) => /revert/i.test(a.subject))).toBe(true);
    const forged = { ...p, decision: { subject: "I clearly remember a reason I never wrote", body: "" } };
    expect(verifySeance(forged, c).ok).toBe(false);   // invented memory caught
  });

  it("is total on hostile input", () => {
    expect(() => reconstructSeance(null as never, "")).not.toThrow();
    expect(() => verifySeance(null as never, [])).not.toThrow();
    expect(reconstructSeance([], "x").seance).toBe("SEANCE/1");
  });
});
