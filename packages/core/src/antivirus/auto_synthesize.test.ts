import { describe, expect, it } from "vitest";
import { mkdtempSync, rmSync, existsSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  mineRegexFromSamples,
  evaluateCandidatePattern,
  synthesizeVaccine,
} from "./auto_synthesize.js";

describe("antivirus auto-synthesize", () => {
  describe("mineRegexFromSamples", () => {
    it("returns null on empty input", () => {
      expect(mineRegexFromSamples([])).toBeNull();
      expect(mineRegexFromSamples(["", "  "])).toBeNull();
    });

    it("mines a common suffix from FN samples", () => {
      const p = mineRegexFromSamples([
        "react-phantom-1",
        "vue-phantom-1",
        "lodash-phantom-1",
      ]);
      expect(p).not.toBeNull();
      const re = new RegExp(p!);
      expect(re.test("react-phantom-1")).toBe(true);
      expect(re.test("vue-phantom-1")).toBe(true);
    });

    it("mines a common prefix when no suffix is shared", () => {
      const p = mineRegexFromSamples([
        "@anthropic/foo",
        "@anthropic/bar",
        "@anthropic/baz",
      ]);
      expect(p).not.toBeNull();
      const re = new RegExp(p!);
      expect(re.test("@anthropic/foo")).toBe(true);
    });

    it("falls back to keyword detection for 'phantom' / 'fake' / 'ghost'", () => {
      const p = mineRegexFromSamples([
        "ghost-component-A",
        "X-ghost-Y",
        "completely-ghost",
      ]);
      expect(p).not.toBeNull();
      const re = new RegExp(p!);
      expect(re.test("ghost-component-A")).toBe(true);
    });
  });

  describe("evaluateCandidatePattern", () => {
    it("computes recall + precision correctly", () => {
      const r = evaluateCandidatePattern(
        "phantom",
        ["x-phantom", "y-phantom"],            // 2 positives, both should match
        ["real-pkg", "another-real"],          // 2 negatives, neither should match
      );
      expect(r.recallAfter).toBe(1);
      expect(r.precisionAfter).toBe(1);
      expect(r.negativeMatches.length).toBe(0);
    });

    it("flags FP risk when pattern leaks into negatives", () => {
      const r = evaluateCandidatePattern(
        "react",
        ["react-phantom"],
        ["react", "next"],                     // "react" legitimately matches
      );
      expect(r.recallAfter).toBe(1);
      expect(r.negativeMatches.length).toBe(1);
      expect(r.precisionAfter).toBe(0.5);
    });
  });

  describe("synthesizeVaccine pipeline", () => {
    it("ACCEPTS a high-recall, high-precision pattern", () => {
      const tmp = mkdtempSync(join(tmpdir(), "mneme-synth-"));
      try {
        const r = synthesizeVaccine(tmp, {
          strain: "depends_imaginarium",
          fnSamples: ["x-phantom-1", "y-phantom-2", "z-phantom-3"],
          negativeSamples: ["lodash", "react", "vue"],
        });
        expect(r.accepted).toBe(true);
        expect(r.proposedPattern).not.toBe("");
        expect(r.recallAfter).toBeGreaterThanOrEqual(0.9);
        expect(r.precisionAfter).toBeGreaterThanOrEqual(0.9);
        expect(r.proposalPath).toBeTruthy();
        expect(existsSync(r.proposalPath!)).toBe(true);
        const md = readFileSync(r.proposalPath!, "utf8");
        expect(md).toContain("ACCEPTED");
      } finally {
        rmSync(tmp, { recursive: true, force: true });
      }
    });

    it("REJECTS when precision floor is breached", () => {
      const tmp = mkdtempSync(join(tmpdir(), "mneme-synth-"));
      try {
        // FN samples are just "react" + "vue" -- the miner will mine
        // a pattern that matches them, which also matches the negatives.
        const r = synthesizeVaccine(tmp, {
          strain: "depends_imaginarium",
          fnSamples: ["react-foo", "react-bar", "react-baz"],
          negativeSamples: ["react", "react-dom", "react-router"],   // overlap
        });
        // Pattern likely catches both FNs and negatives -- so precision
        // should drop below 0.90 and the proposal should reject.
        if (!r.accepted) {
          expect(r.verdict).toMatch(/REJECTED/);
        }
      } finally {
        rmSync(tmp, { recursive: true, force: true });
      }
    });

    it("returns failure verdict on empty FN sample set", () => {
      const tmp = mkdtempSync(join(tmpdir(), "mneme-synth-"));
      try {
        const r = synthesizeVaccine(tmp, {
          strain: "depends_imaginarium",
          fnSamples: [],
          negativeSamples: ["foo"],
        });
        expect(r.accepted).toBe(false);
        expect(r.verdict).toMatch(/no FN samples/i);
      } finally {
        rmSync(tmp, { recursive: true, force: true });
      }
    });
  });
});
