import { describe, expect, it, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, mkdirSync, writeFileSync, existsSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { composeSnapshot, readSnapshotHistory } from "./snapshot.js";

describe("devhealth snapshot (atomic second-brain composite)", () => {
  let repo: string;
  beforeEach(() => {
    repo = mkdtempSync(join(tmpdir(), "mneme-dh-"));
    mkdirSync(join(repo, ".mneme"), { recursive: true });
  });
  afterEach(() => { try { rmSync(repo, { recursive: true, force: true }); } catch { /* */ } });

  describe("composeSnapshot on a bare repo", () => {
    it("returns a snapshot with safe defaults when nothing persisted", () => {
      const s = composeSnapshot(repo);
      expect(s.generatedAt).toBeTruthy();
      expect(s.headline.daemonRunning).toBe(false);
      expect(s.headline.activeVaccines).toBe(0);
      expect(s.axes.antivirus.activeVaccines).toBe(0);
      expect(s.axes.memoryTier).toBeNull();
      expect(s.bonds).toEqual([]);                    // no conflicts yet
    });
    it("persists the snapshot to .mneme/devhealth-snapshots.jsonl", () => {
      composeSnapshot(repo);
      expect(existsSync(join(repo, ".mneme/devhealth-snapshots.jsonl"))).toBe(true);
    });
  });

  describe("daemon detection", () => {
    it("daemonRunning=true when heartbeat is fresh", () => {
      writeFileSync(
        join(repo, ".mneme/nucleus.heartbeat.json"),
        JSON.stringify({ tickCount: 100, lastTick: new Date().toISOString() }),
        "utf8",
      );
      const s = composeSnapshot(repo);
      expect(s.headline.daemonRunning).toBe(true);
    });
    it("daemonRunning=false when heartbeat is stale (>5min)", () => {
      writeFileSync(
        join(repo, ".mneme/nucleus.heartbeat.json"),
        JSON.stringify({ tickCount: 100, lastTick: new Date(Date.now() - 10 * 60 * 1000).toISOString() }),
        "utf8",
      );
      const s = composeSnapshot(repo);
      expect(s.headline.daemonRunning).toBe(false);
    });
  });

  describe("antivirus axis", () => {
    it("reads active vaccines + uncertified count from pharmacopoeia", () => {
      mkdirSync(join(repo, ".mneme/antivirus"), { recursive: true });
      writeFileSync(
        join(repo, ".mneme/antivirus/pharmacopoeia.json"),
        JSON.stringify({
          vaccines: [
            { id: "a", efficacy: { f1: 0.9 } },
            { id: "b", efficacy: null },
            { id: "c", efficacy: { f1: 0.85 } },
          ],
        }),
        "utf8",
      );
      const s = composeSnapshot(repo);
      expect(s.axes.antivirus.activeVaccines).toBe(3);
      expect(s.axes.antivirus.uncertified).toBe(1);
    });
  });

  describe("memory tier detection", () => {
    it("maps openai embedder to openai/5★", () => {
      mkdirSync(join(repo, ".mneme/store"), { recursive: true });
      writeFileSync(join(repo, ".mneme/store/meta.json"), JSON.stringify({ embedder: "openai-text-embedding-3-small" }), "utf8");
      const s = composeSnapshot(repo);
      expect(s.axes.memoryTier?.name).toBe("openai");
      expect(s.axes.memoryTier?.stars).toBe(5);
    });
    it("maps hash embedder to hash/2★ + NOT semantic", () => {
      mkdirSync(join(repo, ".mneme/store"), { recursive: true });
      writeFileSync(join(repo, ".mneme/store/meta.json"), JSON.stringify({ embedder: "hash:fnv-256" }), "utf8");
      const s = composeSnapshot(repo);
      expect(s.axes.memoryTier?.name).toBe("hash");
      expect(s.axes.memoryTier?.semantic).toBe(false);
    });
  });

  describe("supernova axis", () => {
    it("counts escalations from supernova log", () => {
      writeFileSync(
        join(repo, ".mneme/supernova.jsonl"),
        [
          JSON.stringify({ outcome: "ok", cycle: "x", attempt: 1 }),
          JSON.stringify({ outcome: "failed", cycle: "y", attempt: 3 }),
          JSON.stringify({ outcome: "escalated", cycle: "z", attempt: 5 }),
          JSON.stringify({ outcome: "escalated", cycle: "w", attempt: 5 }),
        ].join("\n"),
        "utf8",
      );
      const s = composeSnapshot(repo);
      expect(s.axes.supernova.escalations).toBe(2);
      expect(s.axes.supernova.recentEvents).toBe(4);
    });
  });

  describe("trust grades + BONDS", () => {
    it("surfaces weak-band subsystems via bond (contradicts headline)", () => {
      writeFileSync(
        join(repo, ".mneme/trust-grades.json"),
        JSON.stringify({ forensics_vulns: { band: "weak" } }),
        "utf8",
      );
      const s = composeSnapshot(repo);
      expect(s.axes.trust["forensics_vulns"]?.band).toBe("weak");
      const bondToTrust = s.bonds.find((b) => b.pair[0]?.startsWith("trust.forensics_vulns"));
      expect(bondToTrust).toBeDefined();
      expect(bondToTrust!.relation).toBe("contradicts");
    });

    it("hash-tier memory + token economy contradicts (suggest upgrade)", () => {
      mkdirSync(join(repo, ".mneme/store"), { recursive: true });
      writeFileSync(join(repo, ".mneme/store/meta.json"), JSON.stringify({ embedder: "hash" }), "utf8");
      const s = composeSnapshot(repo);
      expect(s.bonds.some((b) => b.pair.includes("memoryTier"))).toBe(true);
    });

    it("uncertified vaccines + activeVaccines reinforces (run benchmark)", () => {
      mkdirSync(join(repo, ".mneme/antivirus"), { recursive: true });
      writeFileSync(
        join(repo, ".mneme/antivirus/pharmacopoeia.json"),
        JSON.stringify({ vaccines: [{ id: "a", efficacy: null }] }),
        "utf8",
      );
      const s = composeSnapshot(repo);
      expect(s.bonds.some((b) => b.relation === "reinforces" && b.explanation.includes("benchmark"))).toBe(true);
    });
  });

  describe("token-economy axis", () => {
    it("counts reports + estimates savings", () => {
      writeFileSync(
        join(repo, ".mneme/token-ledger.jsonl"),
        [
          JSON.stringify({ promptTokens: 1000, completionTokens: 500, vendor: "anthropic", strategiesApplied: ["compact-json"] }),
          JSON.stringify({ promptTokens: 2000, completionTokens: 800, vendor: "anthropic", strategiesApplied: [] }),
        ].join("\n"),
        "utf8",
      );
      const s = composeSnapshot(repo);
      expect(s.axes.tokenEconomy.totalReports).toBe(2);
      expect(s.axes.tokenEconomy.estimatedTokensSaved).toBeGreaterThan(0);
    });
  });

  describe("brief composition", () => {
    it("brief mentions daemon + vaccines + bonds count when applicable", () => {
      mkdirSync(join(repo, ".mneme/antivirus"), { recursive: true });
      writeFileSync(
        join(repo, ".mneme/antivirus/pharmacopoeia.json"),
        JSON.stringify({ vaccines: [{ id: "a", efficacy: { f1: 0.9 } }] }),
        "utf8",
      );
      const s = composeSnapshot(repo);
      expect(s.brief).toContain("Daemon");
      expect(s.brief).toContain("Vaccines");
    });
  });

  describe("readSnapshotHistory", () => {
    it("returns persisted snapshots in order", () => {
      composeSnapshot(repo);
      composeSnapshot(repo);
      const history = readSnapshotHistory(repo, 10);
      expect(history.length).toBe(2);
    });
    it("returns [] when no snapshots", () => {
      expect(readSnapshotHistory(repo)).toEqual([]);
    });
    it("tolerates malformed lines", () => {
      composeSnapshot(repo);
      const path = join(repo, ".mneme/devhealth-snapshots.jsonl");
      // Append a bad line
      const fs = require("node:fs");
      fs.appendFileSync(path, "garbage\n", "utf8");
      const h = readSnapshotHistory(repo, 10);
      expect(h.length).toBe(1);
    });
  });
});
