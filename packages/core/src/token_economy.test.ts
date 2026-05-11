import { describe, expect, it, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, existsSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  recordTokenReport, readRecentReports, rollupSavings,
  recommendBargains, renderSecretaryNegotiation,
  BUILTIN_BARGAINS,
  type TokenReport,
} from "./token_economy.js";

describe("token_economy (secretary bot framework)", () => {
  let repo: string;
  beforeEach(() => { repo = mkdtempSync(join(tmpdir(), "mneme-tok-")); });
  afterEach(() => { try { rmSync(repo, { recursive: true, force: true }); } catch { /* */ } });

  describe("BUILTIN_BARGAINS catalog", () => {
    it("ships at least 5 strategies", () => {
      expect(BUILTIN_BARGAINS.length).toBeGreaterThanOrEqual(5);
    });
    it("every strategy has an id + technique + per-vendor ratio map", () => {
      for (const b of BUILTIN_BARGAINS) {
        expect(b.id.length).toBeGreaterThan(0);
        expect(b.technique.length).toBeGreaterThan(20);
        expect(Object.keys(b.perVendorRatio).length).toBeGreaterThan(0);
      }
    });
    it("includes context-hash-reuse (the headline strategy)", () => {
      expect(BUILTIN_BARGAINS.some((b) => b.id === "context-hash-reuse")).toBe(true);
    });
  });

  describe("recordTokenReport / readRecentReports", () => {
    it("persists to .mneme/token-ledger.jsonl + reads back", () => {
      const report: TokenReport = {
        ts: "2026-05-11T12:00:00Z",
        sessionId: "test-session",
        vendor: "anthropic",
        promptTokens: 1000,
        completionTokens: 500,
        strategiesApplied: ["compact-json"],
      };
      recordTokenReport(repo, report);
      expect(existsSync(join(repo, ".mneme/token-ledger.jsonl"))).toBe(true);
      const recent = readRecentReports(repo, 10);
      expect(recent.length).toBe(1);
      expect(recent[0]!.sessionId).toBe("test-session");
    });
    it("readRecentReports returns [] when file missing", () => {
      expect(readRecentReports(repo)).toEqual([]);
    });
    it("readRecentReports tolerates malformed lines", () => {
      recordTokenReport(repo, {
        ts: "x", sessionId: "s", vendor: "anthropic",
        promptTokens: 100, completionTokens: 50,
      });
      const fs = require("node:fs");
      fs.appendFileSync(join(repo, ".mneme/token-ledger.jsonl"), "not json\n", "utf8");
      const recent = readRecentReports(repo);
      expect(recent.length).toBe(1);
    });
  });

  describe("rollupSavings", () => {
    it("reports zero savings on empty ledger", () => {
      const r = rollupSavings(repo);
      expect(r.totalReports).toBe(0);
      expect(r.totalEstimatedTokensSaved).toBe(0);
    });
    it("aggregates per-vendor + per-strategy", () => {
      recordTokenReport(repo, { ts: "1", sessionId: "a", vendor: "anthropic", promptTokens: 1000, completionTokens: 500, strategiesApplied: ["context-hash-reuse"] });
      recordTokenReport(repo, { ts: "2", sessionId: "b", vendor: "anthropic", promptTokens: 2000, completionTokens: 800, strategiesApplied: ["context-hash-reuse", "compact-json"] });
      recordTokenReport(repo, { ts: "3", sessionId: "c", vendor: "openai", promptTokens: 500, completionTokens: 200 });
      const r = rollupSavings(repo);
      expect(r.totalReports).toBe(3);
      expect(r.perVendor["anthropic"]!.reports).toBe(2);
      expect(r.perVendor["openai"]!.reports).toBe(1);
      expect(r.totalPromptTokens).toBe(3500);
      // Strategies present.
      const strategies = r.perStrategy.map((s) => s.strategyId).sort();
      expect(strategies).toEqual(["compact-json", "context-hash-reuse"]);
      // Savings should be > 0.
      expect(r.totalEstimatedTokensSaved).toBeGreaterThan(0);
    });
    it("computes USD saved estimate", () => {
      recordTokenReport(repo, { ts: "1", sessionId: "a", vendor: "anthropic", promptTokens: 100000, completionTokens: 50000, strategiesApplied: ["context-hash-reuse"] });
      const r = rollupSavings(repo);
      expect(r.totalEstimatedUsdSaved).toBeGreaterThan(0);
    });
  });

  describe("recommendBargains", () => {
    it("returns strategies sorted by ratio desc", () => {
      const recs = recommendBargains("anthropic");
      expect(recs.length).toBeGreaterThan(0);
      for (let i = 1; i < recs.length; i++) {
        expect(recs[i - 1]!.ratio).toBeGreaterThanOrEqual(recs[i]!.ratio);
      }
      // context-hash-reuse should be the top recommendation for anthropic.
      expect(recs[0]!.id).toBe("context-hash-reuse");
    });
    it("filters out strategies with 0 savings for the vendor", () => {
      const recs = recommendBargains("local-llamacpp");
      // local-llamacpp not in any bargain's perVendorRatio -- should default to 0.05 fallback or be empty.
      // Our impl uses ratio > 0 filter, so anything missing returns 0.05 (still > 0).
      expect(recs.every((r) => r.ratio > 0)).toBe(true);
    });
  });

  describe("renderSecretaryNegotiation", () => {
    it("produces a markdown brief naming top 3 strategies", () => {
      const md = renderSecretaryNegotiation("anthropic", "session-x");
      expect(md).toContain("Token Secretary");
      expect(md).toContain("anthropic");
      expect(md).toContain("session-x");
      expect(md).toContain("context-hash-reuse");
      expect(md).toContain("mneme.token.report");
    });
    it("includes the honest disclaimer about voluntary reporting", () => {
      const md = renderSecretaryNegotiation("openai");
      expect(md).toContain("can't snoop");
      expect(md).toContain("honest cooperation");
    });
  });
});
