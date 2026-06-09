import { describe, it, expect } from "vitest";
import { reason, prove, explain, parseProgram, logicGauntlet } from "./index.js";

const rules = [{ id: "r-deploy", when: ["tests_pass", "reviewed"], then: "can_deploy" }, { id: "r-tests", when: ["built"], then: "tests_pass" }];

describe("logic_engine", () => {
  it("gauntlet is 100", () => expect(logicGauntlet().score).toBe(100));

  it("PROVEN: a valid chain follows, with a proof tree", () => {
    const p = prove(["built", "reviewed"], rules, "can_deploy");
    expect(p.status).toBe("PROVEN");
    expect(p.chain.map((s) => s.atom)).toContain("tests_pass");          // intermediate derived
    expect(p.chain[p.chain.length - 1].atom).toBe("can_deploy");
  });

  it("UNKNOWN, never false: a goal that doesn't follow", () => {
    expect(prove(["built"], rules, "can_deploy").status).toBe("UNKNOWN");
  });

  it("CONTRADICTED: premises entail a mutually-exclusive pair", () => {
    const p = prove(["safe", "reads(web,users)"], [{ when: ["reads(web,users)"], then: "breaks_consumer" }], "safe", [{ all: ["safe", "breaks_consumer"] }]);
    expect(p.status).toBe("CONTRADICTED");
    expect(p.contradictions[0].atoms).toContain("breaks_consumer");
  });

  it("closure + sound proof: derived atoms trace to facts", () => {
    const r = reason(["built", "reviewed"], rules);
    expect(r.derived).toContain("can_deploy");
    expect(r.proof["tests_pass"].from).toEqual(["built"]);
    expect(explain(r, "can_deploy").length).toBeGreaterThanOrEqual(3);
  });

  it("text DSL parses facts/rules/mutexes/goal", () => {
    const prog = parseProgram("a\nb\na & b => c\nnever: c & x\ngoal: c");
    expect(prog.facts).toEqual(["a", "b"]);
    expect(prog.rules[0]).toMatchObject({ when: ["a", "b"], then: "c" });
    expect(prog.mutexes[0].all).toEqual(["c", "x"]);
    expect(prog.goal).toBe("c");
  });

  it("never throws on garbage", () => {
    expect(() => reason(null as never, null as never)).not.toThrow();
    expect(() => prove(null as never, null as never, null as never)).not.toThrow();
    expect(() => parseProgram(null as never)).not.toThrow();
  });
});
