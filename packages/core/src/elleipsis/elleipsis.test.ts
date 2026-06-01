import { describe, it, expect } from "vitest";
import { extractRequirements, checkCoverage, elleipsisReport, elleipsisGauntlet } from "./index.js";

describe("v2.136 · ELLEIPSIS — the omission/completeness gate", () => {
  it("gauntlet is 100", () => {
    expect(elleipsisGauntlet().score).toBe(100);
  });

  it("extracts multiple checkable asks (numbered + imperative + negation)", () => {
    const atoms = extractRequirements("1. Add a parseConfig function. 2. Write a unit test for it. 3. Don't touch the auth module.");
    expect(atoms.length).toBeGreaterThanOrEqual(3);
    expect(atoms.some((a) => a.kind === "negation")).toBe(true);
  });

  it("flags a silently-dropped requirement (UNADDRESSED)", () => {
    const r = elleipsisReport(
      "Add parseConfig and write a unit test for it.",
      "Added parseConfig in src/config.ts.", // no test
    );
    expect(r.gaps.some((g) => /test/i.test(g.atom.text) && g.coverage === "UNADDRESSED")).toBe(true);
    expect(r.unaddressed).toBeGreaterThanOrEqual(1);
  });

  it("does NOT false-flag a fully-covered request", () => {
    const r = elleipsisReport(
      "Add parseConfig and write a unit test for it.",
      "Added parseConfig in src/config.ts and wrote parseConfig.test.ts that tests it.",
    );
    expect(r.unaddressed).toBe(0);
    expect(r.violated).toBe(0);
  });

  it("catches a VIOLATED prohibition (you said don't touch X, it did)", () => {
    const r = elleipsisReport(
      "Implement the feature but don't touch the auth module.",
      "Implemented the feature. Also refactored the auth module's login flow.",
    );
    expect(r.verdicts.some((v) => v.atom.kind === "negation" && v.coverage === "VIOLATED")).toBe(true);
    expect(r.violated).toBeGreaterThanOrEqual(1);
  });

  it("respects an HONORED prohibition (subject mentioned as preserved)", () => {
    const r = elleipsisReport(
      "Implement the feature but don't touch the auth module.",
      "Implemented the feature in src/feature.ts. Left the auth module untouched.",
    );
    expect(r.verdicts.some((v) => v.atom.kind === "negation" && v.coverage === "COVERED")).toBe(true);
    expect(r.violated).toBe(0);
  });

  it("abstains to UNKNOWN on ambiguous partial signal (never fabricates an omission)", () => {
    const v = checkCoverage(extractRequirements("Add support for billing and invoice export."), "I added the billing flow.");
    expect(v.some((x) => x.coverage === "UNKNOWN" || x.coverage === "COVERED")).toBe(true);
  });

  it("completenessScore = covered / (covered + unaddressed + violated)", () => {
    const r = elleipsisReport("Add X. Add Y. Add Z.", "Added X.");
    expect(r.completenessScore).toBeCloseTo(r.covered / (r.covered + r.unaddressed + r.violated), 9);
  });

  it("is deterministic + total on hostile input", () => {
    expect(() => elleipsisReport(null as never, null as never)).not.toThrow();
    expect(() => extractRequirements(undefined as never)).not.toThrow();
    expect(() => checkCoverage(null as never, "x")).not.toThrow();
    const a = JSON.stringify(elleipsisReport("Add X. don't touch Y.", "Added X."));
    const b = JSON.stringify(elleipsisReport("Add X. don't touch Y.", "Added X."));
    expect(a).toBe(b);
  });
});
