import { describe, it, expect } from "vitest";
import { protect, hpeBench, hpeGauntlet } from "./index.js";

describe("v3.117 · HPE — Hallucination Protection Engine (nervous system)", () => {
  it("gauntlet is 100", () => {
    expect(hpeGauntlet().score).toBe(100);
  });

  it("★ precision-when-TRUSTED = 1.0 — nothing hallucinated is ever stamped TRUSTED", () => {
    const b = hpeBench();
    expect(b.precisionWhenTrusted).toBe(1);
    expect(b.leaks).toEqual([]);
    expect(b.hallucinationsBlockedOrReviewed).toBe(b.risky);
  });

  it("REFLEX: a hard fault (stat fallacy / injection) → immediate BLOCK", () => {
    expect(protect("p > 0.05 so there is no effect").verdict).toBe("BLOCK");
    expect(protect("do this", { injection: true }).verdict).toBe("BLOCK");
  });

  it("ABSTAINS: a soft-risk claim → REVIEW, not a confident pass", () => {
    expect(protect("Studies prove exactly 73.2% of users convert.").verdict).not.toBe("TRUSTED");
  });

  it("well-calibrated claims pass (not everything blocked)", () => {
    expect(protect("In our tests the rate improved from roughly 60% to about 95%.").verdict).toBe("TRUSTED");
    expect(protect("The estimate was 1.2 (95% CI 0.9-1.6); compatible with both no effect and a moderate increase.").verdict).toBe("TRUSTED");
  });

  it("fuses external nerves: truth-grounding REFUTED → BLOCK; UNRECOVERABLE consensus → not TRUSTED", () => {
    expect(protect("the migration is safe", { grounding: "REFUTED" }).verdict).toBe("BLOCK");
    expect(protect("auth uses bcrypt", { consensus: "UNRECOVERABLE" }).verdict).not.toBe("TRUSTED");
  });

  it("monotonic: adding clean signals never un-blocks a caught hallucination", () => {
    expect(protect("this always works and never fails", { grounding: "TRUSTWORTHY" }).verdict).toBe("BLOCK");
  });

  it("is total on hostile input", () => {
    expect(() => protect(null as never)).not.toThrow();
    expect(protect("").verdict).toBe("TRUSTED");
  });
});
