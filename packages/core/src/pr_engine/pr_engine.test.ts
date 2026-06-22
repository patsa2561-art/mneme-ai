import { describe, it, expect } from "vitest";
import { verifyLaunchClaims, buildLaunchKit, prEngineGauntlet } from "./index.js";

describe("v3.135 · PR ENGINE — launch copy that can't lie", () => {
  it("gauntlet is 100", () => expect(prEngineGauntlet().score).toBe(100));

  it("rejects overclaims + superlatives, approves measured claims", () => {
    const r = verifyLaunchClaims([
      "Deterministic, MIT-licensed, runs locally.",
      "The world's best tool, 100% accurate, never wrong.",
      "Studies prove exactly 99.9% of users love it.",
      "It always works and never fails on any input.",
    ]);
    expect(r.approved).toContain("Deterministic, MIT-licensed, runs locally.");
    expect(r.rejected.length).toBe(3);
  });

  it("★ zero-overclaim: no rejected claim survives into the assembled copy", () => {
    const kit = buildLaunchKit({ product: "X", url: "https://e.x", claims: ["Runs locally, MIT-licensed.", "The greatest, 100% accurate, never wrong tool ever."] });
    expect(kit.clean).toBe(true);
    const blob = [kit.hn.title, kit.hn.body, ...kit.x, kit.reddit.body, kit.changelog].join("\n");
    expect(blob).not.toMatch(/never wrong|100% accurate|greatest/i);
    expect(kit.hn.title).toContain("X");
  });

  it("is total on hostile input", () => {
    expect(() => buildLaunchKit(null as never)).not.toThrow();
    expect(buildLaunchKit({ product: "X", claims: [] }).approved).toEqual([]);
  });
});
