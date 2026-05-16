/**
 * v2.19.7 extras — small additions to existing modules that don't justify
 * their own test file but DO need regression coverage.
 *   - intent_router: saveCustomPhrases / loadCustomPhrases persistence
 *   - conversation_compiler: uninstallAgreement
 *   - chronostasis: axiomLineage (RETROCAUSAL) + axiomsRelevantToEmbedded
 */

import { describe, it, expect, beforeEach } from "vitest";
import {
  resetToBuiltin, registerPhrase, listPhrases,
  saveCustomPhrases, loadCustomPhrases,
} from "../intent_router/index.js";
import {
  compileAgreement, persistAgreement, uninstallAgreement, listAgreements,
} from "../conversation_compiler/index.js";
import { Chronostasis } from "../chronostasis/index.js";
import { mkdtempSync, writeFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

describe("v2.19.7 extras", () => {
  // ── intent_router persistence ───────────────────────────────────────
  describe("intent_router persistence", () => {
    beforeEach(() => resetToBuiltin());

    it("saveCustomPhrases writes only custom phrases (excludes built-ins)", () => {
      registerPhrase({
        canonical: "deploy production",
        aliases: ["deploy prod", "ship prod"],
        intent: "Ship to prod with all gates.",
        plan: [{ kind: "hint", note: "Run npm publish + git tag." }],
      });
      const dir = mkdtempSync(join(tmpdir(), "mneme-intent-"));
      const path = join(dir, "intent-phrases.json");
      const r = saveCustomPhrases({ path });
      expect(r.saved).toBe(1);
      expect(existsSync(path)).toBe(true);
    });

    it("loadCustomPhrases restores phrases on a fresh process", () => {
      registerPhrase({
        canonical: "deploy production",
        aliases: ["deploy prod"],
        intent: "Ship to prod.",
        plan: [{ kind: "hint", note: "x" }],
      });
      const dir = mkdtempSync(join(tmpdir(), "mneme-intent-load-"));
      const path = join(dir, "intent-phrases.json");
      saveCustomPhrases({ path });
      // Simulate fresh process
      resetToBuiltin();
      expect(listPhrases().find((p) => p.canonical === "deploy production")).toBeUndefined();
      const r = loadCustomPhrases({ path });
      expect(r.loaded).toBe(1);
      expect(listPhrases().find((p) => p.canonical === "deploy production")).toBeDefined();
    });

    it("loadCustomPhrases is idempotent — no duplicates on repeat call", () => {
      registerPhrase({
        canonical: "deploy production", aliases: [], intent: "x",
        plan: [{ kind: "hint", note: "x" }],
      });
      const dir = mkdtempSync(join(tmpdir(), "mneme-intent-dup-"));
      const path = join(dir, "intent-phrases.json");
      saveCustomPhrases({ path });
      const before = listPhrases().length;
      loadCustomPhrases({ path });
      loadCustomPhrases({ path });
      expect(listPhrases().length).toBe(before);
    });

    it("loadCustomPhrases({replaceCustom: true}) drops prior custom first", () => {
      registerPhrase({ canonical: "phrase-A", aliases: [], intent: "x", plan: [{ kind: "hint", note: "x" }] });
      const dir = mkdtempSync(join(tmpdir(), "mneme-intent-replace-"));
      const path = join(dir, "intent-phrases.json");
      saveCustomPhrases({ path });
      resetToBuiltin();
      registerPhrase({ canonical: "phrase-B", aliases: [], intent: "x", plan: [{ kind: "hint", note: "x" }] });
      loadCustomPhrases({ path, replaceCustom: true });
      // phrase-B should be gone, phrase-A restored
      const names = listPhrases().map((p) => p.canonical);
      expect(names).toContain("phrase-A");
      expect(names).not.toContain("phrase-B");
    });
  });

  // ── conversation_compiler uninstallAgreement ────────────────────────
  describe("conversation_compiler uninstall", () => {
    it("removes the 3 persisted files for an agreement", () => {
      const t = "Every commit must have a test.";
      const a = compileAgreement({ transcript: t, name: "uninst-test" });
      const dir = mkdtempSync(join(tmpdir(), "mneme-agreement-uninst-"));
      const p = persistAgreement({ agreement: a, transcript: t, baseDir: dir });
      expect(listAgreements(dir).length).toBe(1);
      const r = uninstallAgreement({ agreementJsonPath: p.agreementJsonPath, baseDir: dir });
      expect(r.removed.length).toBe(3); // .json + .mjs + .transcript.txt
      expect(listAgreements(dir).length).toBe(0);
    });

    it("removes installed pre-commit hook if it looks Mneme-generated", () => {
      const dir = mkdtempSync(join(tmpdir(), "mneme-hook-uninst-"));
      const hookPath = join(dir, "pre-commit");
      writeFileSync(hookPath, "#!/usr/bin/env node\n// MNEME AGREEMENT PRE-COMMIT HOOK\n// ...\n", "utf8");
      const t = "Every commit must have a test.";
      const a = compileAgreement({ transcript: t, name: "x" });
      const p = persistAgreement({ agreement: a, transcript: t, baseDir: dir });
      const r = uninstallAgreement({ agreementJsonPath: p.agreementJsonPath, baseDir: dir, hookPath });
      expect(r.hookRemoved).toBe(true);
      expect(existsSync(hookPath)).toBe(false);
    });

    it("refuses to remove non-Mneme hooks (safety)", () => {
      const dir = mkdtempSync(join(tmpdir(), "mneme-hook-safe-"));
      const hookPath = join(dir, "pre-commit");
      writeFileSync(hookPath, "#!/bin/sh\n# my custom hook\n", "utf8");
      const t = "Every commit must have a test.";
      const a = compileAgreement({ transcript: t, name: "x" });
      const p = persistAgreement({ agreement: a, transcript: t, baseDir: dir });
      const r = uninstallAgreement({ agreementJsonPath: p.agreementJsonPath, baseDir: dir, hookPath });
      expect(r.hookRemoved).toBe(false);
      expect(existsSync(hookPath)).toBe(true); // not Mneme-generated → preserved
    });

    it("throws when neither agreementId nor agreementJsonPath given", () => {
      expect(() => uninstallAgreement({})).toThrow(/agreementId or agreementJsonPath/);
    });
  });

  // ── Chronostasis RETROCAUSAL: axiomLineage ──────────────────────────
  describe("chronostasis.axiomLineage — RETROCAUSAL proof tree", () => {
    function freshChrono() {
      const dir = mkdtempSync(join(tmpdir(), "mneme-chrono-lineage-"));
      return new Chronostasis({
        pendingPath: join(dir, "p.jsonl"),
        verdictsPath: join(dir, "v.jsonl"),
        axiomsPath: join(dir, "a.jsonl"),
        rewindsPath: join(dir, "r.jsonl"),
      });
    }
    it("returns a single-node proof tree for an axiom with no deps", () => {
      const c = freshChrono();
      const t0 = 1_000_000_000_000;
      c.proposeClaim({ body: "A", deadlineSec: 10, nowMs: t0 });
      c.tick({ nowMs: t0 + 20_000 });
      const ax = c.exportAxioms()[0]!;
      const lineage = c.axiomLineage(ax.axiomId);
      expect(lineage.tree.length).toBe(1);
      expect(lineage.tree[0]!.depth).toBe(0);
      expect(lineage.isFullyCrystallized).toBe(true);
      expect(lineage.sig).toMatch(/^[0-9a-f]{64}$/);
    });

    it("walks transitive deps backward into a proof tree", () => {
      const c = freshChrono();
      const t0 = 1_000_000_000_000;
      const a = c.proposeClaim({ body: "fact A", deadlineSec: 10, nowMs: t0 });
      const b = c.proposeClaim({ body: "fact B", dependsOn: [a.claimId], deadlineSec: 10, nowMs: t0 });
      const cc = c.proposeClaim({ body: "fact C", dependsOn: [b.claimId], deadlineSec: 10, nowMs: t0 });
      // 3 ticks to chain through
      c.tick({ nowMs: t0 + 20_000 });
      c.tick({ nowMs: t0 + 40_000 });
      c.tick({ nowMs: t0 + 60_000 });
      const axioms = c.exportAxioms();
      expect(axioms.length).toBe(3);
      // Find the deepest axiom (C → B → A)
      const topAxiom = axioms.find((ax) => ax.promotedFromClaimId === cc.claimId)!;
      const lineage = c.axiomLineage(topAxiom.axiomId);
      expect(lineage.tree.length).toBe(3);
      expect(lineage.isFullyCrystallized).toBe(true);
      // Depths increase as we walk back
      const depths = lineage.tree.map((n) => n.depth).sort((x, y) => x - y);
      expect(depths).toEqual([0, 1, 2]);
    });

    it("throws on unknown axiom ID", () => {
      const c = freshChrono();
      expect(() => c.axiomLineage("ax-nonexistent00")).toThrow(/not found/);
    });
  });

  // ── Chronostasis embedded truth gravity ─────────────────────────────
  describe("chronostasis.axiomsRelevantToEmbedded", () => {
    function freshChrono() {
      const dir = mkdtempSync(join(tmpdir(), "mneme-chrono-embedded-"));
      return new Chronostasis({
        pendingPath: join(dir, "p.jsonl"),
        verdictsPath: join(dir, "v.jsonl"),
        axiomsPath: join(dir, "a.jsonl"),
        rewindsPath: join(dir, "r.jsonl"),
      });
    }
    it("ranks axioms by cosine similarity over caller-supplied embeddings", async () => {
      const c = freshChrono();
      const t0 = 1_000_000_000_000;
      c.proposeClaim({ body: "Paris is the capital of France", deadlineSec: 10, nowMs: t0 });
      c.proposeClaim({ body: "Bangkok is the capital of Thailand", deadlineSec: 10, nowMs: t0 });
      c.tick({ nowMs: t0 + 20_000 });

      // Toy "embedder" that returns hand-crafted vectors so cosine is determined.
      const embed = async (texts: string[]) => {
        // First text = query; rest = axioms in order.
        return texts.map((t) => {
          if (/france|paris/i.test(t)) return [1, 0, 0];
          if (/thailand|bangkok/i.test(t)) return [0, 1, 0];
          return [0, 0, 1];
        });
      };
      const g = await c.axiomsRelevantToEmbedded({ queryText: "Where is Paris?", embed, k: 2, minSimilarity: 0.5 });
      expect(g.attractedAxioms.length).toBeGreaterThanOrEqual(1);
      expect(g.attractedAxioms[0]!.body).toContain("Paris");
    });

    it("falls back to jaccard gracefully when embedder throws", async () => {
      const c = freshChrono();
      const t0 = 1_000_000_000_000;
      c.proposeClaim({ body: "Paris is the capital of France", deadlineSec: 10, nowMs: t0 });
      c.tick({ nowMs: t0 + 20_000 });
      const g = await c.axiomsRelevantToEmbedded({
        queryText: "Paris", embed: async () => { throw new Error("embedder down"); },
      });
      // Should not throw; falls back to jaccard which finds Paris
      expect(g.attractedAxioms.length).toBeGreaterThanOrEqual(1);
    });
  });
});
