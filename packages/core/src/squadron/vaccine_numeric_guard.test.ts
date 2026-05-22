// v2.28.0 — Discrete root tests for R1 vaccine numeric-fact guard.
// Each test PINS exactly one logic branch; if any branch regresses,
// the test fails forever. This is the BUG IMMUNITY PROTOCOL.

import { describe, it, expect } from "vitest";
import {
  numericsInSignature,
  numericsInClaim,
  vaccineConflictsWithClaim,
} from "./vaccine_numeric_guard.js";

describe("R1 — numericsInSignature (BUG IMMUNITY)", () => {
  it("extracts integer from `key=N` shape", () => {
    expect(numericsInSignature("IMPOSSIBLE_REFUTE :: swarm_organ_count=8")).toEqual([{ key: "swarm_organ_count", value: 8 }]);
  });
  it("extracts version major from `key=2.19.34` shape", () => {
    expect(numericsInSignature("BLACK_HOLE :: version=2.19.34")).toEqual([{ key: "version", value: 2 }]);
  });
  it("returns empty when no numerics", () => {
    expect(numericsInSignature("HYPERBOLE :: cured cancer")).toEqual([]);
  });
  it("handles multiple key=N pairs", () => {
    const r = numericsInSignature("foo=1 bar=2 baz=3");
    expect(r.length).toBe(3);
  });
});

describe("R1 — numericsInClaim (BUG IMMUNITY)", () => {
  it("extracts `9 verification agents` shape", () => {
    const r = numericsInClaim("Mneme has 9 verification agents");
    expect(r.some((n) => n.value === 9 && /verification|agents/.test(n.key))).toBe(true);
  });
  it("extracts vN.M version shape", () => {
    const r = numericsInClaim("Mneme v2.27.0 is great");
    expect(r.some((n) => n.value === 2 && n.key === "version")).toBe(true);
  });
  it("returns empty for prose without numbers", () => {
    expect(numericsInClaim("a quick brown fox").length).toBe(0);
  });
});

describe("R1 — vaccineConflictsWithClaim (BUG IMMUNITY)", () => {
  it("BURNS vaccine when sig says swarm_organ_count=8 + claim says 9 verification agents", () => {
    const r = vaccineConflictsWithClaim("IMPOSSIBLE_REFUTE :: swarm_organ_count=8", "Mneme has 9 verification agents");
    expect(r.conflict).toBe(true);
  });
  it("BURNS vaccine when sig says agents=8 + claim says 9 agents", () => {
    const r = vaccineConflictsWithClaim("X :: agents=8", "9 agents");
    expect(r.conflict).toBe(true);
  });
  it("BURNS vaccine when sig says tools=1290 + claim says 800 tools", () => {
    const r = vaccineConflictsWithClaim("FAKE :: tools=1290", "the catalog has 800 tools");
    expect(r.conflict).toBe(true);
  });
  it("KEEPS vaccine when sig has NO numerics", () => {
    expect(vaccineConflictsWithClaim("HYPERBOLE :: cured cancer", "9 agents").conflict).toBe(false);
  });
  it("KEEPS vaccine when claim has NO numerics", () => {
    expect(vaccineConflictsWithClaim("X :: agents=8", "Mneme is fast").conflict).toBe(false);
  });
  it("KEEPS vaccine when numbers match (true positive — vaccine still valid)", () => {
    expect(vaccineConflictsWithClaim("X :: agents=8", "Mneme has 8 agents").conflict).toBe(false);
  });
  it("KEEPS vaccine when keys are semantically UNRELATED", () => {
    // sig "agents=8" should not block a claim about "9 megabytes"
    expect(vaccineConflictsWithClaim("X :: agents=8", "the file is 9 megabytes").conflict).toBe(false);
  });
});
