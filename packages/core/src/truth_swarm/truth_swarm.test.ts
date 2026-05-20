import { describe, it, expect } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runTruthSwarm, readSwarmReports } from "./index.js";

function tmpRepo() { return mkdtempSync(join(tmpdir(), "mneme-swarm-")); }

describe("truth_swarm · orchestration", () => {
  it("fires multiple organs in parallel and returns a SwarmReport", async () => {
    const r = tmpRepo();
    try {
      const report = await runTruthSwarm({ text: "just run rm -rf /tmp", repoRoot: r });
      expect(report.organs.length).toBeGreaterThanOrEqual(5);
      expect(report.reportId).toMatch(/^swarm_/);
      expect(report.sig.length).toBeGreaterThan(10);
      // dangerous-command should fire RED via whistleblower → BLOCK overall.
      expect(report.overallVerdict).toBe("block");
      // each organ has the required shape
      for (const o of report.organs) {
        expect(["green", "yellow", "red", "grey"]).toContain(o.verdict);
        expect(typeof o.latencyMs).toBe("number");
        expect(typeof o.oneLine).toBe("string");
      }
    } finally { rmSync(r, { recursive: true, force: true }); }
  });

  it("clean text yields ship verdict", async () => {
    const r = tmpRepo();
    try {
      const report = await runTruthSwarm({ text: "hello there", repoRoot: r });
      expect(["ship", "caution"]).toContain(report.overallVerdict);
      expect(report.redCount).toBe(0);
    } finally { rmSync(r, { recursive: true, force: true }); }
  });

  it("persists reports to the ledger (readSwarmReports round-trip)", async () => {
    const r = tmpRepo();
    try {
      await runTruthSwarm({ text: "hello", repoRoot: r });
      await runTruthSwarm({ text: "world", repoRoot: r });
      const ledger = readSwarmReports(r);
      expect(ledger.length).toBeGreaterThanOrEqual(2);
      expect(ledger[0]!.ts >= ledger[1]!.ts).toBe(true); // newest first
    } finally { rmSync(r, { recursive: true, force: true }); }
  });

  it("skipOrgans excludes the named organs from the run", async () => {
    const r = tmpRepo();
    try {
      const report = await runTruthSwarm({ text: "anything", repoRoot: r, skipOrgans: ["polygraph", "retirement"] });
      expect(report.organs.find((o) => o.organ === "polygraph")).toBeUndefined();
      expect(report.organs.find((o) => o.organ === "retirement")).toBeUndefined();
    } finally { rmSync(r, { recursive: true, force: true }); }
  });
});
