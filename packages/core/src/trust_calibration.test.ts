import { describe, expect, it, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  gradeSubsystem, readGrade, readAllGrades, selfDowngradeAnnotation,
  FORENSICS_VULNS_BENCHMARK, ASK_SEMANTIC_BENCHMARK,
} from "./trust_calibration.js";

describe("trust_calibration", () => {
  let repo: string;
  beforeEach(() => { repo = mkdtempSync(join(tmpdir(), "mneme-trust-")); });
  afterEach(() => { try { rmSync(repo, { recursive: true, force: true }); } catch { /* */ } });

  describe("benchmark catalogs", () => {
    it("FORENSICS_VULNS_BENCHMARK has both TPs and FPs", () => {
      const tps = FORENSICS_VULNS_BENCHMARK.filter((c) => c.expected);
      const fps = FORENSICS_VULNS_BENCHMARK.filter((c) => !c.expected);
      expect(tps.length).toBeGreaterThanOrEqual(3);
      expect(fps.length).toBeGreaterThanOrEqual(3);
    });
    it("ASK_SEMANTIC_BENCHMARK has both relevant + off-topic pairs", () => {
      const yes = ASK_SEMANTIC_BENCHMARK.filter((c) => c.expected);
      const no = ASK_SEMANTIC_BENCHMARK.filter((c) => !c.expected);
      expect(yes.length).toBeGreaterThanOrEqual(2);
      expect(no.length).toBeGreaterThanOrEqual(2);
    });
  });

  describe("gradeSubsystem", () => {
    it("returns 'excellent' band for a perfect probe", async () => {
      const grade = await gradeSubsystem(
        repo,
        "forensics_vulns",
        FORENSICS_VULNS_BENCHMARK,
        (input) => input.codeSnippet.includes("rm ") || input.codeSnippet.includes("password = \"") || input.codeSnippet.includes("ecb") || input.codeSnippet.includes("eval(req") || /SELECT.*\+/.test(input.codeSnippet),
      );
      expect(grade.band).toBe("excellent");
      expect(grade.precision).toBeCloseTo(1, 5);
      expect(grade.recall).toBeCloseTo(1, 5);
    });

    it("returns 'untrusted' band for a probe that's wrong on everything", async () => {
      // Probe always returns false -- catches no TPs (recall=0).
      const grade = await gradeSubsystem(
        repo,
        "forensics_vulns",
        FORENSICS_VULNS_BENCHMARK,
        () => false,
      );
      expect(grade.tp).toBe(0);
      expect(grade.recall).toBe(0);
      // band is "untrusted" (P null + R 0) OR "weak" depending on exact thresholds.
      expect(["untrusted", "weak", "unknown"]).toContain(grade.band);
    });

    it("returns 'weak' band for a high-FP probe (the user's reported scenario)", async () => {
      // Probe always returns TRUE -- catches every TP but flags every FP too.
      const grade = await gradeSubsystem(
        repo,
        "forensics_vulns",
        FORENSICS_VULNS_BENCHMARK,
        () => true,
      );
      expect(grade.recall).toBe(1);          // catches everything
      expect(grade.precision).toBeLessThan(0.75);  // but high FPs
      expect(["weak", "untrusted"]).toContain(grade.band);
      expect(grade.outputAnnotation).toContain("CALIBRATION:");
    });

    it("persists the grade so readGrade returns it on the next call", async () => {
      await gradeSubsystem(repo, "forensics_vulns", FORENSICS_VULNS_BENCHMARK, () => true);
      const persisted = readGrade(repo, "forensics_vulns");
      expect(persisted).not.toBeNull();
      expect(persisted!.subsystem).toBe("forensics_vulns");
    });

    it("readAllGrades returns every persisted subsystem", async () => {
      await gradeSubsystem(repo, "forensics_vulns", FORENSICS_VULNS_BENCHMARK, () => true);
      await gradeSubsystem(repo, "ask_semantic", ASK_SEMANTIC_BENCHMARK, () => false);
      const all = readAllGrades(repo);
      expect(Object.keys(all).sort()).toEqual(["ask_semantic", "forensics_vulns"]);
    });
  });

  describe("selfDowngradeAnnotation", () => {
    it("returns null when no grade exists", () => {
      expect(selfDowngradeAnnotation(repo, "forensics_vulns")).toBeNull();
    });
    it("returns the annotation when subsystem is in weak/untrusted band", async () => {
      await gradeSubsystem(repo, "forensics_vulns", FORENSICS_VULNS_BENCHMARK, () => true);
      const ann = selfDowngradeAnnotation(repo, "forensics_vulns");
      expect(ann).toContain("[CALIBRATION:");
    });
    it("returns null when subsystem is excellent", async () => {
      await gradeSubsystem(
        repo,
        "forensics_vulns",
        FORENSICS_VULNS_BENCHMARK,
        (input) => input.codeSnippet.includes("rm ") || input.codeSnippet.includes("password = \"") || input.codeSnippet.includes("ecb") || input.codeSnippet.includes("eval(req") || /SELECT.*\+/.test(input.codeSnippet),
      );
      expect(selfDowngradeAnnotation(repo, "forensics_vulns")).toBeNull();
    });
  });

  describe("data-loss safety", () => {
    it("survives malformed grades file", () => {
      const grades = join(repo, ".mneme", "trust-grades.json");
      const fs = require("node:fs");
      fs.mkdirSync(join(repo, ".mneme"), { recursive: true });
      fs.writeFileSync(grades, "not json", "utf8");
      // readGrade + readAllGrades must not throw.
      expect(readGrade(repo, "forensics_vulns")).toBeNull();
      expect(readAllGrades(repo)).toEqual({});
    });
    it("ranAt timestamp is ISO format", async () => {
      const grade = await gradeSubsystem(repo, "forensics_vulns", FORENSICS_VULNS_BENCHMARK, () => false);
      expect(grade.ranAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    });
    it("creates .mneme dir on first persist", async () => {
      await gradeSubsystem(repo, "forensics_vulns", FORENSICS_VULNS_BENCHMARK, () => false);
      expect(existsSync(join(repo, ".mneme"))).toBe(true);
      expect(existsSync(join(repo, ".mneme", "trust-grades.json"))).toBe(true);
    });
  });
});
