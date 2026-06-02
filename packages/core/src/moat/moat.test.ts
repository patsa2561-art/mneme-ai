import { describe, it, expect } from "vitest";
import { scoreMoat, moatGauntlet, BASELINE_CAPS, CURRENT_CAPS, type MoatSignals } from "./index.js";

const sig: MoatSignals = { myceliumGauntlet: 100, canonGauntlet: 100, governorGauntlet: 100, gatewayAccuracy: 1, siegeResistanceLB: 0.86 };

describe("v2.150 · MOAT — deterministic competitive-moat scorer", () => {
  it("gauntlet is 100", () => {
    expect(moatGauntlet().score).toBe(100);
  });

  it("AFTER measurably beats BEFORE (the session's builders raised the moat)", () => {
    const before = scoreMoat({ capabilities: BASELINE_CAPS, signals: sig });
    const after = scoreMoat({ capabilities: CURRENT_CAPS, signals: sig });
    expect(after.overall).toBeGreaterThan(before.overall + 10);
    expect(after.band).toBe("FORTRESS");
  });

  it("overall is exactly the weighted sum; sub-scores bounded [0,100]", () => {
    const r = scoreMoat({ capabilities: CURRENT_CAPS, signals: sig });
    const recomputed = Math.round(r.dimensions.reduce((s, d) => s + d.score * d.weight, 0));
    expect(r.overall).toBe(recomputed);
    expect(r.dimensions.every((d) => d.score >= 0 && d.score <= 100)).toBe(true);
  });

  it("a dimension with no capability gets 0 credit (can't inflate)", () => {
    const noSiege = scoreMoat({ capabilities: CURRENT_CAPS.filter((c) => c !== "siege"), signals: sig });
    expect(noSiege.dimensions.find((d) => d.dimension === "adversarial-resistance")?.score).toBe(0);
  });

  it("empty capabilities score low; total on hostile input", () => {
    expect(scoreMoat({ capabilities: [] }).overall).toBeLessThan(10);
    expect(() => scoreMoat(null as never)).not.toThrow();
    expect(() => scoreMoat({ capabilities: null as never })).not.toThrow();
  });
});
