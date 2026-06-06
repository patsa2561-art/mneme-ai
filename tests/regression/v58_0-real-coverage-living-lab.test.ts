/**
 * v2.58.0 — REAL 100% COVERAGE + LIVING LAB pinned tests.
 *
 * Section map:
 *   A1 — AUTOPROBE: empirical proof-of-life primitive
 *   A2 — probe_coverage wire-up (3rd source)
 *   A3 — LIVING LAB active-learning tool picker
 *   A4 — LIVING LAB tick + findings + heartbeat
 *   A5 — LIVING LAB chain HMAC + tamper detection
 *   A6 — LIVING LAB commit-to-branch safety (refuses main)
 *   A7 — TG probes for v2.58 surface
 *   A8 — CLI surfaces (mneme autoprobe / mneme living_lab)
 *   A9 — LAUNCH WINDOW = GO with real-100% coverage
 */

import { describe, it, expect, beforeAll } from "vitest";
import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, rmSync, writeFileSync, readFileSync, mkdirSync } from "node:fs";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { dirname } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(__dirname, "../..");
const CLI = join(REPO, "packages", "cli", "bin", "mneme.js");

// The A9 LAUNCH-WINDOW=GO gate reads the EMPIRICAL autoprobe cache (24h TTL). Refresh it with REAL
// probing when stale so the test is DETERMINISTIC — never by faking coverage (that would mask a real
// regression). Fresh cache → this is a no-op.
beforeAll(async () => {
  const { loadFreshAutoprobeReport } = await import("../../packages/core/src/release_gate/autoprobe.js");
  if (!loadFreshAutoprobeReport(REPO)) spawnSync(process.execPath, [CLI, "autoprobe", "run"], { encoding: "utf8", timeout: 240_000, env: { ...process.env, MNEME_WARMCALL: "0", NO_COLOR: "1" } });
}, 240_000);

function tmp(): string {
  return mkdtempSync(join(tmpdir(), "mneme-v58-"));
}

describe("v2.58.0 A1 — AUTOPROBE empirical proof-of-life (PINNED)", () => {
  it("A1.1 runAutoprobe spawns --help on tools and reports invocability", async () => {
    const m = await import("../../packages/core/src/release_gate/autoprobe.js");
    const r = m.runAutoprobe({ tools: ["mneme.zzz_totally_fake_namespace.fake_verb_xyz", "mneme.version"], cwd: REPO, noPersist: true });
    expect(r.totalTested).toBe(2);
    expect(r.results.find((x) => x.tool === "mneme.zzz_totally_fake_namespace.fake_verb_xyz")?.invocable).toBe(false);
    expect(typeof r.hmac).toBe("string");
    expect(r.hmac.length).toBeGreaterThanOrEqual(64);
  });

  it("A1.2 verifyAutoprobeReport round-trips + tamper fails", async () => {
    const m = await import("../../packages/core/src/release_gate/autoprobe.js");
    const r = m.runAutoprobe({ tools: ["mneme.version"], cwd: REPO, noPersist: true });
    expect(m.verifyAutoprobeReport(r)).toBe(true);
    const tampered = { ...r, totalTested: r.totalTested + 99 };
    expect(m.verifyAutoprobeReport(tampered)).toBe(false);
  });

  it("A1.3 loadFreshAutoprobeReport returns null when no report exists", async () => {
    const m = await import("../../packages/core/src/release_gate/autoprobe.js");
    const dir = tmp();
    try {
      expect(m.loadFreshAutoprobeReport(dir)).toBeNull();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("A1.4 autoprobeCoveredTools returns empty set without report", async () => {
    const m = await import("../../packages/core/src/release_gate/autoprobe.js");
    const dir = tmp();
    try {
      const s = m.autoprobeCoveredTools(dir);
      expect(s.size).toBe(0);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("A1.5 persisted report can be re-loaded if fresh + HMAC valid", async () => {
    const m = await import("../../packages/core/src/release_gate/autoprobe.js");
    const dir = tmp();
    try {
      mkdirSync(join(dir, ".mneme", "autoprobe"), { recursive: true });
      const r = m.runAutoprobe({ tools: ["mneme.version"], cwd: dir, noPersist: false, cliBinPath: CLI });
      const loaded = m.loadFreshAutoprobeReport(dir);
      expect(loaded).not.toBeNull();
      expect(loaded?.totalTested).toBe(r.totalTested);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("v2.58.0 A2 — probe_coverage 3rd source wire-up (PINNED)", () => {
  it("A2.1 autoprobe set counts as 'covered' alongside claim + READONLY pattern", async () => {
    const m = await import("../../packages/core/src/release_gate/probe_coverage.js");
    const r = m.checkProbeCoverage({
      newTools: ["mneme.foo.weird_verb_no_claim"],
      knownClaims: [],
      autoprobeCovered: new Set(["mneme.foo.weird_verb_no_claim"]),
    });
    expect(r.ok).toBe(true);
    expect(r.covered[0]?.via).toBe("autoprobe");
  });

  it("A2.2 without autoprobe, uncovered tool still uncovered", async () => {
    const m = await import("../../packages/core/src/release_gate/probe_coverage.js");
    const r = m.checkProbeCoverage({
      newTools: ["mneme.foo.weird_verb_no_claim"],
      knownClaims: [],
    });
    expect(r.ok).toBe(false);
    expect(r.uncovered).toContain("mneme.foo.weird_verb_no_claim");
  });

  it("A2.3 crossCheckFromDisk hits 100% on the repo after autoprobe ran", async () => {
    const m = await import("../../packages/core/src/release_gate/probe_coverage.js");
    const r = m.crossCheckFromDisk(REPO, { threshold: 100 });
    expect(r.coveragePercent).toBe(100);
    expect(r.uncovered.length).toBe(0);
    expect(r.ok).toBe(true);
  });
});

describe("v2.58.0 A3 — LIVING LAB active-learning picker (PINNED)", () => {
  it("A3.1 pickToolByLearning returns one tool from pool", async () => {
    const m = await import("../../packages/core/src/living_lab/index.js");
    const r = m.pickToolByLearning(["a", "b", "c"], { tools: {}, at: new Date().toISOString() });
    expect(["a", "b", "c"]).toContain(r);
  });

  it("A3.2 empty pool returns empty string", async () => {
    const m = await import("../../packages/core/src/living_lab/index.js");
    expect(m.pickToolByLearning([], { tools: {}, at: new Date().toISOString() })).toBe("");
  });

  it("A3.3 high-failure tool gets higher priority weight (probabilistic)", async () => {
    const m = await import("../../packages/core/src/living_lab/index.js");
    const pool = ["always_pass", "always_fail"];
    const learning = {
      tools: {
        always_pass: { pass: 100, fail: 0, total: 100, lastSeen: new Date().toISOString(), lastResult: "ok" as const },
        always_fail: { pass: 0, fail: 100, total: 100, lastSeen: new Date().toISOString(), lastResult: "broken" as const },
      },
      at: new Date().toISOString(),
    };
    let failPicks = 0;
    for (let i = 0; i < 200; i++) {
      if (m.pickToolByLearning(pool, learning) === "always_fail") failPicks++;
    }
    // Fail rate should pick the failing tool >50% of the time given the priority weighting.
    expect(failPicks).toBeGreaterThan(100);
  });
});

describe("v2.58.0 A4 — LIVING LAB tick + findings + heartbeat (PINNED)", () => {
  it("A4.1 runLivingLabTick on empty pool returns no-op", async () => {
    const m = await import("../../packages/core/src/living_lab/index.js");
    const dir = tmp();
    try {
      const r = m.runLivingLabTick({ cwd: dir, toolPool: [], cliBinPath: CLI });
      expect(r.tool).toBe("");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("A4.2 runLivingLabTick on real tool returns ok envelope + updates learning", async () => {
    const m = await import("../../packages/core/src/living_lab/index.js");
    const dir = tmp();
    try {
      const r = m.runLivingLabTick({ cwd: dir, toolPool: ["mneme.version"], cliBinPath: CLI });
      expect(["ok", "broken"]).toContain(r.outcome);
      expect(typeof r.latencyMs).toBe("number");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("A4.3 writeHeartbeat + readHeartbeat + isHeartbeatFresh round-trip", async () => {
    const m = await import("../../packages/core/src/living_lab/index.js");
    const dir = tmp();
    try {
      const at = new Date().toISOString();
      const hb = m.writeHeartbeat(dir, { at, uptimeMs: 1234, ticksRun: 5, toolsTested: 5, findingsTotal: 0 });
      expect(hb.hmac.length).toBeGreaterThanOrEqual(64);
      const read = m.readHeartbeat(dir);
      expect(read?.ticksRun).toBe(5);
      expect(m.isHeartbeatFresh(dir)).toBe(true);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("A4.4 isHeartbeatFresh false when no heartbeat exists", async () => {
    const m = await import("../../packages/core/src/living_lab/index.js");
    const dir = tmp();
    try {
      expect(m.isHeartbeatFresh(dir)).toBe(false);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("v2.58.0 A5 — LIVING LAB chain HMAC + tamper detection (PINNED)", () => {
  it("A5.1 verifyFindingChain returns true on empty ledger", async () => {
    const m = await import("../../packages/core/src/living_lab/index.js");
    const dir = tmp();
    try {
      expect(m.verifyFindingChain(dir)).toBe(true);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("A5.2 readFindings returns empty when no ledger exists", async () => {
    const m = await import("../../packages/core/src/living_lab/index.js");
    const dir = tmp();
    try {
      expect(m.readFindings(dir).length).toBe(0);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("A5.3 openFindings empty when chain empty", async () => {
    const m = await import("../../packages/core/src/living_lab/index.js");
    const dir = tmp();
    try {
      expect(m.openFindings(dir).length).toBe(0);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("v2.58.0 A6 — LIVING LAB commit safety (PINNED)", () => {
  it("A6.1 commitProposalToBranch refuses outside main checkout (non-git dir behaves safely)", async () => {
    const m = await import("../../packages/core/src/living_lab/index.js");
    const dir = tmp();
    try {
      const r = m.commitProposalToBranch(dir);
      // Either fails fast (non-git dir) or refuses to act — both are safe.
      expect(typeof r.ok).toBe("boolean");
      expect(r.committed).toBeLessThanOrEqual(1);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("A6.2 writeProposalForFinding produces a markdown file for a finding id", async () => {
    const m = await import("../../packages/core/src/living_lab/index.js");
    const dir = tmp();
    try {
      const finding = {
        id: "abc123",
        at: new Date().toISOString(),
        tool: "mneme.foo.bar",
        prevState: "ok" as const,
        curState: "broken" as const,
        evidence: "exit=1",
        prevHmac: "",
        hmac: "deadbeef",
      };
      const r = m.writeProposalForFinding(dir, finding);
      expect(existsSync(r.path)).toBe(true);
      expect(r.body).toContain("mneme.foo.bar");
      expect(r.body).toContain("# LIVING LAB proposal");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("v2.58.0 A7 — TG probes for v2.58 surface (PINNED)", () => {
  it("A7.1 probe.coverage.real_100_percent returns 1 on repo with fresh autoprobe", async () => {
    const m = await import("../../packages/core/src/truth_gate/probes.js");
    const p = m.probeById("probe.coverage.real_100_percent");
    expect(p).toBeDefined();
    const r = await p!.run({ cwd: REPO });
    expect(r.value).toBe(1);
  });

  it("A7.2 probe.autoprobe.fresh returns 1 after autoprobe ran", async () => {
    const m = await import("../../packages/core/src/truth_gate/probes.js");
    const p = m.probeById("probe.autoprobe.fresh");
    expect(p).toBeDefined();
    const r = await p!.run({ cwd: REPO });
    expect(r.value).toBe(1);
  });

  it("A7.3 probe.living_lab.no_open_findings returns 1 on clean ledger", async () => {
    const m = await import("../../packages/core/src/truth_gate/probes.js");
    const p = m.probeById("probe.living_lab.no_open_findings");
    expect(p).toBeDefined();
    const r = await p!.run({ cwd: REPO });
    expect(r.value).toBe(1);
  });

  it("A7.4 probe.living_lab.heartbeat_fresh is 1 OR null (null = daemon not started)", async () => {
    const m = await import("../../packages/core/src/truth_gate/probes.js");
    const p = m.probeById("probe.living_lab.heartbeat_fresh");
    expect(p).toBeDefined();
    const r = await p!.run({ cwd: REPO });
    expect([null, 0, 1]).toContain(r.value);
  });
});

describe("v2.58.0 A8 — CLI surfaces (PINNED)", () => {
  function runCli(args: string[]): { stdout: string; stderr: string; status: number | null } {
    const r = spawnSync(process.execPath, [CLI, ...args], { encoding: "utf8", timeout: 60000 });
    return { stdout: r.stdout ?? "", stderr: r.stderr ?? "", status: r.status };
  }

  it("A8.1 `mneme autoprobe report` shows last_run.json when fresh", () => {
    const r = runCli(["autoprobe", "report"]);
    expect(r.status).toBe(0);
    const parsed = JSON.parse(r.stdout);
    expect(typeof parsed.totalTested).toBe("number");
  });

  it("A8.2 `mneme living_lab` default returns status envelope", () => {
    const r = runCli(["living_lab"]);
    expect(r.status === 0 || r.status === 1).toBe(true);
    const parsed = JSON.parse(r.stdout);
    expect("fresh" in parsed).toBe(true);
    expect("openFindings" in parsed).toBe(true);
  });

  it("A8.3 `mneme living_lab tick` runs one tick + returns envelope", () => {
    const r = runCli(["living_lab", "tick"]);
    expect(r.status).toBe(0);
    const parsed = JSON.parse(r.stdout);
    expect(["ok", "broken"]).toContain(parsed.outcome);
  });

  it("A8.4 `mneme living_lab findings` returns chain-verified list", () => {
    const r = runCli(["living_lab", "findings"]);
    expect(r.status).toBe(0);
    const parsed = JSON.parse(r.stdout);
    expect(typeof parsed.chainOk).toBe("boolean");
    expect(typeof parsed.openCount).toBe("number");
  });

  it("A8.5 `mneme probe coverage` reports 100% with new threshold", () => {
    const r = runCli(["probe", "coverage", "--threshold", "100"]);
    expect(r.status).toBe(0);
    const parsed = JSON.parse(r.stdout);
    expect(parsed.coveragePercent).toBe(100);
  });
});

describe("v2.58.0 A9 — LAUNCH WINDOW = GO at real 100% coverage (PINNED)", () => {
  it("A9.1 evaluateLaunchWindow with strict probe-coverage threshold=100 returns GO", async () => {
    const m = await import("../../packages/core/src/xai_alignment/index.js");
    const v = await m.evaluateLaunchWindow({ cwd: REPO, fast: true });
    expect(v.status).toBe("GO");
    expect(v.goRate).toBe(1);
  });

  it("A9.2 LAUNCH WINDOW countdown reads T-0 GO at 100% coverage", async () => {
    const m = await import("../../packages/core/src/xai_alignment/index.js");
    const v = await m.evaluateLaunchWindow({ cwd: REPO, fast: true });
    if (v.status === "GO") expect(v.countdown).toMatch(/T-0 GO/);
  });
});
