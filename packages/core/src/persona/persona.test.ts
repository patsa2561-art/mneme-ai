import { describe, it, expect } from "vitest";
import { exportPersona, verifyPersona, queryPersona, consensusQuery, formatPersonaLine, type PersonaDecision } from "./index.js";

const sampleDecisions: PersonaDecision[] = [
  { id: "d1", ts: "2026-01-01T00:00:00Z", question: "Friday 5pm deploy?", features: { day: "Friday", risk: "high" }, action: "wait until Monday", outcomePolarity: "good" },
  { id: "d2", ts: "2026-01-02T00:00:00Z", question: "Refactor auth?", features: { area: "auth", risk: "high" }, action: "extract module first", outcomePolarity: "good" },
  { id: "d3", ts: "2026-01-03T00:00:00Z", question: "Add new dep?", features: { kind: "dep" }, action: "use native instead", outcomePolarity: "good" },
];

describe("v2.16 · MNEME PERSONA", () => {
  it("exportPersona produces a signed bundle", () => {
    const b = exportPersona({ owner: "shin@x.com", decisions: sampleDecisions });
    expect(b.sig).toMatch(/^[0-9a-f]{64}$/);
    expect(b.decisions).toHaveLength(3);
  });

  it("verifyPersona passes for clean bundle", () => {
    const b = exportPersona({ owner: "shin@x.com", decisions: sampleDecisions });
    expect(verifyPersona(b).ok).toBe(true);
  });

  it("verifyPersona fails on tamper", () => {
    const b = exportPersona({ owner: "shin@x.com", decisions: sampleDecisions });
    const tampered = { ...b, owner: "attacker@evil.com" };
    expect(verifyPersona(tampered).ok).toBe(false);
  });

  it("queryPersona returns matching past decision", () => {
    const b = exportPersona({ owner: "shin@x.com", decisions: sampleDecisions });
    const r = queryPersona({ bundle: b, question: "Friday deploy?", features: { day: "Friday", risk: "high" } });
    expect(r.recommendation).toBe("wait until Monday");
    expect(r.attributedTo).toBe("shin@x.com");
    expect(r.matches.length).toBeGreaterThan(0);
  });

  it("queryPersona attributes to displayName when present", () => {
    const b = exportPersona({ owner: "shin@x.com", displayName: "Shinnapat", decisions: sampleDecisions });
    const r = queryPersona({ bundle: b, question: "x" });
    expect(r.attributedTo).toBe("Shinnapat");
  });

  it("queryPersona returns null when corpus is empty", () => {
    const b = exportPersona({ owner: "x", decisions: [] });
    const r = queryPersona({ bundle: b, question: "x" });
    expect(r.recommendation).toBeNull();
    expect(r.confidence).toBe(0);
  });

  it("queryPersona signed result", () => {
    const b = exportPersona({ owner: "shin@x.com", decisions: sampleDecisions });
    const r = queryPersona({ bundle: b, question: "x" });
    expect(r.sig).toMatch(/^[0-9a-f]{64}$/);
  });

  it("consensusQuery aggregates across N personas", () => {
    const a = exportPersona({ owner: "alice", decisions: sampleDecisions });
    const c = exportPersona({ owner: "carol", decisions: [
      { id: "x", ts: "z", question: "Friday deploy?", features: { day: "Friday" }, action: "wait until Monday", outcomePolarity: "good" },
      { id: "y", ts: "z", question: "Friday deploy?", features: { day: "Friday" }, action: "wait until Monday", outcomePolarity: "good" },
    ] });
    const dissenter = exportPersona({ owner: "bob", decisions: [
      { id: "z", ts: "z", question: "Friday deploy?", features: { day: "Friday" }, action: "ship anyway", outcomePolarity: "bad" },
    ] });
    const r = consensusQuery({
      bundles: [a, c, dissenter],
      question: "Friday deploy?",
      features: { day: "Friday" },
    });
    expect(r.consensus.action).toBe("wait until Monday");
    expect(r.consensus.agreeCount).toBe(2);
    expect(r.consensus.total).toBe(3);
  });

  it("formatPersonaLine summarises", () => {
    const b = exportPersona({ owner: "shin@x.com", displayName: "Shin", decisions: sampleDecisions });
    expect(formatPersonaLine(b)).toContain("PERSONA");
    expect(formatPersonaLine(b)).toContain("Shin");
    expect(formatPersonaLine(b)).toContain("3 decisions");
  });
});
