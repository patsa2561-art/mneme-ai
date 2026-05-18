import { describe, it, expect } from "vitest";
import { renderExplained, type ExplainedVerdict } from "./acgv_explain.js";

describe("v2.19.43 N8 · presentation-consistency invariant in renderExplained", () => {
  function build(trafficLight: ExplainedVerdict["trafficLight"], plain: string): ExplainedVerdict {
    return {
      headline: `Test headline · ${trafficLight}`,
      plain,
      nextAction: "act now",
      trafficLight,
      confidencePct: "90%",
    };
  }

  it("retains the matching emoji + neutralises the conflicting one (IMPOSSIBLE vs ACCEPTED)", () => {
    const ev = build("black", "✅ TRUTH-FORENSIC verdict: ACCEPTED. Every assertion grounded.");
    const out = renderExplained(ev, "Mneme is in Rust AND mneme.X.Y is registered").join("\n");
    // Headline glyph 🌑 must be present.
    expect(out).toContain("🌑");
    // The conflicting ✅ in the plain block must be neutralised.
    expect(out).not.toContain("✅");
    // The verdict TEXT (the word ACCEPTED) is preserved for transparency.
    expect(out).toContain("ACCEPTED");
  });

  it("green headline retains ✅ even when plain has ✅ (no neutralisation needed)", () => {
    const ev = build("green", "✅ all grounded");
    const out = renderExplained(ev, "claim").join("\n");
    expect(out.match(/✅/g)?.length).toBeGreaterThanOrEqual(2);
  });

  it("red headline neutralises green/black/yellow glyphs", () => {
    const ev = build("red", "✅ accepted · 🌑 impossible · ⚠️ mixed");
    const out = renderExplained(ev, "claim").join("\n");
    expect(out).toContain("❌");
    expect(out).not.toContain("✅");
    expect(out).not.toContain("🌑");
    expect(out).not.toContain("⚠️");
  });

  it("yellow headline keeps ⚠️ and neutralises others", () => {
    const ev = build("yellow", "✅ green · ❌ red");
    const out = renderExplained(ev, "claim").join("\n");
    expect(out).toContain("⚠️");
    expect(out).not.toContain("✅");
    expect(out).not.toContain("❌");
  });

  it("renders headline + claim + plain + nextAction in the documented order", () => {
    const ev = build("green", "details");
    const lines = renderExplained(ev, "the claim");
    expect(lines[0]).toMatch(/^✅ TRUSTWORTHY/);
    expect(lines[2]).toContain("the claim");
    expect(lines[5]).toContain("details");
    expect(lines[8]).toContain("act now");
  });
});
