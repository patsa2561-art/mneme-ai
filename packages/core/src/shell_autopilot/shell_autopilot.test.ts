import { describe, it, expect } from "vitest";
import { failureSignature, suggestRecovery, generateHook, recoveryKey, autopilotGauntlet, RECOVERY_RULES } from "./index.js";

describe("v2.106 SHELL AUTOPILOT — phantom recovery engine", () => {
  it("a successful command (exit 0) yields no suggestion", () => {
    expect(suggestRecovery("npm test", 0).recovery).toBeNull();
  });

  it("built-in rules fire for common failures (deterministic)", () => {
    expect(suggestRecovery("git push", 1, "fatal: The current branch has no upstream branch").recovery).toBe("git push -u origin HEAD");
    expect(suggestRecovery("git push", 1, "Updates were rejected because the remote contains work").recovery).toBe("git pull --rebase");
    expect(suggestRecovery("node app.js", 1, "Error: Cannot find module 'express'").recovery).toBe("npm install");
    expect(suggestRecovery("foobar", 127, "command not found: foobar").source).toBe("rule");
  });

  it("THE INNOVATION — a LEARNED recovery (from the user's dark data) beats the rule", () => {
    const sig = failureSignature("git push", 1, "no upstream");
    const learned = { [sig]: "git push --set-upstream origin HEAD" };
    const s = suggestRecovery("git push", 1, "no upstream branch", learned);
    expect(s.source).toBe("learned");
    expect(s.recovery).toBe("git push --set-upstream origin HEAD");
    expect(s.confidence).toBe("high");
  });

  it("signature is STABLE across variable args (so one recovery covers many commands)", () => {
    expect(failureSignature("git push origin feature-a", 1, "no upstream"))
      .toBe(failureSignature("git push origin feature-b", 1, "no upstream"));
    expect(recoveryKey("git:push:1:no-upstream")).toBe("shell.recovery:git:push:1:no-upstream");
  });

  it("generates NON-DESTRUCTIVE, sentinel-bracketed hooks for all 3 OS shells", () => {
    for (const shell of ["powershell", "bash", "zsh"] as const) {
      const h = generateHook(shell);
      expect(h).toContain(">>> mneme shell autopilot >>>");
      expect(h).toContain("<<< mneme shell autopilot <<<");
      // never auto-runs the suggestion
      expect(h).not.toContain("Invoke-Expression");
      expect(/eval\s+["']?\$s/.test(h)).toBe(false);
    }
    // powershell preserves the user's existing prompt (non-clobbering)
    expect(generateHook("powershell")).toContain("__mneme_prevPrompt");
    // a custom bin invocation flows through
    expect(generateHook("bash", "node /x/mneme.js")).toContain("node /x/mneme.js shell suggest");
  });

  it("autopilot gauntlet scores 100", () => {
    const g = autopilotGauntlet();
    expect(g.rulesFire).toBe(true);
    expect(g.learnedWins).toBe(true);
    expect(g.signatureStable).toBe(true);
    expect(g.hookSafe).toBe(true);
    expect(g.stable).toBe(true);
    expect(g.score).toBe(100);
  });

  it("STABILITY — total on garbage", () => {
    expect(() => suggestRecovery(null as never, null as never)).not.toThrow();
    expect(suggestRecovery(null as never, null as never).source).toBe("none");
    expect(() => failureSignature(null as never, null as never)).not.toThrow();
    expect(() => generateHook("bash")).not.toThrow();
    expect(RECOVERY_RULES.length).toBeGreaterThan(0);
  });
});
