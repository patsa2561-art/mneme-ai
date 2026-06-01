import { describe, it, expect } from "vitest";
import { blindContext, unblindOutput, blindGauntlet } from "./index.js";

const SRC = `const apiSecretToken = "x";
export function chargeFinancialAccount(userPasswordHash: string): number {
  const internalLedger = 5;
  return internalLedger;
}`;

describe("v2.127 BLIND — sensitive mode", () => {
  it("replaces sensitive identifiers with placeholders, real names not leaked", () => {
    const r = blindContext(SRC, { mode: "sensitive" });
    expect(r.blinded).not.toContain("apiSecretToken");
    expect(r.blinded).not.toContain("chargeFinancialAccount");
    expect(r.blinded).not.toContain("userPasswordHash");
    expect(r.blinded).not.toContain("internalLedger");
    expect(r.identifiersBlinded).toBeGreaterThanOrEqual(4);
  });
  it("keeps language keywords intact (code stays parseable)", () => {
    const r = blindContext(SRC, { mode: "sensitive" });
    expect(r.blinded).toContain("function");
    expect(r.blinded).toContain("return");
    expect(r.blinded).toContain("const");
  });
  it("round-trips: unblind(blinded, map) restores the real names", () => {
    const r = blindContext(SRC, { mode: "sensitive", redactSecrets: false });
    expect(unblindOutput(r.blinded, r.map)).toBe(SRC);
  });
  it("a model edit referencing placeholders unblinds to real names", () => {
    const r = blindContext(SRC, { mode: "sensitive" });
    const ph = Object.keys(r.map).find((p) => r.map[p] === "internalLedger")!;
    expect(unblindOutput(`${ph} = 999;`, r.map)).toBe("internalLedger = 999;");
  });
});

describe("v2.127 BLIND — secrets + protect list + aggressive", () => {
  it("removes secret literals entirely (not recoverable from the map)", () => {
    const s = `const k = "sk-proj-ABCDEFGHIJ1234567890zzz";`;
    const r = blindContext(s, { redactSecrets: true });
    expect(r.blinded).not.toContain("sk-proj-ABCDEFGHIJ");
    expect(JSON.stringify(r.map)).not.toContain("sk-proj-ABCDEFGHIJ");
    expect(r.secretsRedacted).toBeGreaterThanOrEqual(1);
  });
  it("--protect blinds explicitly-named identifiers even if not 'sensitive'", () => {
    const s = `const widgetCount = computeThing(widgetCount);`;
    const r = blindContext(s, { protect: ["widgetCount"] });
    expect(r.blinded).not.toContain("widgetCount");
    expect(r.blinded).toContain("computeThing"); // not protected, sensitive-mode leaves it
  });
  it("aggressive mode blinds all user identifiers except keywords", () => {
    const s = `function helper(input) { return input + helper(input); }`;
    const r = blindContext(s, { mode: "aggressive" });
    expect(r.blinded).not.toContain("helper");
    expect(r.blinded).not.toContain("input");
    expect(r.blinded).toContain("function");
    expect(r.blinded).toContain("return");
    expect(unblindOutput(r.blinded, r.map)).toBe(s);
  });
  it("placeholder prefix avoids collisions with existing MZ-like tokens", () => {
    const s = `const MZ1 = secretValue;`;
    const r = blindContext(s, { protect: ["secretValue"] });
    // MZ1 already present → a different prefix is chosen, MZ1 preserved
    expect(r.blinded).toContain("MZ1");
    expect(r.prefix).not.toBe("MZ");
  });
});

describe("v2.127 BLIND — totality + gauntlet", () => {
  it("is TOTAL on garbage", () => {
    expect(() => blindContext(null as never)).not.toThrow();
    expect(() => unblindOutput(null as never, null as never)).not.toThrow();
    expect(blindContext(null as never).blinded).toBe("");
  });
  it("blindGauntlet() = 100", () => {
    const g = blindGauntlet();
    expect(g.score).toBe(100);
    expect(g.roundTripExact).toBe(true);
    expect(g.namesNotLeaked).toBe(true);
    expect(g.bijection).toBe(true);
    expect(g.secretsGone).toBe(true);
    expect(g.structurePreserved).toBe(true);
    expect(g.editRoundTrips).toBe(true);
    expect(g.deterministic).toBe(true);
    expect(g.stable).toBe(true);
  });
});
