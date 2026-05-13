import { describe, it, expect } from "vitest";
import { randomBytes } from "node:crypto";
import { sealProphecy, unsealProphecy, gradeProphecy, formatProphecyPulseLine } from "./index.js";

describe("v2.0 PROPHECY LETTERS · time-locked cross-version", () => {
  const secret = randomBytes(32);

  it("seal returns envelope with id + signature + keyFingerprint", () => {
    const p = sealProphecy({
      fromVersion: "2.0.0",
      toMinVersion: "2.5.0",
      text: "By v2.5 we'll have IBM Quantum wired.",
      predictions: [{ topic: "ibm-quantum", claim: "wired by v2.5", verifyHint: "check qx_bridge providers.ts for runIbm impl" }],
      secret,
    });
    expect(p.id).toMatch(/^[a-f0-9]{12}$/);
    expect(p.signature.length).toBe(64);
    expect(p.keyFingerprint).toBeTruthy();
  });

  it("SEALED verdict when current version < required", () => {
    const p = sealProphecy({
      fromVersion: "2.0.0",
      toMinVersion: "2.5.0",
      text: "x",
      predictions: [],
      secret,
      earliestOpenAt: Date.now() - 1000, // time-lock already past
    });
    const r = unsealProphecy({ prophecy: p, currentVersion: "2.0.0", secret });
    expect(r.verdict).toBe("SEALED");
    expect(r.reason).toContain("version");
  });

  it("SEALED verdict when time-lock not yet expired", () => {
    const p = sealProphecy({
      fromVersion: "2.0.0",
      toMinVersion: "2.0.0",
      text: "x",
      predictions: [],
      secret,
      earliestOpenAt: Date.now() + 1000 * 60 * 60,
    });
    const r = unsealProphecy({ prophecy: p, currentVersion: "2.5.0", secret });
    expect(r.verdict).toBe("SEALED");
    expect(r.reason).toContain("time-lock");
  });

  it("OPENABLE verdict when version AND time gate pass + signature valid", () => {
    const p = sealProphecy({
      fromVersion: "2.0.0",
      toMinVersion: "2.0.0",
      text: "x",
      predictions: [],
      secret,
      earliestOpenAt: Date.now() - 1000,
    });
    const r = unsealProphecy({ prophecy: p, currentVersion: "2.5.0", secret });
    expect(r.verdict).toBe("OPENABLE");
    expect(r.prophecy).toBeDefined();
  });

  it("TAMPERED verdict when signature was forged", () => {
    const p = sealProphecy({
      fromVersion: "2.0.0",
      toMinVersion: "2.0.0",
      text: "x",
      predictions: [],
      secret,
      earliestOpenAt: Date.now() - 1000,
    });
    p.signature = "0".repeat(64);
    const r = unsealProphecy({ prophecy: p, currentVersion: "2.5.0", secret });
    expect(r.verdict).toBe("TAMPERED");
  });

  it("WRONG_KEY verdict on wrong secret", () => {
    const p = sealProphecy({
      fromVersion: "2.0.0",
      toMinVersion: "2.0.0",
      text: "x",
      predictions: [],
      secret,
      earliestOpenAt: Date.now() - 1000,
    });
    const wrong = randomBytes(32);
    const r = unsealProphecy({ prophecy: p, currentVersion: "2.5.0", secret: wrong });
    expect(r.verdict).toBe("WRONG_KEY");
  });

  it("gradeProphecy computes consistency 0..1", () => {
    const p = sealProphecy({
      fromVersion: "2.0.0",
      toMinVersion: "2.5.0",
      text: "x",
      predictions: [
        { topic: "ibm-quantum", claim: "wired", verifyHint: "" },
        { topic: "dwave-qubo", claim: "wired", verifyHint: "" },
        { topic: "ggwave-audio", claim: "shipped", verifyHint: "" },
      ],
      secret,
    });
    const r = gradeProphecy({
      prophecy: p,
      observations: [
        { topic: "ibm-quantum", cameTrue: true },
        { topic: "dwave-qubo", cameTrue: false },
        { topic: "ggwave-audio", cameTrue: true },
      ],
    });
    expect(r.total).toBe(3);
    expect(r.correct).toBe(2);
    expect(r.consistency).toBeCloseTo(2 / 3, 3);
  });

  it("formatProphecyPulseLine produces compact summary", () => {
    const p = sealProphecy({ fromVersion: "2.0.0", toMinVersion: "2.5.0", text: "x", predictions: [], secret });
    expect(formatProphecyPulseLine(p)).toContain("PROPHECY");
  });
});
