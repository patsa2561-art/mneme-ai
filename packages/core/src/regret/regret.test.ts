import { describe, it, expect } from "vitest";
import { buildRegretModel, scoreRegret, vendorRegret, wilson, regretGauntlet, type RegretEvent } from "./index.js";

function corpus(): RegretEvent[] {
  const ev: RegretEvent[] = [];
  for (let i = 0; i < 20; i++) ev.push({ features: ["primitive:network", "vendor:grok"], regretted: i < 18 });
  for (let i = 0; i < 30; i++) ev.push({ features: ["area:docs", "vendor:claude"], regretted: false });
  ev.push({ features: ["area:experimental"], regretted: true });
  ev.push({ features: ["area:experimental"], regretted: true });
  return ev;
}

describe("v2.140 · REGRET ORACLE — signed cross-vendor regret calibration", () => {
  it("gauntlet is 100", () => {
    expect(regretGauntlet().score).toBe(100);
  });

  it("a proven-risky signal scores HIGH; a proven-safe one scores LOW", () => {
    const m = buildRegretModel(corpus());
    expect(scoreRegret(m, ["primitive:network"]).band).toBe("HIGH");
    expect(scoreRegret(m, ["area:docs"]).band).toBe("LOW");
  });

  it("abstains UNKNOWN under low support — even at a 100% point rate", () => {
    const m = buildRegretModel(corpus());
    const s = scoreRegret(m, ["area:experimental"]); // 2/2 regretted but n<5
    expect(s.band).toBe("UNKNOWN");
  });

  it("reports a conservative Wilson LOWER bound (below the point rate)", () => {
    const m = buildRegretModel(corpus());
    const s = scoreRegret(m, ["primitive:network"]);
    expect(s.regretRateLowerBound).toBeLessThan(s.observedRate);
  });

  it("Wilson interval tightens (lower bound rises) with more data at the same rate", () => {
    expect(wilson(90, 100).low).toBeGreaterThan(wilson(9, 10).low);
  });

  it("compares vendors by proven risk", () => {
    const vr = vendorRegret(buildRegretModel(corpus()));
    expect(vr[0]!.feature).toBe("vendor:grok");
    expect(vr[0]!.wilsonLow).toBeGreaterThan(vr[1]!.wilsonLow);
  });

  it("is total on hostile input", () => {
    expect(() => buildRegretModel(null as never)).not.toThrow();
    expect(() => scoreRegret(null as never, null as never)).not.toThrow();
    expect(() => wilson(NaN, -1)).not.toThrow();
    expect(() => buildRegretModel([{ features: 1 as never, regretted: "x" as never }])).not.toThrow();
  });
});
