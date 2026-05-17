import { describe, it, expect } from "vitest";
import {
  extractDecisions, compileAgreement, verifyAgreementPair, runAgreement,
  persistAgreement, loadAgreement, listAgreements,
  formatAgreementLine, formatCheckSummary, generatePreCommitHook,
} from "./index.js";
import { mkdtempSync, readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

describe("v2.19.6 · CONVERSATION COMPILER — chat → deterministic signed artifact", () => {
  // ── Extraction ────────────────────────────────────────────────────
  describe("extractDecisions — pattern recognition", () => {
    it("detects 'every commit must have a test' (English)", () => {
      const d = extractDecisions({ transcript: "We agreed: every commit must have a test before merging." });
      expect(d.find((x) => x.pattern === "test_required")).toBeDefined();
    });
    it("detects 'ทุก commit ต้องมี test' (Thai)", () => {
      const d = extractDecisions({ transcript: "ตกลงกันว่า ทุก commit ต้องมี test ก่อน merge" });
      expect(d.find((x) => x.pattern === "test_required")).toBeDefined();
    });

    // v2.19.30 G_a regression: user-reported canonical Thai bug
    it("G_a REGRESSION: detects 'ทุก commit ต้อง pass test' (Thai variant — 'pass' not 'มี')", () => {
      const d = extractDecisions({ transcript: "User: ทุก commit ต้อง pass test\nAI: ตกลง..." });
      expect(d.find((x) => x.pattern === "test_required")).toBeDefined();
    });
    it("G_a: detects 'ทุก commit ต้องผ่าน test' (Thai 'ผ่าน' variant)", () => {
      const d = extractDecisions({ transcript: "ทุก commit ต้องผ่าน test" });
      expect(d.find((x) => x.pattern === "test_required")).toBeDefined();
    });
    it("G_a: detects 'ทุก commit จำเป็นต้อง test'", () => {
      const d = extractDecisions({ transcript: "ทุก commit จำเป็นต้อง test ก่อน merge" });
      expect(d.find((x) => x.pattern === "test_required")).toBeDefined();
    });
    it("G_a: detects 'test ต้องผ่าน ก่อน commit'", () => {
      const d = extractDecisions({ transcript: "test ต้องผ่าน ก่อน commit เสมอ" });
      expect(d.find((x) => x.pattern === "test_required")).toBeDefined();
    });
    it("detects 'must use timingSafeEqual'", () => {
      const d = extractDecisions({ transcript: "All HMAC compares must use timingSafeEqual." });
      expect(d.find((x) => x.pattern === "timing_safe_equal_required")).toBeDefined();
    });
    it("detects 'no console.log in production'", () => {
      const d = extractDecisions({ transcript: "Rule: no console.log in production code." });
      expect(d.find((x) => x.pattern === "no_console_log")).toBeDefined();
    });
    it("detects 'no direct push to main' / Thai variant", () => {
      const en = extractDecisions({ transcript: "Never push directly to main." });
      const th = extractDecisions({ transcript: "ห้าม push บน main โดยตรง" });
      expect(en.find((x) => x.pattern === "no_direct_push_main")).toBeDefined();
      expect(th.find((x) => x.pattern === "no_direct_push_main")).toBeDefined();
    });
    it("detects 'has_hmac' for signed responses", () => {
      const d = extractDecisions({ transcript: "All verdicts must be signed with HMAC." });
      expect(d.find((x) => x.pattern === "has_hmac")).toBeDefined();
    });
    it("detects 'no secrets in code'", () => {
      const d = extractDecisions({ transcript: "Never commit secrets in source." });
      expect(d.find((x) => x.pattern === "no_secret_in_code")).toBeDefined();
    });
    it("detects 'must update changelog'", () => {
      const d = extractDecisions({ transcript: "Every release must update changelog." });
      expect(d.find((x) => x.pattern === "must_have_changelog")).toBeDefined();
    });
    it("falls back to 'manual' for unrecognised must/ห้าม sentences", () => {
      const d = extractDecisions({ transcript: "You must arrange the file imports alphabetically." });
      expect(d.some((x) => x.pattern === "manual")).toBe(true);
    });
    it("dedupes same pattern across multiple mentions", () => {
      const d = extractDecisions({ transcript: "Every commit must have a test. Also, test is required for every commit." });
      const tests = d.filter((x) => x.pattern === "test_required");
      expect(tests.length).toBe(1);
    });
    it("empty/whitespace transcript returns []", () => {
      expect(extractDecisions({ transcript: "" }).length).toBe(0);
      expect(extractDecisions({ transcript: "   \n\n  " }).length).toBe(0);
    });
    it("multiple distinct patterns coexist", () => {
      const d = extractDecisions({
        transcript: [
          "Every commit must have a test.",
          "All HMAC compares must use timingSafeEqual.",
          "Never push directly to main.",
          "Every release must update changelog.",
        ].join("\n"),
      });
      const patterns = new Set(d.map((x) => x.pattern));
      expect(patterns.has("test_required")).toBe(true);
      expect(patterns.has("timing_safe_equal_required")).toBe(true);
      expect(patterns.has("no_direct_push_main")).toBe(true);
      expect(patterns.has("must_have_changelog")).toBe(true);
    });
  });

  // ── Compile ──────────────────────────────────────────────────────
  describe("compileAgreement — deterministic, signed, callable", () => {
    it("produces an agreement with HMAC pair-lock", () => {
      const a = compileAgreement({
        transcript: "Every commit must have a test. No console.log in production.",
        name: "team-conventions",
        proposedBy: "shin",
      });
      expect(a.sig).toMatch(/^[0-9a-f]{64}$/);
      expect(a.agreementId).toMatch(/^ag-[0-9a-f]{14}$/);
      expect(a.decisions.length).toBeGreaterThanOrEqual(2);
      expect(verifyAgreementPair({ agreement: a, transcript: "Every commit must have a test. No console.log in production." }).ok).toBe(true);
    });

    it("compilation is DETERMINISTIC — same input → same agreementId + same source", () => {
      const transcript = "Every commit must have a test.";
      const a = compileAgreement({ transcript, name: "x", compiledAt: "2026-05-16T00:00:00Z" });
      const b = compileAgreement({ transcript, name: "x", compiledAt: "2026-05-16T00:00:00Z" });
      expect(a.agreementId).toBe(b.agreementId);
      expect(a.sourceSha256).toBe(b.sourceSha256);
      expect(a.generatedSource).toBe(b.generatedSource);
      expect(a.sig).toBe(b.sig);
    });

    it("agreementId is content-addressed (changes when decisions change)", () => {
      const a = compileAgreement({ transcript: "Every commit must have a test.", name: "x" });
      const b = compileAgreement({ transcript: "Every commit must have a test. No console.log.", name: "x" });
      expect(a.agreementId).not.toBe(b.agreementId);
    });

    it("generated source is valid JavaScript module syntax (eval test)", () => {
      const a = compileAgreement({ transcript: "Every commit must have a test.", name: "x" });
      // Wrap to be evaluable
      const code = a.generatedSource
        .replace(/^export const /gm, "const ")
        .replace(/^export function /gm, "function ")
        + "\nreturn { runAgreement, DECISIONS, AGREEMENT_NAME };";
      const fn = new Function(code);
      const exported = fn();
      expect(typeof exported.runAgreement).toBe("function");
      expect(exported.AGREEMENT_NAME).toBe("x");
      expect(Array.isArray(exported.DECISIONS)).toBe(true);
    });

    it("transcript SHA-256 + source SHA-256 are recorded", () => {
      const t = "Every commit must have a test.";
      const a = compileAgreement({ transcript: t, name: "x" });
      expect(a.transcriptSha256).toMatch(/^[0-9a-f]{64}$/);
      expect(a.sourceSha256).toMatch(/^[0-9a-f]{64}$/);
    });
  });

  // ── Pair-lock tamper detection ───────────────────────────────────
  describe("verifyAgreementPair — pair-lock tamper detection", () => {
    it("accepts clean pair", () => {
      const t = "Every commit must have a test.";
      const a = compileAgreement({ transcript: t, name: "x" });
      expect(verifyAgreementPair({ agreement: a, transcript: t }).ok).toBe(true);
    });
    it("rejects transcript tampering", () => {
      const t = "Every commit must have a test.";
      const a = compileAgreement({ transcript: t, name: "x" });
      const v = verifyAgreementPair({ agreement: a, transcript: t + " EVIL INJECTION" });
      expect(v.ok).toBe(false);
      expect(v.reason).toContain("transcript sha256 mismatch");
    });
    it("rejects source tampering", () => {
      const t = "Every commit must have a test.";
      const a = compileAgreement({ transcript: t, name: "x" });
      const tampered = { ...a, generatedSource: a.generatedSource + "\n// EVIL\n" };
      const v = verifyAgreementPair({ agreement: tampered, transcript: t });
      expect(v.ok).toBe(false);
      expect(v.reason).toContain("generated source sha256 mismatch");
    });
    it("rejects decisions tampering (sig mismatch even when sha cached)", () => {
      const t = "Every commit must have a test.";
      const a = compileAgreement({ transcript: t, name: "x" });
      const tampered = { ...a, decisions: [...a.decisions, { text: "EVIL DECISION", pattern: "manual" as const, params: {}, detectedAt: 0, confidence: 1 }] };
      expect(verifyAgreementPair({ agreement: tampered, transcript: t }).ok).toBe(false);
    });
  });

  // ── runAgreement — checkers actually work ─────────────────────────
  describe("runAgreement — native checkers fire correctly", () => {
    it("test_required: BLOCKS commit without test file", () => {
      const a = compileAgreement({ transcript: "Every commit must have a test.", name: "x" });
      const r = runAgreement({ agreement: a, target: { filesChanged: ["src/foo.ts"] } });
      const checks = r.filter((x) => x.pattern === "test_required");
      expect(checks[0]!.ok).toBe(false);
      expect(checks[0]!.severity).toBe("block");
    });
    it("test_required: PASSES when commit includes test file", () => {
      const a = compileAgreement({ transcript: "Every commit must have a test.", name: "x" });
      const r = runAgreement({ agreement: a, target: { filesChanged: ["src/foo.ts", "src/foo.test.ts"] } });
      expect(r.find((x) => x.pattern === "test_required")!.ok).toBe(true);
    });
    it("timing_safe_equal_required: BLOCKS when HMAC compared with ===", () => {
      const a = compileAgreement({ transcript: "All HMAC compares must use timingSafeEqual.", name: "x" });
      const r = runAgreement({ agreement: a, target: { diffText: "if (computedHmac === claimedHmac) { return true; }" } });
      expect(r.find((x) => x.pattern === "timing_safe_equal_required")!.ok).toBe(false);
    });
    it("timing_safe_equal_required: PASSES when timingSafeEqual is used", () => {
      const a = compileAgreement({ transcript: "All HMAC compares must use timingSafeEqual.", name: "x" });
      const r = runAgreement({ agreement: a, target: { diffText: "timingSafeEqual(Buffer.from(hmac, 'hex'), Buffer.from(claimed, 'hex'))" } });
      expect(r.find((x) => x.pattern === "timing_safe_equal_required")!.ok).toBe(true);
    });
    it("no_console_log: WARNS when console.log found", () => {
      const a = compileAgreement({ transcript: "No console.log in production.", name: "x" });
      const r = runAgreement({ agreement: a, target: { diffText: "console.log('debug')" } });
      const c = r.find((x) => x.pattern === "no_console_log")!;
      expect(c.ok).toBe(false);
      expect(c.severity).toBe("warn");
    });
    it("no_direct_push_main: BLOCKS on main branch", () => {
      const a = compileAgreement({ transcript: "Never push directly to main.", name: "x" });
      const r = runAgreement({ agreement: a, target: { branch: "main" } });
      expect(r.find((x) => x.pattern === "no_direct_push_main")!.ok).toBe(false);
    });
    it("no_secret_in_code: BLOCKS when sk-... key present in diff", () => {
      const a = compileAgreement({ transcript: "Never commit secrets in source.", name: "x" });
      const r = runAgreement({ agreement: a, target: { diffText: "const KEY = 'sk-proj-abc1234567890123456789';" } });
      const c = r.find((x) => x.pattern === "no_secret_in_code")!;
      expect(c.ok).toBe(false);
      expect(c.severity).toBe("block");
    });
    it("must_have_changelog: BLOCKS when CHANGELOG not touched", () => {
      const a = compileAgreement({ transcript: "Every release must update changelog.", name: "x" });
      const r = runAgreement({ agreement: a, target: { filesChanged: ["src/foo.ts"] } });
      expect(r.find((x) => x.pattern === "must_have_changelog")!.ok).toBe(false);
    });
    it("manual: marks as warn requiring review", () => {
      const a = compileAgreement({ transcript: "You must arrange the file imports alphabetically.", name: "x" });
      const r = runAgreement({ agreement: a, target: {} });
      const manual = r.find((x) => x.pattern === "manual")!;
      expect(manual.ok).toBe(false);
      expect(manual.severity).toBe("warn");
      expect(manual.reason).toContain("manual review required");
    });
  });

  // ── Persistence + load round-trip ────────────────────────────────
  describe("persist + load round-trip", () => {
    it("persists 3 files: .json, .mjs, .transcript.txt", () => {
      const t = "Every commit must have a test.";
      const a = compileAgreement({ transcript: t, name: "round-trip" });
      const dir = mkdtempSync(join(tmpdir(), "mneme-agreement-"));
      const p = persistAgreement({ agreement: a, transcript: t, baseDir: dir });
      expect(existsSync(p.agreementJsonPath)).toBe(true);
      expect(existsSync(p.generatedSourcePath)).toBe(true);
      expect(existsSync(p.transcriptPath)).toBe(true);
      const loaded = loadAgreement({ agreementJsonPath: p.agreementJsonPath, transcriptPath: p.transcriptPath });
      expect(loaded.verified).toBe(true);
      expect(loaded.agreement.agreementId).toBe(a.agreementId);
    });
    it("listAgreements returns persisted IDs", () => {
      const dir = mkdtempSync(join(tmpdir(), "mneme-agreements-list-"));
      const a = compileAgreement({ transcript: "Every commit must have a test.", name: "first" });
      const b = compileAgreement({ transcript: "Never push to main.", name: "second" });
      persistAgreement({ agreement: a, transcript: "Every commit must have a test.", baseDir: dir });
      persistAgreement({ agreement: b, transcript: "Never push to main.", baseDir: dir });
      const list = listAgreements(dir);
      expect(list.length).toBe(2);
    });
    it("loadAgreement reports verified=false on tampered transcript file", () => {
      const t = "Every commit must have a test.";
      const a = compileAgreement({ transcript: t, name: "x" });
      const dir = mkdtempSync(join(tmpdir(), "mneme-tamper-"));
      const p = persistAgreement({ agreement: a, transcript: t, baseDir: dir });
      // tamper the on-disk transcript
      const { writeFileSync } = require("node:fs");
      writeFileSync(p.transcriptPath, t + " EVIL", "utf8");
      const loaded = loadAgreement({ agreementJsonPath: p.agreementJsonPath, transcriptPath: p.transcriptPath });
      expect(loaded.verified).toBe(false);
    });
  });

  // ── Killer demo ──────────────────────────────────────────────────
  describe("killer demo — pre-commit hook integration", () => {
    it("generatePreCommitHook emits runnable script that exits 1 on blocked checks", () => {
      const a = compileAgreement({ transcript: "Every commit must have a test.", name: "block-no-tests" });
      const hook = generatePreCommitHook({
        agreementJsonPath: "/path/to/agreement.json",
        transcriptPath: "/path/to/transcript.txt",
      });
      expect(hook).toContain("#!/usr/bin/env node");
      expect(hook).toContain("loadAgreement");
      expect(hook).toContain("runAgreement");
      expect(hook).toContain("process.exit(blocked ? 1 : 0)");
      expect(hook).toContain("git diff --cached --name-only");
    });

    it("end-to-end: user says 'every commit must have test' → compile → run → blocks naked commit", () => {
      // Simulate the conversation
      const transcript = "User: from now on, every commit must have a test. Assistant: agreed.";
      // Mneme compiles
      const agreement = compileAgreement({ transcript, name: "team-rule" });
      expect(agreement.decisions.some((d) => d.pattern === "test_required")).toBe(true);
      // Future commit attempt: no test file in changeset
      const r = runAgreement({ agreement, target: { filesChanged: ["src/feature.ts"] } });
      const blocked = r.some((x) => !x.ok && x.severity === "block");
      expect(blocked).toBe(true);
      // Same agreement, with test file — passes
      const r2 = runAgreement({ agreement, target: { filesChanged: ["src/feature.ts", "src/feature.test.ts"] } });
      const stillBlocked = r2.some((x) => !x.ok && x.severity === "block");
      expect(stillBlocked).toBe(false);
    });
  });

  // ── Formatters ───────────────────────────────────────────────────
  describe("formatters", () => {
    it("formatAgreementLine + formatCheckSummary emit short summaries", () => {
      const a = compileAgreement({ transcript: "Every commit must have a test.", name: "x" });
      expect(formatAgreementLine(a)).toContain("AGREEMENT");
      const r = runAgreement({ agreement: a, target: { filesChanged: ["src/foo.ts"] } });
      expect(formatCheckSummary(r)).toContain("BLOCKED");
    });
  });
});
