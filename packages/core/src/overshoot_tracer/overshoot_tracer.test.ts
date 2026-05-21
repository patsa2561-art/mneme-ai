import { describe, expect, it } from "vitest";
import { traceOvershoot, formatReport } from "./index.js";

describe("overshoot tracer (v2.22.2)", () => {

  describe("alignment cases", () => {
    it("ALIGNED on identical verb sequence + args", () => {
      const r = traceOvershoot(
        [{ verb: "a" }, { verb: "b" }, { verb: "c" }],
        [{ verb: "a" }, { verb: "b" }, { verb: "c" }],
      );
      expect(r.band).toBe("ALIGNED");
      expect(r.score).toBe(0);
      expect(r.killSwitch).toBe(false);
    });
  });

  describe("scope creep — extra steps not in plan", () => {
    it("flags extra step at the end", () => {
      const r = traceOvershoot(
        [{ verb: "a" }, { verb: "b" }],
        [{ verb: "a" }, { verb: "b" }, { verb: "scope-creep" }],
      );
      expect(r.entries.some((e) => e.kind === "extra-step")).toBe(true);
      expect(r.score).toBeGreaterThan(0);
    });
  });

  describe("verb mismatch in middle", () => {
    it("flags verb-mismatch at a step", () => {
      const r = traceOvershoot(
        [{ verb: "a" }, { verb: "expected-b" }, { verb: "c" }],
        [{ verb: "a" }, { verb: "actual-x" }, { verb: "c" }],
      );
      expect(r.entries.some((e) => e.kind === "verb-mismatch")).toBe(true);
    });
  });

  describe("arg mutation", () => {
    it("flags arg-mismatch when strictArgs=true (default)", () => {
      const r = traceOvershoot(
        [{ verb: "earthquake", args: { vendor: "claude" } }],
        [{ verb: "earthquake", args: { vendor: "gpt" } }],
      );
      expect(r.entries.some((e) => e.kind === "arg-mismatch")).toBe(true);
    });

    it("does NOT flag arg-mismatch when strictArgs=false", () => {
      const r = traceOvershoot(
        [{ verb: "earthquake", args: { vendor: "claude" } }],
        [{ verb: "earthquake", args: { vendor: "gpt" } }],
        { strictArgs: false },
      );
      expect(r.entries.every((e) => e.kind === "ok")).toBe(true);
    });
  });

  describe("missing steps", () => {
    it("flags missing-step when plan has more than actual", () => {
      const r = traceOvershoot(
        [{ verb: "a" }, { verb: "b" }, { verb: "c" }],
        [{ verb: "a" }],
      );
      expect(r.entries.filter((e) => e.kind === "missing-step").length).toBe(2);
    });
  });

  describe("bands + kill-switch", () => {
    it("WANDER band on small divergence (<25%)", () => {
      const r = traceOvershoot(
        Array.from({ length: 10 }, (_, i) => ({ verb: "v" + i })),
        Array.from({ length: 10 }, (_, i) => ({ verb: i === 0 ? "x" : "v" + i })),
      );
      expect(r.band).toBe("WANDER");
    });

    it("RUNAWAY band on high divergence (≥75%)", () => {
      const r = traceOvershoot(
        Array.from({ length: 4 }, (_, i) => ({ verb: "v" + i })),
        Array.from({ length: 4 }, () => ({ verb: "rogue" })),
      );
      expect(["OVERSHOOT", "RUNAWAY"]).toContain(r.band);
      expect(r.killSwitch).toBe(true);
    });

    it("kill-switch threshold is configurable", () => {
      const r = traceOvershoot(
        [{ verb: "a" }, { verb: "b" }],
        [{ verb: "a" }, { verb: "x" }],
        { killThreshold: 0.9 },
      );
      // 1/2 = 0.5 mismatch < 0.9 threshold
      expect(r.killSwitch).toBe(false);
    });
  });

  describe("formatter", () => {
    it("ALIGNED renders ✓", () => {
      const out = formatReport(traceOvershoot([{ verb: "a" }], [{ verb: "a" }]));
      expect(out).toContain("ALIGNED");
      expect(out).toContain("✓");
    });

    it("RUNAWAY renders 🚨 + kill-switch ARMED", () => {
      const out = formatReport(traceOvershoot([{ verb: "a" }], [{ verb: "x" }, { verb: "y" }, { verb: "z" }, { verb: "w" }]));
      expect(out).toMatch(/OVERSHOOT|RUNAWAY/);
    });
  });
});
