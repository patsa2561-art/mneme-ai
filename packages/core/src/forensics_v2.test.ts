import { describe, expect, it, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  regexLayer, astShapeConfirms, scanV2,
  ghostFinding, readGhosts, findingFingerprint,
  DEFAULT_RULES,
  type ForensicsFinding,
} from "./forensics_v2.js";

describe("forensics_v2", () => {
  let repo: string;
  beforeEach(() => { repo = mkdtempSync(join(tmpdir(), "mneme-fv2-")); });
  afterEach(() => { try { rmSync(repo, { recursive: true, force: true }); } catch { /* */ } });

  describe("regexLayer (layer 1)", () => {
    it("flags command injection patterns", () => {
      const findings = regexLayer("server.js", `exec("rm " + req.body.path)`);
      expect(findings.length).toBeGreaterThan(0);
      expect(findings[0]!.rule).toBe("command-injection-exec");
      expect(findings[0]!.confirmedBy).toEqual(["regex"]);
    });
    it("flags hardcoded credentials", () => {
      const findings = regexLayer("config.js", `const password = "Adm1n@2024!secret";`);
      expect(findings.some((f) => f.rule === "hardcoded-credential")).toBe(true);
    });
    it("flags weak crypto (ECB)", () => {
      const findings = regexLayer("crypto.js", `const c = crypto.createCipheriv("aes-128-ecb", k, iv);`);
      expect(findings.some((f) => f.rule === "weak-crypto-ecb")).toBe(true);
    });
    it("computes line numbers correctly", () => {
      const src = "// l1\n// l2\nexec(\"rm \" + path);\n// l4";
      const findings = regexLayer("x.js", src);
      expect(findings[0]!.line).toBe(3);
    });
  });

  describe("astShapeConfirms (layer 2)", () => {
    it("CONFIRMS exec with req.body reference", () => {
      const f: ForensicsFinding = {
        fingerprint: "abc", rule: "command-injection-exec",
        filePath: "x.js", line: 1, match: `exec("rm " + req.body.path)`,
        confirmedBy: ["regex"], confidence: 0.45,
      };
      expect(astShapeConfirms(f)).toBe(true);
    });
    it("REJECTS exec with constant args (safe)", () => {
      const f: ForensicsFinding = {
        fingerprint: "abc", rule: "command-injection-exec",
        filePath: "x.js", line: 1, match: `exec("ls -la /tmp")`,
        confirmedBy: ["regex"], confidence: 0.45,
      };
      expect(astShapeConfirms(f)).toBe(false);
    });
    it("REJECTS hardcoded-cred matches in test files", () => {
      const f: ForensicsFinding = {
        fingerprint: "abc", rule: "hardcoded-credential",
        filePath: "user.test.js", line: 1, match: `password = "test_value_for_stub"`,
        confirmedBy: ["regex"], confidence: 0.45,
      };
      expect(astShapeConfirms(f)).toBe(false);
    });
    it("REJECTS placeholder credentials", () => {
      const f: ForensicsFinding = {
        fingerprint: "abc", rule: "hardcoded-credential",
        filePath: "config.js", line: 1, match: `password = "changeme"`,
        confirmedBy: ["regex"], confidence: 0.45,
      };
      expect(astShapeConfirms(f)).toBe(false);
    });
    it("CONFIRMS weak-crypto-ecb unconditionally", () => {
      const f: ForensicsFinding = {
        fingerprint: "abc", rule: "weak-crypto-ecb",
        filePath: "x.js", line: 1, match: `aes-128-ecb`,
        confirmedBy: ["regex"], confidence: 0.45,
      };
      expect(astShapeConfirms(f)).toBe(true);
    });
  });

  describe("ghost-negative log", () => {
    it("ghostFinding persists to .mneme/forensics-ghosts.jsonl", () => {
      const f: ForensicsFinding = {
        fingerprint: findingFingerprint("rule", "f.js", "match"),
        rule: "rule", filePath: "f.js", line: 1, match: "match",
        confirmedBy: ["regex"], confidence: 0.5,
      };
      ghostFinding(repo, f, "false positive in test fixture");
      expect(existsSync(join(repo, ".mneme/forensics-ghosts.jsonl"))).toBe(true);
      const ghosts = readGhosts(repo);
      expect(ghosts.has(f.fingerprint)).toBe(true);
    });
    it("readGhosts returns empty set when file missing", () => {
      expect(readGhosts(repo).size).toBe(0);
    });
    it("readGhosts survives malformed lines", () => {
      const fs = require("node:fs");
      fs.mkdirSync(join(repo, ".mneme"), { recursive: true });
      fs.writeFileSync(join(repo, ".mneme/forensics-ghosts.jsonl"),
        `{"fingerprint":"abc","rule":"r","filePath":"f","ghostedAt":"2026-05-11"}\nnot json\n{"fingerprint":"def","rule":"r2","filePath":"g","ghostedAt":"2026-05-11"}\n`,
        "utf8");
      const ghosts = readGhosts(repo);
      expect(ghosts.size).toBe(2);
      expect(ghosts.has("abc")).toBe(true);
      expect(ghosts.has("def")).toBe(true);
    });
  });

  describe("scanV2 pipeline", () => {
    it("ast layer suppresses regex-only matches with constant args", () => {
      const r = scanV2({
        repoRoot: repo,
        files: [
          { path: "safe.js", source: `exec("ls /tmp")` },                 // safe
          { path: "vuln.js", source: `exec("rm " + req.params.path)` },   // real
        ],
      });
      // Only the vuln should make it through the AST layer.
      expect(r.findings.length).toBe(1);
      expect(r.findings[0]!.filePath).toBe("vuln.js");
      expect(r.totalRegexMatches).toBe(2);
      expect(r.astSuppressed).toBe(1);
    });

    it("ghost-negative suppresses dismissed findings on subsequent scans", () => {
      const src = `eval(req.body.code)`;
      // First scan -- finding surfaces.
      const r1 = scanV2({ repoRoot: repo, files: [{ path: "x.js", source: src }] });
      expect(r1.findings.length).toBe(1);
      // User dismisses it.
      ghostFinding(repo, r1.findings[0]!, "intentional eval in sandbox runner");
      // Second scan -- finding is suppressed.
      const r2 = scanV2({ repoRoot: repo, files: [{ path: "x.js", source: src }] });
      expect(r2.findings.length).toBe(0);
      expect(r2.ghostSuppressed).toBe(1);
    });

    it("regexOnly=true mode keeps regex matches without AST gating (high recall)", () => {
      const r = scanV2({
        repoRoot: repo,
        files: [{ path: "safe.js", source: `exec("ls /tmp")` }],
        regexOnly: true,
      });
      expect(r.findings.length).toBe(1);   // regex match passes through
    });

    it("AST layer adds confidence delta on confirm", () => {
      const r = scanV2({
        repoRoot: repo,
        files: [{ path: "vuln.js", source: `exec("rm " + req.body.path)` }],
      });
      expect(r.findings[0]!.confidence).toBeCloseTo(0.75, 2);   // 0.45 + 0.30
      expect(r.findings[0]!.confirmedBy).toContain("ast");
    });

    it("multi-file scan reports aggregate metrics", () => {
      const r = scanV2({
        repoRoot: repo,
        files: [
          { path: "a.js", source: `exec("ls")` },                      // safe
          { path: "b.js", source: `exec("rm " + req.body.x)` },        // vuln
          { path: "c.js", source: `eval("2 + 2")` },                   // safe
        ],
      });
      expect(r.totalRegexMatches).toBeGreaterThanOrEqual(3);
      expect(r.findings.length).toBe(1);              // only b.js
      expect(r.astSuppressed).toBeGreaterThanOrEqual(2);
    });
  });
});
