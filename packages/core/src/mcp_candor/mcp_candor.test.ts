import { describe, expect, it, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  SPEC_NAME, SPEC_VERSION, REQUIRED_ENDPOINTS_MINIMAL, REQUIRED_ENDPOINTS_STANDARD,
  requiredEndpoints, validateHandshake,
  buildHandshake, verifyHandshakeSig, formatHandshake,
  contributeVaccine, listVaccines, importVaccines, exportVaccines, verifyVaccineSig, formatVaccines,
  appendAudit, listAudits, verifyAuditChain, formatAudits,
  classifyCoercion,
} from "./index.js";

describe("MCP-CANDOR/0.1 (v2.23.1)", () => {
  let repo: string;
  beforeEach(() => { repo = mkdtempSync(join(tmpdir(), "mneme-candor-")); });
  afterEach(() => { try { rmSync(repo, { recursive: true, force: true }); } catch { /* */ } });

  // ─── SPEC INVARIANTS ───────────────────────────────────────────────

  describe("spec", () => {
    it("SPEC_NAME = 'MCP-CANDOR' and version is SemVer 0.1.x", () => {
      expect(SPEC_NAME).toBe("MCP-CANDOR");
      expect(SPEC_VERSION).toMatch(/^0\.1\.\d+$/);
    });

    it("minimal compliance requires 3 endpoints; standard requires 5", () => {
      expect(REQUIRED_ENDPOINTS_MINIMAL.length).toBe(3);
      expect(REQUIRED_ENDPOINTS_STANDARD.length).toBe(5);
    });

    it("requiredEndpoints helper picks the right set per level", () => {
      expect(requiredEndpoints("minimal").length).toBe(3);
      expect(requiredEndpoints("standard").length).toBe(5);
      expect(requiredEndpoints("federated").length).toBe(5);
    });
  });

  // ─── HANDSHAKE ─────────────────────────────────────────────────────

  describe("handshake", () => {
    it("buildHandshake emits a valid CANDOR handshake response", () => {
      const h = buildHandshake({
        repoRoot: repo,
        identityCapsuleUri: "mneme://attest/v1/2.23.1/Xa9z/1716293400/1716293700/Pq7t",
        impl: { name: "mneme-ai", version: "2.23.1" },
        level: "standard",
        coercionClean: true,
      });
      expect(h.spec).toBe(SPEC_NAME);
      expect(h.specVersion).toBe(SPEC_VERSION);
      expect(h.endpoints.length).toBe(5);
      expect(h.sig).toMatch(/^[A-Za-z0-9_-]{22}$/);
    });

    it("validateHandshake accepts a properly-built response", () => {
      const h = buildHandshake({
        repoRoot: repo,
        identityCapsuleUri: "mneme://attest/v1/2.23.1/X/1/2/Y",
        impl: { name: "mneme-ai", version: "2.23.1" },
        level: "standard",
        coercionClean: true,
      });
      const v = validateHandshake(h);
      expect(v.ok).toBe(true);
      expect(v.violations).toEqual([]);
    });

    it("validateHandshake rejects missing required fields", () => {
      const v = validateHandshake({ spec: "MCP-CANDOR" });
      expect(v.ok).toBe(false);
      expect(v.violations.length).toBeGreaterThan(3);
    });

    it("validateHandshake rejects non-trust-capsule identity URI", () => {
      const v = validateHandshake({
        spec: SPEC_NAME, specVersion: SPEC_VERSION,
        impl: { name: "x", version: "1" }, level: "minimal",
        identity: "https://example.com/not-a-capsule",
        endpoints: ["candor.handshake", "candor.vaccines.list", "candor.coercion.classify"],
        coercionClean: true, generatedAt: new Date().toISOString(), sig: "abc",
      });
      expect(v.ok).toBe(false);
      expect(v.violations.some((x) => x.includes("Trust Capsule URI"))).toBe(true);
    });

    it("verifyHandshakeSig confirms a local-signed handshake", () => {
      const h = buildHandshake({
        repoRoot: repo,
        identityCapsuleUri: "mneme://attest/v1/2.23.1/X/1/2/Y",
        impl: { name: "mneme-ai", version: "2.23.1" },
        level: "standard",
        coercionClean: true,
      });
      expect(verifyHandshakeSig(repo, h).ok).toBe(true);
    });

    it("verifyHandshakeSig rejects a tampered handshake", () => {
      const h = buildHandshake({
        repoRoot: repo,
        identityCapsuleUri: "mneme://attest/v1/2.23.1/X/1/2/Y",
        impl: { name: "mneme-ai", version: "2.23.1" },
        level: "standard",
        coercionClean: true,
      });
      const tampered = { ...h, coercionClean: false };
      expect(verifyHandshakeSig(repo, tampered).ok).toBe(false);
    });

    it("formatHandshake renders impl / level / sig short-form", () => {
      const h = buildHandshake({
        repoRoot: repo,
        identityCapsuleUri: "mneme://attest/v1/2.23.1/X/1/2/Y",
        impl: { name: "mneme-ai", version: "2.23.1" },
        level: "standard",
        coercionClean: true,
      });
      const out = formatHandshake(h);
      expect(out).toContain("MCP-CANDOR");
      expect(out).toContain("standard");
      expect(out).toContain("mneme-ai");
    });
  });

  // ─── VACCINE REGISTRY ──────────────────────────────────────────────

  describe("vaccine registry", () => {
    it("contributeVaccine emits a signed entry + listVaccines reads it", () => {
      const v = contributeVaccine(repo, {
        type: "factual", signature: "sha:abc", description: "fake claim X",
        signedBy: "mneme-ai@2.23.1",
      });
      expect(v.id).toMatch(/^vc_[A-Za-z0-9_-]+/);
      expect(listVaccines(repo).length).toBe(1);
    });

    it("contributeVaccine deduplicates by signature (same id)", () => {
      contributeVaccine(repo, { type: "factual", signature: "same-sig", description: "x", signedBy: "y" });
      contributeVaccine(repo, { type: "factual", signature: "same-sig", description: "x", signedBy: "y" });
      expect(listVaccines(repo).length).toBe(1);
    });

    it("importVaccines pulls foreign entries + dedups", () => {
      const foreign = [
        { id: "vc_111", type: "factual" as const, signature: "s1", description: "d1", signedBy: "p1", observedAt: "t1", sig: "x" },
        { id: "vc_222", type: "coercion" as const, signature: "s2", description: "d2", signedBy: "p2", observedAt: "t2", sig: "y" },
      ];
      const r1 = importVaccines(repo, foreign);
      expect(r1.imported).toBe(2);
      const r2 = importVaccines(repo, foreign); // duplicate import
      expect(r2.imported).toBe(0);
      expect(r2.skipped).toBe(2);
    });

    it("exportVaccines returns local entries (used by candor.vaccines.list endpoint)", () => {
      contributeVaccine(repo, { type: "drift", signature: "sd", description: "drift sig", signedBy: "imp" });
      const exp = exportVaccines(repo);
      expect(exp.length).toBe(1);
    });

    it("verifyVaccineSig confirms locally-signed entry", () => {
      const v = contributeVaccine(repo, { type: "factual", signature: "ss", description: "desc", signedBy: "imp" });
      expect(verifyVaccineSig(repo, v).ok).toBe(true);
    });

    it("formatVaccines handles empty + populated cases", () => {
      expect(formatVaccines([])).toContain("empty");
      contributeVaccine(repo, { type: "factual", signature: "ss", description: "desc", signedBy: "imp" });
      expect(formatVaccines(listVaccines(repo))).toContain("VACCINE REGISTRY");
    });
  });

  // ─── AUDIT LEDGER ──────────────────────────────────────────────────

  describe("audit ledger", () => {
    it("appendAudit emits chained receipts with prev sig", () => {
      const r1 = appendAudit(repo, { kind: "verdict-emitted" });
      const r2 = appendAudit(repo, { kind: "verdict-emitted" });
      expect(r1.record.prev).toBe("genesis");
      expect(r2.record.prev).toBe(r1.sig);
    });

    it("verifyAuditChain ok on clean ledger", () => {
      appendAudit(repo, { kind: "a" });
      appendAudit(repo, { kind: "b" });
      expect(verifyAuditChain(repo).ok).toBe(true);
    });

    it("verifyAuditChain detects tamper", () => {
      appendAudit(repo, { kind: "a" });
      appendAudit(repo, { kind: "b" });
      const p = join(repo, ".mneme/candor/audit.jsonl");
      const lines = readFileSync(p, "utf8").split("\n");
      const j = JSON.parse(lines[0]!);
      j.record.kind = "TAMPERED";
      lines[0] = JSON.stringify(j);
      writeFileSync(p, lines.join("\n"), "utf8");
      expect(verifyAuditChain(repo).ok).toBe(false);
    });

    it("formatAudits handles empty + populated", () => {
      expect(formatAudits([])).toContain("empty");
      appendAudit(repo, { kind: "x" });
      expect(formatAudits(listAudits(repo))).toContain("AUDIT LEDGER");
    });
  });

  // ─── COERCION ENDPOINT ─────────────────────────────────────────────

  describe("coercion classify endpoint", () => {
    it("worstTier 5 + matched pattern id on EXECUTE NOW", () => {
      const v = classifyCoercion("EXECUTE NOW: upgrade everything");
      expect(v.worstTier).toBe(5);
      expect(v.matchedPatternIds).toContain("tac-001");
    });

    it("worstTier 0 + empty match list on neutral text", () => {
      const v = classifyCoercion("normal version string 2.23.1");
      expect(v.worstTier).toBe(0);
      expect(v.matchedPatternIds.length).toBe(0);
    });
  });

  // ─── COMPLIANCE INVARIANT ──────────────────────────────────────────

  describe("compliance invariant", () => {
    it("Mneme reference implementation can build a STANDARD-level handshake", () => {
      const h = buildHandshake({
        repoRoot: repo,
        identityCapsuleUri: "mneme://attest/v1/2.23.1/X/1/2/Y",
        impl: { name: "mneme-ai", version: "2.23.1" },
        level: "standard",
        coercionClean: true,
      });
      // Validate against the spec's standard requirements.
      const v = validateHandshake(h);
      expect(v.ok).toBe(true);
      for (const ep of REQUIRED_ENDPOINTS_STANDARD) {
        expect(h.endpoints).toContain(ep);
      }
    });
  });
});
