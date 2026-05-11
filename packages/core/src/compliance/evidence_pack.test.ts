import { describe, expect, it, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, mkdirSync, writeFileSync, existsSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  composeEvidencePack, renderEvidencePackMarkdown,
  persistEvidencePack, verifyEvidencePack,
} from "./evidence_pack.js";

describe("compliance/evidence_pack", () => {
  let repo: string;
  beforeEach(() => {
    repo = mkdtempSync(join(tmpdir(), "mneme-comp-"));
    mkdirSync(join(repo, ".mneme"), { recursive: true });
  });
  afterEach(() => { try { rmSync(repo, { recursive: true, force: true }); } catch { /* */ } });

  describe("composeEvidencePack on empty repo", () => {
    it("returns a pack with safe defaults", () => {
      const pack = composeEvidencePack(repo, "1.37.0");
      expect(pack.generatedAt).toBeTruthy();
      expect(pack.mnemeVersion).toBe("1.37.0");
      expect(pack.packHash).toMatch(/^[a-f0-9]{64}$/);
      expect(pack.articles.length).toBeGreaterThanOrEqual(6);    // 4 EU + 1 SOC2 + 1 HIPAA
      expect(pack.sources.replayEntries).toBe(0);
    });
    it("Article 12 status is 'missing' when no replay entries", () => {
      const pack = composeEvidencePack(repo, "1.37.0");
      const art12 = pack.articles.find((a) => a.article.includes("Art. 12"));
      expect(art12?.status).toBe("missing");
    });
  });

  describe("source counting", () => {
    it("counts replay entries from .mneme/replay.jsonl", () => {
      const lines = Array.from({ length: 150 }, (_, i) => JSON.stringify({ idx: i })).join("\n");
      writeFileSync(join(repo, ".mneme/replay.jsonl"), lines, "utf8");
      const pack = composeEvidencePack(repo, "1.37.0");
      expect(pack.sources.replayEntries).toBe(150);
      const art12 = pack.articles.find((a) => a.article.includes("Art. 12"));
      expect(art12?.status).toBe("satisfied");
    });
    it("counts antivirus vaccines from pharmacopoeia", () => {
      mkdirSync(join(repo, ".mneme/antivirus"), { recursive: true });
      writeFileSync(
        join(repo, ".mneme/antivirus/pharmacopoeia.json"),
        JSON.stringify({ vaccines: [{ id: "a" }, { id: "b" }, { id: "c" }] }),
        "utf8",
      );
      const pack = composeEvidencePack(repo, "1.37.0");
      expect(pack.sources.antivirusVaccines).toBe(3);
    });
    it("counts trust grades", () => {
      writeFileSync(
        join(repo, ".mneme/trust-grades.json"),
        JSON.stringify({ forensics_vulns: { band: "weak" }, ask_semantic: { band: "acceptable" } }),
        "utf8",
      );
      const pack = composeEvidencePack(repo, "1.37.0");
      expect(pack.sources.trustGrades).toBe(2);
    });
    it("counts supernova entries", () => {
      writeFileSync(
        join(repo, ".mneme/supernova.jsonl"),
        Array.from({ length: 5 }, (_, i) => JSON.stringify({ outcome: "ok", idx: i })).join("\n"),
        "utf8",
      );
      const pack = composeEvidencePack(repo, "1.37.0");
      expect(pack.sources.supernovaEntries).toBe(5);
    });
  });

  describe("renderEvidencePackMarkdown", () => {
    it("produces audit-friendly markdown with hash + recompute instructions", () => {
      const pack = composeEvidencePack(repo, "1.37.0");
      const md = renderEvidencePackMarkdown(pack);
      expect(md).toContain("Mneme Compliance Evidence Pack");
      expect(md).toContain(pack.packHash);
      expect(md).toContain("recompute the hash");
      expect(md).toContain("EU-AI-Act Art. 12");
      expect(md).toContain("EU-AI-Act Art. 13");
      expect(md).toContain("EU-AI-Act Art. 14");
      expect(md).toContain("EU-AI-Act Art. 15");
      expect(md).toContain("SOC2");
      expect(md).toContain("HIPAA");
    });
  });

  describe("persistEvidencePack", () => {
    it("writes pack.json + pack.md to .mneme/compliance/<timestamp>/", () => {
      const pack = composeEvidencePack(repo, "1.37.0");
      const r = persistEvidencePack(repo, pack);
      expect(existsSync(r.jsonPath)).toBe(true);
      expect(existsSync(r.mdPath)).toBe(true);
      const reread = JSON.parse(readFileSync(r.jsonPath, "utf8"));
      expect(reread.packHash).toBe(pack.packHash);
    });
  });

  describe("verifyEvidencePack -- the AUDIT-TRAIL HOLOGRAM", () => {
    it("verifies an unmodified pack", () => {
      const pack = composeEvidencePack(repo, "1.37.0");
      const r = verifyEvidencePack(pack);
      expect(r.valid).toBe(true);
    });
    it("FAILS when an article is tampered", () => {
      const pack = composeEvidencePack(repo, "1.37.0");
      // Tamper with an article body.
      pack.articles[0]!.evidence = "TAMPERED";
      const r = verifyEvidencePack(pack);
      expect(r.valid).toBe(false);
      expect(r.reason).toContain("hash mismatch");
    });
    it("FAILS when sources counts are tampered", () => {
      const pack = composeEvidencePack(repo, "1.37.0");
      pack.sources.replayEntries = 99999;
      const r = verifyEvidencePack(pack);
      expect(r.valid).toBe(false);
    });
  });
});
