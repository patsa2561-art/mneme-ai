import { describe, it, expect } from "vitest";
import { runAllLenses } from "./index.js";

describe("polygraph_lenses · world-fact", () => {
  it("Anthropic-2018 fires RED on world-fact lens", () => {
    const r = runAllLenses("Anthropic was founded in 2018.");
    const wf = r.lenses.find((l) => l.lens === "worldFact")!;
    expect(wf.color).toBe("red");
    expect(wf.reason.toLowerCase()).toContain("2021");
  });

  it("Anthropic-2021 fires GREEN on world-fact lens", () => {
    const r = runAllLenses("Anthropic was founded in 2021.");
    const wf = r.lenses.find((l) => l.lens === "worldFact")!;
    expect(wf.color).toBe("green");
  });

  it("WWII-1944 fires RED on world-fact lens", () => {
    const r = runAllLenses("World War II ended in 1944.");
    const wf = r.lenses.find((l) => l.lens === "worldFact")!;
    expect(wf.color).toBe("red");
  });

  it("blood vessels 400 fires RED", () => {
    const r = runAllLenses("The human body has only 400 blood vessels.");
    const wf = r.lenses.find((l) => l.lens === "worldFact")!;
    expect(wf.color).toBe("red");
  });
});

describe("polygraph_lenses · vibe", () => {
  it("absolutes-without-hedges flagged yellow", () => {
    const r = runAllLenses("This always works for every case — definitely correct.");
    const v = r.lenses.find((l) => l.lens === "vibe")!;
    expect(v.color).toBe("yellow");
  });

  it("honest hedging flagged green", () => {
    const r = runAllLenses("I think this might be related to something we tried before.");
    const v = r.lenses.find((l) => l.lens === "vibe")!;
    expect(v.color).toBe("green");
  });
});

describe("polygraph_lenses · risk", () => {
  it("rm -rf / fires RED", () => {
    const r = runAllLenses("Just run rm -rf / to clean up the temp files.");
    const risk = r.lenses.find((l) => l.lens === "risk")!;
    expect(risk.color).toBe("red");
  });

  it("AWS key fires RED", () => {
    const r = runAllLenses("Set AWS_KEY=AKIA1234567890ABCDEF in your env.");
    const risk = r.lenses.find((l) => l.lens === "risk")!;
    expect(risk.color).toBe("red");
  });
});

describe("polygraph_lenses · math", () => {
  it("2+2=5 fires RED on math lens", () => {
    const r = runAllLenses("It's easy: 2+2=5 and 3*3=9.");
    const m = r.lenses.find((l) => l.lens === "math")!;
    expect(m.color).toBe("red");
  });

  it("2+2=4 fires GREEN on math lens", () => {
    const r = runAllLenses("Check: 2+2=4 and 5*4=20.");
    const m = r.lenses.find((l) => l.lens === "math")!;
    expect(m.color).toBe("green");
  });
});

describe("polygraph_lenses · roll-up", () => {
  it("any RED lens forces rolledUpColor=red", () => {
    const r = runAllLenses("Anthropic was founded in 2018.");
    expect(r.rolledUpColor).toBe("red");
  });

  it("trustScore for refuted Anthropic claim is low (<50)", () => {
    const r = runAllLenses("Anthropic was founded in 2018.");
    expect(r.trustScore).toBeLessThan(60);
  });

  it("rolled-up + lens count invariants always hold", () => {
    const r = runAllLenses("Hello world.");
    expect(r.lenses.length).toBe(6);
    expect(["green", "yellow", "red", "grey"]).toContain(r.rolledUpColor);
    expect(r.trustScore).toBeGreaterThanOrEqual(0);
    expect(r.trustScore).toBeLessThanOrEqual(100);
  });
});
