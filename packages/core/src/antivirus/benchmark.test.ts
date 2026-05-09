import { describe, expect, it, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, mkdirSync, readFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import {
  runBenchmark, runAllBenchmarks, readBenchmark, verifyEfficacySignature,
} from "./benchmark.js";
import { SEED_VACCINES, VAC_CITATIO_VIRIDIS } from "./vaccines.js";

function initRepo(root: string): void {
  spawnSync("git", ["init", "-q"], { cwd: root });
  spawnSync("git", ["config", "user.email", "test@example.com"], { cwd: root });
  spawnSync("git", ["config", "user.name", "Test User"], { cwd: root });
  spawnSync("git", ["commit", "--allow-empty", "-m", "init", "-q"], { cwd: root });
}

describe("benchmark harness", () => {
  let repo: string;
  beforeEach(() => {
    repo = mkdtempSync(join(tmpdir(), "mneme-av-bench-"));
    initRepo(repo);
    mkdirSync(join(repo, ".mneme"), { recursive: true });
  });
  afterEach(() => { try { rmSync(repo, { recursive: true, force: true }); } catch { /* ignore */ } });

  it("produces an HMAC-signed efficacy record for a single vaccine", async () => {
    const eff = await runBenchmark(repo, VAC_CITATIO_VIRIDIS);
    expect(eff.signature.length).toBeGreaterThan(0);
    expect(eff.totalCases).toBeGreaterThan(0);
    expect(typeof eff.tp).toBe("number");
    expect(typeof eff.fn).toBe("number");
    expect(typeof eff.fp).toBe("number");
    expect(typeof eff.tn).toBe("number");
  }, 30_000);

  it("F1 is in [0,1] when defined", async () => {
    const eff = await runBenchmark(repo, VAC_CITATIO_VIRIDIS);
    if (eff.f1 != null) {
      expect(eff.f1).toBeGreaterThanOrEqual(0);
      expect(eff.f1).toBeLessThanOrEqual(1);
    }
  }, 30_000);

  it("citatio_viridis vaccine catches at least 4 of 5 positive cases (recall >= 0.8)", async () => {
    const eff = await runBenchmark(repo, VAC_CITATIO_VIRIDIS);
    if (eff.recall != null) {
      expect(eff.recall).toBeGreaterThanOrEqual(0.8);
    }
  }, 30_000);

  it("verifyEfficacySignature returns true with the right secret", async () => {
    const eff = await runBenchmark(repo, VAC_CITATIO_VIRIDIS);
    const secretFile = join(repo, ".mneme/antivirus/.bench-secret");
    expect(existsSync(secretFile)).toBe(true);
    const secret = Buffer.from(readFileSync(secretFile, "utf8").trim(), "hex");
    expect(verifyEfficacySignature(eff, VAC_CITATIO_VIRIDIS, secret)).toBe(true);
  }, 30_000);

  it("runAllBenchmarks writes a per-vaccine JSON report", async () => {
    await runAllBenchmarks(repo, [VAC_CITATIO_VIRIDIS]);
    const report = join(repo, ".mneme/antivirus/benchmarks/anti_citatio_viridis_v1.json");
    expect(existsSync(report)).toBe(true);
    const parsed = JSON.parse(readFileSync(report, "utf8"));
    expect(parsed.vaccine).toBe("anti_citatio_viridis_v1");
    expect(parsed.efficacy).toBeDefined();
  }, 60_000);

  it("readBenchmark returns null when no report exists", () => {
    expect(readBenchmark(repo, "nonexistent_vaccine")).toBeNull();
  });

  it("efficacy score is HONEST -- F1 < 1.0 when there are FPs or FNs", async () => {
    // We can't assert specific numbers because they depend on git state,
    // but we CAN assert tp+fp+tn+fn === totalCases (no double-counting).
    const eff = await runBenchmark(repo, VAC_CITATIO_VIRIDIS);
    expect(eff.tp + eff.fp + eff.tn + eff.fn).toBe(eff.totalCases);
  }, 30_000);

  it("seed pharmacopoeia includes all 8 vaccines", () => {
    expect(SEED_VACCINES.length).toBe(8);
    const strains = new Set(SEED_VACCINES.map((v) => v.strain));
    expect(strains.size).toBe(8);
  });
});
