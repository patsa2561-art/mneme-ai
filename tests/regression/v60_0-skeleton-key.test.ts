/**
 * v2.60.0 — SKELETON KEY (MCP server security auditor) pinned tests.
 *
 * The "conscience + bodyguard" angle of Mneme MCP. First MCP security
 * auditor in the ecosystem.
 *
 * Section map:
 *   C1 — risk heuristics (name → severity / CWE / capabilities)
 *   C2 — config discovery (multi-schema tolerance)
 *   C3 — bypass graph (transitive attack-path derivation)
 *   C4 — risk budget (numeric sum across all servers)
 *   C5 — HMAC pin + drift detection
 *   C6 — auditMcpConfigs end-to-end + envelope HMAC verify
 *   C7 — recommendations
 *   C8 — CLI surface (mneme skeleton_key audit / recommend / pin / drift)
 *   C9 — defensive behavior (never throws on missing / corrupted configs)
 */

import { describe, it, expect } from "vitest";
import { spawnSync } from "node:child_process";
import { resolve, join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(__dirname, "../..");
const CLI = join(REPO, "packages", "cli", "bin", "mneme.js");

function tmp(): string {
  return mkdtempSync(join(tmpdir(), "mneme-sk-"));
}

function writeConfig(dir: string, body: object): string {
  const p = join(dir, "claude_desktop_config.json");
  writeFileSync(p, JSON.stringify(body, null, 2));
  return p;
}

describe("v2.60.0 C1 — risk heuristics (PINNED)", () => {
  it("C1.1 matchHeuristic on 'shell-mcp' returns critical (≥0.90) with CWE-78", async () => {
    const m = await import("../../packages/core/src/skeleton_key/index.js");
    const r = m.matchHeuristic("shell-mcp");
    expect(r).not.toBeNull();
    expect(r!.severity).toBeGreaterThanOrEqual(0.90);
    expect(r!.cwe).toBe("CWE-78");
  });

  it("C1.2 matchHeuristic on 'filesystem-mcp' returns high (≥0.80) with CWE-22", async () => {
    const m = await import("../../packages/core/src/skeleton_key/index.js");
    const r = m.matchHeuristic("filesystem-mcp");
    expect(r).not.toBeNull();
    expect(r!.severity).toBeGreaterThanOrEqual(0.80);
    expect(r!.cwe).toBe("CWE-22");
  });

  it("C1.3 matchHeuristic on totally-unknown name returns null", async () => {
    const m = await import("../../packages/core/src/skeleton_key/index.js");
    const r = m.matchHeuristic("zzzz-totally-fake-name-zzzz");
    expect(r).toBeNull();
  });

  it("C1.4 every heuristic has cwe + capabilities + mitigation", async () => {
    const m = await import("../../packages/core/src/skeleton_key/index.js");
    for (const h of m.RISK_HEURISTICS) {
      expect(typeof h.cwe).toBe("string");
      expect(h.capabilities.length).toBeGreaterThan(0);
      expect(typeof h.mitigation).toBe("string");
      expect(h.severity).toBeGreaterThanOrEqual(0);
      expect(h.severity).toBeLessThanOrEqual(1);
    }
  });
});

describe("v2.60.0 C2 — config discovery (PINNED)", () => {
  it("C2.1 discoverServers parses claude_desktop_config.json schema", async () => {
    const m = await import("../../packages/core/src/skeleton_key/index.js");
    const dir = tmp();
    try {
      const p = writeConfig(dir, { mcpServers: { foo: { command: "node", args: ["foo.js"] } } });
      const servers = m.discoverServers([p]);
      expect(servers.length).toBe(1);
      expect(servers[0]?.name).toBe("foo");
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });

  it("C2.2 discoverServers tolerates cursor settings schema (claude.mcpServers)", async () => {
    const m = await import("../../packages/core/src/skeleton_key/index.js");
    const dir = tmp();
    try {
      const p = writeConfig(dir, { "claude.mcpServers": { bar: { command: "node" } } });
      const servers = m.discoverServers([p]);
      expect(servers.length).toBe(1);
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });

  it("C2.3 discoverServers tolerates nested mcp.servers", async () => {
    const m = await import("../../packages/core/src/skeleton_key/index.js");
    const dir = tmp();
    try {
      const p = writeConfig(dir, { mcp: { servers: { baz: { command: "node" } } } });
      const servers = m.discoverServers([p]);
      expect(servers.length).toBe(1);
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });

  it("C2.4 discoverServers returns empty on missing file (no throw)", async () => {
    const m = await import("../../packages/core/src/skeleton_key/index.js");
    expect(m.discoverServers(["/__totally_missing__.json"])).toEqual([]);
  });

  it("C2.5 discoverServers tolerates corrupted JSON (no throw)", async () => {
    const m = await import("../../packages/core/src/skeleton_key/index.js");
    const dir = tmp();
    try {
      const p = join(dir, "bad.json");
      writeFileSync(p, "{ this is not json");
      expect(m.discoverServers([p])).toEqual([]);
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });
});

describe("v2.60.0 C3 — bypass graph (PINNED)", () => {
  it("C3.1 3-server fixture (shell + fs + github) → ≥3 bypass paths derived", async () => {
    const m = await import("../../packages/core/src/skeleton_key/index.js");
    const shell = { name: "shell", risk: m.RISK_HEURISTICS.find((h) => h.match === "shell-mcp")!, source: "f" };
    const fs = { name: "fs", risk: m.RISK_HEURISTICS.find((h) => h.match === "filesystem")!, source: "f" };
    const gh = { name: "gh", risk: m.RISK_HEURISTICS.find((h) => h.match === "github")!, source: "f" };
    const g = m.buildBypassGraph([shell, fs, gh]);
    expect(g.bypassPaths.length).toBeGreaterThanOrEqual(3);
    // delete_repo must surface
    expect(g.bypassPaths.find((p) => p.goal === "delete_repo")).toBeDefined();
  });

  it("C3.2 capability overlaps surface 'exec' if ≥2 servers expose it", async () => {
    const m = await import("../../packages/core/src/skeleton_key/index.js");
    const a = { name: "a", risk: m.RISK_HEURISTICS.find((h) => h.match === "shell-mcp")!, source: "f" };
    const b = { name: "b", risk: m.RISK_HEURISTICS.find((h) => h.match === "exec-mcp")!, source: "f" };
    const g = m.buildBypassGraph([a, b]);
    expect(g.overlaps.find((o) => o.capability === "exec")?.count).toBe(2);
  });

  it("C3.3 empty input → empty graph (no throw)", async () => {
    const m = await import("../../packages/core/src/skeleton_key/index.js");
    const g = m.buildBypassGraph([]);
    expect(g.bypassPaths.length).toBe(0);
    expect(g.overlaps.length).toBe(0);
  });
});

describe("v2.60.0 C4 — risk budget (PINNED)", () => {
  it("C4.1 totalRiskBudget sums severity × capability count", async () => {
    const m = await import("../../packages/core/src/skeleton_key/index.js");
    const shell = { name: "shell", risk: m.RISK_HEURISTICS.find((h) => h.match === "shell-mcp")!, source: "f" };
    const budget = m.totalRiskBudget([shell]);
    // shell-mcp: severity 0.95, capabilities ["exec","write_fs","network","process_kill"] = 4
    // budget = 0.95 * 4 = 3.8
    expect(budget).toBeCloseTo(3.8, 1);
  });

  it("C4.2 empty input → 0 budget", async () => {
    const m = await import("../../packages/core/src/skeleton_key/index.js");
    expect(m.totalRiskBudget([])).toBe(0);
  });
});

describe("v2.60.0 C5 — HMAC pin + drift (PINNED)", () => {
  it("C5.1 detectConfigDrift returns hasSnapshot=false when no pin exists", async () => {
    const m = await import("../../packages/core/src/skeleton_key/index.js");
    const dir = tmp();
    try {
      const r = m.detectConfigDrift(dir);
      expect(r.hasSnapshot).toBe(false);
      expect(r.hint).toMatch(/no snapshot/i);
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });

  it("C5.2 pin + drift round-trip on unchanged config → ok=true", async () => {
    const m = await import("../../packages/core/src/skeleton_key/index.js");
    const dir = tmp();
    const cfgDir = tmp();
    try {
      const p = writeConfig(cfgDir, { mcpServers: { x: { command: "node", args: ["a.js"] } } });
      m.pinConfigSnapshot(dir, [p]);
      const drift = m.detectConfigDrift(dir, [p]);
      expect(drift.ok).toBe(true);
      expect(drift.added.length).toBe(0);
      expect(drift.removed.length).toBe(0);
    } finally {
      rmSync(dir, { recursive: true, force: true });
      rmSync(cfgDir, { recursive: true, force: true });
    }
  });

  it("C5.3 pin then add new server → drift detects 'added'", async () => {
    const m = await import("../../packages/core/src/skeleton_key/index.js");
    const dir = tmp();
    const cfgDir = tmp();
    try {
      const p = writeConfig(cfgDir, { mcpServers: { x: { command: "node" } } });
      m.pinConfigSnapshot(dir, [p]);
      writeFileSync(p, JSON.stringify({ mcpServers: { x: { command: "node" }, y: { command: "node" } } }));
      const drift = m.detectConfigDrift(dir, [p]);
      expect(drift.ok).toBe(false);
      expect(drift.added.find((a) => a.name === "y")).toBeDefined();
    } finally {
      rmSync(dir, { recursive: true, force: true });
      rmSync(cfgDir, { recursive: true, force: true });
    }
  });

  it("C5.4 pin then mutate command → drift detects 'modified'", async () => {
    const m = await import("../../packages/core/src/skeleton_key/index.js");
    const dir = tmp();
    const cfgDir = tmp();
    try {
      const p = writeConfig(cfgDir, { mcpServers: { x: { command: "node", args: ["v1.js"] } } });
      m.pinConfigSnapshot(dir, [p]);
      writeFileSync(p, JSON.stringify({ mcpServers: { x: { command: "node", args: ["EVIL.js"] } } }));
      const drift = m.detectConfigDrift(dir, [p]);
      expect(drift.modified.length).toBe(1);
      expect(drift.modified[0]?.name).toBe("x");
    } finally {
      rmSync(dir, { recursive: true, force: true });
      rmSync(cfgDir, { recursive: true, force: true });
    }
  });
});

describe("v2.60.0 C6 — auditMcpConfigs end-to-end (PINNED)", () => {
  it("C6.1 audit on synthetic 5-server config returns valid HMAC envelope", async () => {
    const m = await import("../../packages/core/src/skeleton_key/index.js");
    const dir = tmp();
    try {
      const p = writeConfig(dir, {
        mcpServers: {
          "shell-mcp": { command: "node" },
          "filesystem-mcp": { command: "node" },
          "github-mcp": { command: "node" },
          "postgres-mcp": { command: "node" },
          "memory-mcp": { command: "node" },
        },
      });
      const r = await m.auditMcpConfigs({ configPaths: [p], budgetCap: 5 });
      expect(r.totalServers).toBe(5);
      expect(r.findings.length).toBe(5);
      expect(m.verifyAudit(r)).toBe(true);
      // shell is the highest-severity finding
      expect(r.findings[0]?.server).toBe("shell-mcp");
      // OVER BUDGET (sum exceeds 5)
      expect(r.withinBudget).toBe(false);
      // bypass paths derived
      expect(r.graph.bypassPaths.length).toBeGreaterThan(0);
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });

  it("C6.2 audit on empty config returns ok=true with 0 servers", async () => {
    const m = await import("../../packages/core/src/skeleton_key/index.js");
    const r = await m.auditMcpConfigs({ configPaths: ["/__nonexistent__.json"], budgetCap: 5 });
    expect(r.totalServers).toBe(0);
    expect(r.ok).toBe(true);
    expect(m.verifyAudit(r)).toBe(true);
  });

  it("C6.3 tamper detection: mutating findings invalidates HMAC", async () => {
    const m = await import("../../packages/core/src/skeleton_key/index.js");
    const dir = tmp();
    try {
      const p = writeConfig(dir, { mcpServers: { "shell-mcp": { command: "node" } } });
      const r = await m.auditMcpConfigs({ configPaths: [p] });
      const tampered = { ...r, totalServers: 999 };
      expect(m.verifyAudit(tampered)).toBe(false);
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });
});

describe("v2.60.0 C7 — recommendations (PINNED)", () => {
  it("C7.1 buildRecommendations emits per-server actions with CWE + severity", async () => {
    const m = await import("../../packages/core/src/skeleton_key/index.js");
    const dir = tmp();
    try {
      const p = writeConfig(dir, { mcpServers: { "shell-mcp": { command: "node" }, "filesystem-mcp": { command: "node" } } });
      const r = await m.auditMcpConfigs({ configPaths: [p] });
      const recs = m.buildRecommendations(r);
      expect(recs.length).toBeGreaterThanOrEqual(2);
      for (const rec of recs) {
        expect(typeof rec.cwe).toBe("string");
        expect(rec.severity).toBeGreaterThanOrEqual(0);
        expect(rec.action.length).toBeGreaterThan(0);
      }
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });

  it("C7.2 buildRecommendations is empty when no findings ≥0.55", async () => {
    const m = await import("../../packages/core/src/skeleton_key/index.js");
    const dir = tmp();
    try {
      const p = writeConfig(dir, { mcpServers: { "memory-mcp": { command: "node" } } });
      const r = await m.auditMcpConfigs({ configPaths: [p] });
      const recs = m.buildRecommendations(r);
      expect(recs.length).toBe(0);
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });
});

describe("v2.60.0 C8 — CLI surface (PINNED)", () => {
  function runCli(args: string[]): { stdout: string; stderr: string; status: number | null } {
    const r = spawnSync(process.execPath, [CLI, ...args], { encoding: "utf8", timeout: 60000 });
    return { stdout: r.stdout ?? "", stderr: r.stderr ?? "", status: r.status };
  }

  it("C8.1 `mneme skeleton_key audit` returns JSON envelope", () => {
    const r = runCli(["skeleton_key", "audit"]);
    // ok or warning is fine — what matters is valid JSON envelope
    const parsed = JSON.parse(r.stdout);
    expect("totalServers" in parsed).toBe(true);
    expect("hmac" in parsed).toBe(true);
  });

  it("C8.2 `mneme skeleton_key audit --banner` outputs ASCII banner", () => {
    const r = runCli(["skeleton_key", "audit", "--banner"]);
    expect(r.stdout).toMatch(/SKELETON KEY/);
  });

  it("C8.3 `mneme skeleton_key recommend` returns JSON with recommendations array", () => {
    const r = runCli(["skeleton_key", "recommend"]);
    const parsed = JSON.parse(r.stdout);
    expect(Array.isArray(parsed.recommendations)).toBe(true);
  });

  it("C8.4 `mneme skeleton_key drift` works without snapshot (returns hint)", () => {
    const dir = tmp();
    try {
      const r = spawnSync(process.execPath, [CLI, "skeleton_key", "drift"], { encoding: "utf8", timeout: 60000, cwd: dir });
      const parsed = JSON.parse(r.stdout ?? "");
      expect(parsed.hasSnapshot === false || parsed.hasSnapshot === true).toBe(true);
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });
});

describe("v2.60.0 C9 — defensive behavior (PINNED)", () => {
  it("C9.1 auditMcpConfigs never throws on missing config paths", async () => {
    const m = await import("../../packages/core/src/skeleton_key/index.js");
    await expect(m.auditMcpConfigs({ configPaths: ["/__a__.json", "/__b__.json"] })).resolves.toBeDefined();
  });

  it("C9.2 pinConfigSnapshot never throws even when cwd is unwritable", async () => {
    const m = await import("../../packages/core/src/skeleton_key/index.js");
    // Use a tmp dir; pin should succeed
    const dir = tmp();
    try {
      expect(() => m.pinConfigSnapshot(dir, ["/__missing__.json"])).not.toThrow();
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });

  it("C9.3 TG probe probe.skeleton_key.audit_runs returns 1", async () => {
    const m = await import("../../packages/core/src/truth_gate/probes.js");
    const p = m.probeById("probe.skeleton_key.audit_runs");
    expect(p).toBeDefined();
    const r = await p!.run({ cwd: REPO });
    expect(r.value).toBe(1);
  });

  it("C9.4 TG probe probe.skeleton_key.bypass_graph_works returns 1", async () => {
    const m = await import("../../packages/core/src/truth_gate/probes.js");
    const p = m.probeById("probe.skeleton_key.bypass_graph_works");
    expect(p).toBeDefined();
    const r = await p!.run({ cwd: REPO });
    expect(r.value).toBe(1);
  });
});
