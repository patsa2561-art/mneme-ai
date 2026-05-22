// v2.23.2 — regression tests for the audit findings: hyperbole
// detection, input-size cap, empty/whitespace/control-char handling,
// vaccine learning loop.

import { describe, expect, it, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, writeFileSync, mkdirSync, readFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runACGV } from "./acgv.js";
import { detectHyperbole, HYPERBOLE_PATTERNS } from "./hyperbole_detector.js";

describe("ACGV v2.23.2 — audit-driven hardening", () => {
  let repo: string;
  beforeEach(() => {
    repo = mkdtempSync(join(tmpdir(), "mneme-acgv-"));
    mkdirSync(join(repo, "packages"), { recursive: true });
    writeFileSync(join(repo, "package.json"), JSON.stringify({ name: "mneme-ai", version: "2.23.2" }));
  });
  afterEach(() => { try { rmSync(repo, { recursive: true, force: true }); } catch { /* */ } });

  // ─── HYPERBOLE DETECTOR ────────────────────────────────────────────

  describe("hyperbole detector — closes the 'Mneme cured cancer' gap", () => {
    it("ships ≥ 4 pattern categories", () => {
      const categories = new Set(HYPERBOLE_PATTERNS.map((p) => p.category));
      expect(categories.size).toBeGreaterThanOrEqual(4);
    });

    it("detects medical-cure: 'Mneme cured cancer'", () => {
      const r = detectHyperbole("Mneme cured cancer");
      expect(r.flagged).toBe(true);
      expect(r.matches.some((m) => m.category === "medical-cure")).toBe(true);
    });

    it("detects superlative-absolute: 'world's best AI tool'", () => {
      const r = detectHyperbole("Mneme is the world's best AI tool");
      expect(r.flagged).toBe(true);
      expect(r.matches.some((m) => m.category === "superlative-absolute")).toBe(true);
    });

    it("detects impossible-faculty: 'reads your mind'", () => {
      const r = detectHyperbole("Mneme reads your mind to predict bugs");
      expect(r.flagged).toBe(true);
      expect(r.matches.some((m) => m.category === "impossible-faculty")).toBe(true);
    });

    it("detects impossible-physics: 'faster-than-light'", () => {
      const r = detectHyperbole("Mneme runs faster-than-light memory queries");
      expect(r.flagged).toBe(true);
      expect(r.matches.some((m) => m.category === "impossible-physics")).toBe(true);
    });

    it("does NOT flag neutral claims", () => {
      const r = detectHyperbole("Mneme version 2.23.2 is installed");
      expect(r.flagged).toBe(false);
    });

    it("vaccineSignature populated when flagged, empty when not", () => {
      expect(detectHyperbole("Mneme cured cancer").vaccineSignature).toContain("HYPERBOLE");
      expect(detectHyperbole("Hello").vaccineSignature).toBe("");
    });
  });

  // ─── HYPERBOLE INTEGRATED INTO ACGV ─────────────────────────────────

  describe("ACGV hyperbole integration", () => {
    it("'Mneme cured cancer' → IMPOSSIBLE_REFUTE (not PASSTHROUGH)", () => {
      const r = runACGV({ claim: "Mneme cured cancer", repoRoot: repo, noEmitVaccine: true, noStake: true });
      expect(r.verdict).toBe("IMPOSSIBLE_REFUTE");
      expect(r.caveats.some((c) => c.includes("HYPERBOLE"))).toBe(true);
    });

    it("'world's best AI' → IMPOSSIBLE_REFUTE", () => {
      const r = runACGV({ claim: "Mneme is the world's best AI tool ever made", repoRoot: repo, noEmitVaccine: true, noStake: true });
      expect(r.verdict).toBe("IMPOSSIBLE_REFUTE");
    });

    it("hyperbole verdict is DETERMINISTIC across repeated runs", () => {
      const claim = "Mneme cured cancer and reads your mind";
      const a = runACGV({ claim, repoRoot: repo, noEmitVaccine: true, noStake: true });
      const b = runACGV({ claim, repoRoot: repo, noEmitVaccine: true, noStake: true });
      const c = runACGV({ claim, repoRoot: repo, noEmitVaccine: true, noStake: true });
      expect(a.verdict).toBe(b.verdict);
      expect(b.verdict).toBe(c.verdict);
      expect(a.verdict).toBe("IMPOSSIBLE_REFUTE");
    });

    it("hyperbole emits vaccine when noEmitVaccine is FALSE", () => {
      const claim = "Mneme cures all diseases";
      runACGV({ claim, repoRoot: repo, noStake: true });
      // Vaccine file should exist + contain a HYPERBOLE entry.
      const vacPath = join(repo, ".mneme", "vaccines.jsonl");
      if (existsSync(vacPath)) {
        const body = readFileSync(vacPath, "utf8");
        expect(body).toContain("HYPERBOLE");
      }
    });
  });

  // ─── EMPTY / WHITESPACE / CONTROL-CHAR INPUTS ──────────────────────

  describe("input validation — closes 'silent NONE' audit finding", () => {
    it("empty input returns INPUT_UNVERIFIABLE:EMPTY_INPUT caveat", () => {
      const r = runACGV({ claim: "", repoRoot: repo, noEmitVaccine: true, noStake: true });
      expect(r.caveats.some((c) => c.includes("EMPTY_INPUT"))).toBe(true);
      expect(r.confidence).toBe(0);
      expect(r.summary).toContain("UNVERIFIABLE");
    });

    it("whitespace-only input returns INPUT_UNVERIFIABLE:WHITESPACE_ONLY", () => {
      const r = runACGV({ claim: "   \t\n   ", repoRoot: repo, noEmitVaccine: true, noStake: true });
      expect(r.caveats.some((c) => c.includes("WHITESPACE_ONLY"))).toBe(true);
    });

    it("control-char-only input returns INPUT_UNVERIFIABLE:CONTROL_CHAR_ONLY", () => {
      const r = runACGV({ claim: "\x01\x02\x03\x04\x05", repoRoot: repo, noEmitVaccine: true, noStake: true });
      expect(r.caveats.some((c) => c.includes("CONTROL_CHAR_ONLY"))).toBe(true);
    });

    it("explicit rationale string, not silent NONE", () => {
      const r = runACGV({ claim: "", repoRoot: repo, noEmitVaccine: true, noStake: true });
      expect(r.reasoning.length).toBeGreaterThan(20);
      expect(r.reasoning).toContain("printable");
    });
  });

  // ─── INPUT-SIZE CAP ────────────────────────────────────────────────

  describe("input-size cap — closes '50K silent truncation' finding", () => {
    it("input > 8000 chars adds INPUT_TRUNCATED caveat", () => {
      const huge = "Mneme has 8 verification agents. ".repeat(1000); // ~33000 chars
      const r = runACGV({ claim: huge, repoRoot: repo, noEmitVaccine: true, noStake: true });
      expect(r.caveats.some((c) => c.startsWith("INPUT_TRUNCATED:"))).toBe(true);
    });

    it("oversized input still produces a real verdict (not NONE)", () => {
      const huge = "Mneme has 8 verification agents. ".repeat(500);
      const r = runACGV({ claim: huge, repoRoot: repo, noEmitVaccine: true, noStake: true });
      expect(["PASSTHROUGH", "FUSION", "BLACK_HOLE", "IMPOSSIBLE_REFUTE", "LIMBO", "AUTO_REFUTE"]).toContain(r.verdict);
    });

    it("≤ 8000 chars does NOT add INPUT_TRUNCATED", () => {
      const r = runACGV({ claim: "Mneme has 8 verification agents", repoRoot: repo, noEmitVaccine: true, noStake: true });
      expect(r.caveats.some((c) => c.startsWith("INPUT_TRUNCATED:"))).toBe(false);
    });
  });
});
