import { describe, it, expect } from "vitest";
import {
  AlwaysAcceptPruner,
  CompositePruner,
  type ConstraintPruner,
  type PruneInput,
  type PruneOutput,
} from "./constraint-pruner.js";

/** Helper: pruner that always returns the verdict you tell it to. */
function fixed<C, P>(
  name: string,
  out: PruneOutput,
): ConstraintPruner<C, P> {
  return {
    name,
    description: `fixed pruner returning ${out.verdict}`,
    validate: (_input: PruneInput<C, P>): PruneOutput => out,
  };
}

const sampleInput: PruneInput<string, number> = {
  candidate: "candidate-x",
  pathState: 0,
};

describe("AlwaysAcceptPruner", () => {
  it("returns accept for any input", () => {
    const p = new AlwaysAcceptPruner<string, number>();
    expect(p.validate(sampleInput).verdict).toBe("accept");
  });

  it("has a populated name and description", () => {
    const p = new AlwaysAcceptPruner<string, number>();
    expect(p.name).toBe("AlwaysAcceptPruner");
    expect(p.description.length).toBeGreaterThan(0);
  });
});

describe("CompositePruner — composition rules", () => {
  it("[accept, accept] → accept", () => {
    const c = new CompositePruner<string, number>([
      fixed("p1", { verdict: "accept", reason: "ok-1" }),
      fixed("p2", { verdict: "accept", reason: "ok-2" }),
    ]);
    const out = c.validate(sampleInput);
    expect(out.verdict).toBe("accept");
    expect(out.reason).toContain("2");
  });

  it("[accept, reject] → reject (first reject wins, severity preserved)", () => {
    const c = new CompositePruner<string, number>([
      fixed("p1", { verdict: "accept", reason: "ok" }),
      fixed("p2", {
        verdict: "reject",
        reason: "bad",
        severity: "high",
      }),
    ]);
    const out = c.validate(sampleInput);
    expect(out.verdict).toBe("reject");
    expect(out.reason).toBe("bad");
    expect(out.severity).toBe("high");
  });

  it("[uncertain, accept] → accept (uncertain does NOT short-circuit)", () => {
    const c = new CompositePruner<string, number>([
      fixed("p1", { verdict: "uncertain", reason: "dunno" }),
      fixed("p2", { verdict: "accept", reason: "ok" }),
    ]);
    expect(c.validate(sampleInput).verdict).toBe("accept");
  });

  it("[uncertain, uncertain] → uncertain (returns last uncertain reason)", () => {
    const c = new CompositePruner<string, number>([
      fixed("p1", { verdict: "uncertain", reason: "first-doubt" }),
      fixed("p2", { verdict: "uncertain", reason: "second-doubt" }),
    ]);
    const out = c.validate(sampleInput);
    expect(out.verdict).toBe("uncertain");
    expect(out.reason).toBe("second-doubt");
  });

  it("[reject, ...anything] short-circuits — later pruners are not invoked", () => {
    let calls = 0;
    const probe: ConstraintPruner<string, number> = {
      name: "probe",
      description: "counts calls",
      validate: () => {
        calls++;
        return { verdict: "accept", reason: "ok" };
      },
    };
    const c = new CompositePruner<string, number>([
      fixed("p1", { verdict: "reject", reason: "stop", severity: "critical" }),
      probe,
    ]);
    const out = c.validate(sampleInput);
    expect(out.verdict).toBe("reject");
    expect(out.severity).toBe("critical");
    expect(calls).toBe(0);
  });

  it("empty composite returns accept", () => {
    const c = new CompositePruner<string, number>([]);
    const out = c.validate(sampleInput);
    expect(out.verdict).toBe("accept");
    expect(out.reason).toContain("no pruners");
  });

  it("populates name + description, including child names", () => {
    const c = new CompositePruner<string, number>(
      [
        fixed("alpha", { verdict: "accept", reason: "ok" }),
        fixed("beta", { verdict: "accept", reason: "ok" }),
      ],
      "MyComposite",
    );
    expect(c.name).toBe("MyComposite");
    expect(c.description).toContain("alpha");
    expect(c.description).toContain("beta");
  });
});
