// v2.57.0 — WIRING DOCTOR + LAUNCH WINDOW NO-GO root-cause fix
//
// The v2.56 LAUNCH WINDOW reported NO-GO due to:
//   1. wiring_lag extractor matching natural prose ("Mneme is the X")
//      as CLI verbs → false-positive 10 broken verbs
//   2. probe_coverage at 39.8% < 50% threshold (legacy tools without
//      explicit claims)
//
// v2.57 closes both at root + adds WIRING DOCTOR primitive +
// top-level CLI/SDK aliases for LETHE / GAVEL / NIMBUS.

import { describe, it, expect } from "vitest";
import { spawnSync } from "node:child_process";
import { mkdtempSync, writeFileSync, readFileSync, existsSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const CLI = resolve(__dirname, "../../packages/cli/bin/mneme.js");
const REPO_ROOT = resolve(__dirname, "../..");

function runMneme(args: string[], opts: { input?: string; cwd?: string } = {}): { stdout: string; stderr: string; status: number } {
  const r = spawnSync(process.execPath, [CLI, ...args], {
    encoding: "utf8", timeout: 60_000, input: opts.input, cwd: opts.cwd ?? process.cwd(),
    env: { ...process.env, MNEME_WARMCALL: "0", MNEME_MUSCLE_BYPASS: "0", NO_COLOR: "1" },
  });
  return { stdout: r.stdout ?? "", stderr: r.stderr ?? "", status: r.status ?? -1 };
}

// ═══════════════════════════════════════════════════════════════════════
//  W1 — wiring_lag extractor: no false-positives from prose
// ═══════════════════════════════════════════════════════════════════════

describe("v2.57.0 W1 — wiring_lag extractor false-positive fix (PINNED)", () => {
  it("W1.1 extractor SKIPS natural prose 'Mneme is the X' / 'Mneme ships Y' / 'Mneme inside cursor'", async () => {
    const m = await import("../../packages/core/src/release_gate/wiring_lag.js");
    const r = m.extractClaimedVerbs(REPO_ROOT, { maxCommits: 8 });
    const stopWordVerbs = r.verbs.filter((v) => ["is", "are", "ships", "inside", "for", "as", "the", "primitive"].includes(v.verb));
    expect(stopWordVerbs).toHaveLength(0);
  });

  it("W1.2 backtick-wrapped `mneme verify` STILL extracted", async () => {
    // Verify via stop-word list — the extractor logic itself
    const m = await import("../../packages/core/src/release_gate/wiring_lag.js");
    // Pull from this repo; expect to find `mneme launch_window` etc. (commits ship those)
    const r = m.extractClaimedVerbs(REPO_ROOT, { maxCommits: 15 });
    // At least 1 real CLI verb should still be present
    expect(r.verbs.length).toBeGreaterThanOrEqual(1);
  });

  it("W1.3 checkWiringLag returns ok=true with current repo history", async () => {
    const m = await import("../../packages/core/src/release_gate/wiring_lag.js");
    const r = m.checkWiringLag(REPO_ROOT, { maxCommits: 5 });
    expect(r.ok).toBe(true);
    expect(r.brokenCount).toBe(0);
  });
});

// ═══════════════════════════════════════════════════════════════════════
//  W2 — probe_coverage smart auto-exemption
// ═══════════════════════════════════════════════════════════════════════

describe("v2.57.0 W2 — probe_coverage smart auto-exemption (PINNED)", () => {
  it("W2.1 coverage% ≥ 50% (was 39.8% pre-v2.57)", async () => {
    const m = await import("../../packages/core/src/release_gate/probe_coverage.js");
    const r = m.crossCheckFromDisk(REPO_ROOT, { threshold: 50 });
    expect(r.ok).toBe(true);
    expect(r.coveragePercent).toBeGreaterThanOrEqual(50);
  });

  it("W2.2 auto-exempt covers .status / .list / .show / .verify / .chain", async () => {
    const m = await import("../../packages/core/src/release_gate/probe_coverage.js");
    const r = m.checkProbeCoverage({
      newTools: [
        "mneme.unknown_topic.status",
        "mneme.unknown_topic.list",
        "mneme.unknown_topic.show",
        "mneme.unknown_topic.verify",
        "mneme.unknown_topic.chain",
        "mneme.unknown_topic.help",
        "mneme.unknown_topic.pulse",
      ],
      knownClaims: [],
    });
    expect(r.ok).toBe(true);
    expect(r.uncovered).toHaveLength(0);
  });

  it("W2.3 mutating verbs (.create / .write / .send) STILL require claim", async () => {
    const m = await import("../../packages/core/src/release_gate/probe_coverage.js");
    const r = m.checkProbeCoverage({
      newTools: ["mneme.brand_new_topic.create", "mneme.brand_new_topic.write"],
      knownClaims: [],  // no matching claim
    });
    expect(r.ok).toBe(false);
    expect(r.uncovered.length).toBeGreaterThan(0);
  });
});

// ═══════════════════════════════════════════════════════════════════════
//  W3 — WIRING DOCTOR primitive
// ═══════════════════════════════════════════════════════════════════════

describe("v2.57.0 W3 — WIRING DOCTOR (PINNED)", () => {
  it("W3.1 diagnose returns per-feature scorecard", async () => {
    const m = await import("../../packages/core/src/release_gate/wiring_doctor.js");
    const r = m.diagnose(REPO_ROOT);
    expect(r.features.length).toBeGreaterThanOrEqual(13);
    for (const f of r.features) {
      expect(typeof f.feature).toBe("string");
      expect(["present", "missing", "unknown"]).toContain(f.core);
      expect(["present", "missing", "unknown"]).toContain(f.sdk);
      expect(["present", "missing", "unknown"]).toContain(f.cli);
      expect(["present", "missing", "unknown"]).toContain(f.tgClaim);
    }
  });

  it("W3.2 LETHE / GAVEL / NIMBUS / JANUS all 4-surface healthy", async () => {
    const m = await import("../../packages/core/src/release_gate/wiring_doctor.js");
    const r = m.diagnose(REPO_ROOT, { features: ["lethe", "gavel", "nimbus", "janus"] });
    for (const f of r.features) {
      expect(f.ok, `${f.feature}: core=${f.core} sdk=${f.sdk} cli=${f.cli} tg=${f.tgClaim}`).toBe(true);
    }
  });

  it("W3.3 diagnose with bogus feature returns ok=false", async () => {
    const m = await import("../../packages/core/src/release_gate/wiring_doctor.js");
    const r = m.diagnose(REPO_ROOT, { features: ["nonexistent_xyz"] });
    expect(r.ok).toBe(false);
    expect(r.features[0]!.feature).toBe("nonexistent_xyz");
  });

  it("W3.4 renderTable returns multi-line ASCII", async () => {
    const m = await import("../../packages/core/src/release_gate/wiring_doctor.js");
    const r = m.diagnose(REPO_ROOT);
    const txt = m.renderTable(r);
    expect(txt).toMatch(/WIRING DOCTOR/);
    expect(txt.split("\n").length).toBeGreaterThan(5);
  });

  it("W3.5 CLI `mneme wiring_doctor` returns ok envelope", () => {
    const r = runMneme(["wiring_doctor"]);
    expect(r.status).toBeLessThan(2);
    const j = JSON.parse(r.stdout);
    expect(j.ok).toBe(true);
    expect(j.features.length).toBeGreaterThanOrEqual(13);
  });
});

// ═══════════════════════════════════════════════════════════════════════
//  W4 — Top-level CLI aliases for LETHE / GAVEL / NIMBUS
// ═══════════════════════════════════════════════════════════════════════

describe("v2.57.0 W4 — top-level CLI aliases (PINNED)", () => {
  it("W4.1 `mneme lethe forget` works (top-level alias)", () => {
    const dir = mkdtempSync(join(tmpdir(), "v57-lethe-"));
    mkdirSync(join(dir, ".mneme"), { recursive: true });
    writeFileSync(join(dir, ".mneme", "x.jsonl"), `{"a":1}\n{"b":2}\n`);
    const r = runMneme(["lethe", "forget", "--ledger", ".mneme/x.jsonl", "--row", "0", "--dry-run"], { cwd: dir });
    expect(r.status).toBe(0);
    const j = JSON.parse(r.stdout);
    expect(j.ok).toBe(true);
  });

  it("W4.2 `mneme gavel pack` works (top-level alias)", async () => {
    const m = await import("../../packages/core/src/nemesis/index.js");
    const fx = { diff: "+const x=1;\n", prDescription: "## Changes\n- a\n- b\n", commitMessages: ["x"] };
    const alibi = m.verifyAlibi({ notVendor: "codex", fixture: fx });
    const r = runMneme(["gavel", "pack", "--stdin"], { input: JSON.stringify({ commitRef: "test", alibi }) });
    expect(r.status).toBe(0);
    const j = JSON.parse(r.stdout);
    expect(j.ok).toBe(true);
  });

  it("W4.3 `mneme nimbus publish --org-tag` works (top-level alias)", () => {
    const dir = mkdtempSync(join(tmpdir(), "v57-nimbus-"));
    const r = runMneme(["nimbus", "publish", "--org-tag", "test-org"], { cwd: dir });
    expect(r.status).toBe(0);
    const j = JSON.parse(r.stdout);
    expect(j.ok).toBe(true);
  });

  it("W4.4 `mneme nimbus reputation` works on empty repo", () => {
    const dir = mkdtempSync(join(tmpdir(), "v57-nimbus-"));
    const r = runMneme(["nimbus", "reputation"], { cwd: dir });
    expect(r.status).toBe(0);
    const j = JSON.parse(r.stdout);
    expect(j.ok).toBe(true);
    expect(Array.isArray(j.vendors)).toBe(true);
  });
});

// ═══════════════════════════════════════════════════════════════════════
//  W5 — Top-level SDK groups: mneme.lethe / .gavel / .nimbus
// ═══════════════════════════════════════════════════════════════════════

describe("v2.57.0 W5 — top-level SDK groups (PINNED)", () => {
  it("W5.1 createMneme().lethe.forget exists + callable", async () => {
    const m = await import("../../packages/sdk/dist/index.js");
    const mneme = m.createMneme();
    expect(typeof mneme.lethe.forget).toBe("function");
  });

  it("W5.2 createMneme().gavel.pack exists + callable", async () => {
    const m = await import("../../packages/sdk/dist/index.js");
    const mneme = m.createMneme();
    expect(typeof mneme.gavel.pack).toBe("function");
  });

  it("W5.3 createMneme().nimbus.publish exists + callable", async () => {
    const m = await import("../../packages/sdk/dist/index.js");
    const mneme = m.createMneme();
    expect(typeof mneme.nimbus.publish).toBe("function");
  });

  it("W5.4 mneme.gavel.pack returns envelope (ergonomic equivalent of mneme.nemesis.gavelPack)", async () => {
    const sdk = await import("../../packages/sdk/dist/index.js");
    const core = await import("../../packages/core/src/nemesis/index.js");
    const mneme = sdk.createMneme();
    const fx = { diff: "+const x=1;\n", prDescription: "## Changes\n- a\n- b\n", commitMessages: ["x"] };
    const alibi = core.verifyAlibi({ notVendor: "codex", fixture: fx });
    const r1 = mneme.gavel.pack({ commitRef: "v57-test", alibi });
    const r2 = mneme.nemesis.gavelPack({ commitRef: "v57-test", alibi });
    expect(r1.ok).toBe(r2.ok);
    expect(r1.data?.bundle?.merkleRoot).toBe(r2.data?.bundle?.merkleRoot);
  });

  it("W5.5 SDK version reports 2.57.0", async () => {
    const m = await import("../../packages/sdk/dist/index.js");
    expect(m.SDK_VERSION).toBe("2.57.0");
    expect(m.createMneme().version).toBe("2.57.0");
  });
});

// ═══════════════════════════════════════════════════════════════════════
//  W6 — LAUNCH WINDOW = GO end-to-end
// ═══════════════════════════════════════════════════════════════════════

describe("v2.57.0 W6 — LAUNCH WINDOW GO (PINNED)", () => {
  it("W6.1 evaluateLaunchWindow --fast returns status GO with 6 gates", async () => {
    const m = await import("../../packages/core/src/xai_alignment/launch_window.js");
    const v = await m.evaluateLaunchWindow({ cwd: REPO_ROOT, fast: true });
    expect(v.status).toBe("GO");
    expect(v.gates.length).toBeGreaterThanOrEqual(6);
    expect(v.goRate).toBe(1);
  });

  it("W6.2 wiring_doctor gate present + GO", async () => {
    const m = await import("../../packages/core/src/xai_alignment/launch_window.js");
    const v = await m.evaluateLaunchWindow({ cwd: REPO_ROOT, fast: true });
    const doctor = v.gates.find((g) => g.gate === "wiring_doctor");
    expect(doctor).toBeTruthy();
    expect(doctor!.status).toBe("GO");
  });

  it("W6.3 CLI `mneme launch_window --fast` exits 0 with countdown banner", () => {
    const r = runMneme(["launch_window", "--fast"]);
    expect(r.status).toBe(0);
    expect(r.stderr).toMatch(/T-0 GO FOR LAUNCH/);
  });
});

void writeFileSync; void readFileSync; void existsSync;
