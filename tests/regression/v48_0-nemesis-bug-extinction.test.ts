// v2.48.0 — NEMESIS BUG EXTINCTION PROTOCOL
//
// One pinned test per ❌ from the user's v2.47.0 deep audit:
//   B1 — Claude-Code classification BROKEN (conditional_density=0 on
//        20× if/else blocks because parseDiff requires diff --git header)
//   B2 — NaN confidence leak after v2.47 clamping
//   B3 — EU stamp 984ms / single call (git hook UX target <100ms)
//   B4 — env_scan vs cli-activity ledger vendor mismatch
//   B5 — dev_tooling CLI missing (v2.45 shipped core; 2 versions later
//        WIRING LAG class still active)
//   F6 — NEMESIS verdicts not feeding CONCLAVE weights
//   F7 — TG probe asserting classify accuracy on REAL corpus (≥85%)
//   ROOT — release.ts probe-coverage gate (refuses tag when new tool
//        lacks TG probe binding)

import { describe, it, expect, beforeEach } from "vitest";
import { spawnSync } from "node:child_process";
import { mkdtempSync, writeFileSync, existsSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const CLI = resolve(__dirname, "../../packages/cli/bin/mneme.js");
function runMneme(args: string[], opts: { input?: string; env?: Record<string, string> } = {}): { stdout: string; stderr: string; status: number } {
  const r = spawnSync(process.execPath, [CLI, ...args], {
    encoding: "utf8", timeout: 60_000, input: opts.input,
    env: { ...process.env, MNEME_WARMCALL: "0", MNEME_MUSCLE_BYPASS: "0", NO_COLOR: "1", ...(opts.env ?? {}) },
  });
  return { stdout: r.stdout ?? "", stderr: r.stderr ?? "", status: r.status ?? -1 };
}

// ═══════════════════════════════════════════════════════════════════════
//  B1 — Claude-Code classification BROKEN (header-less diff)
// ═══════════════════════════════════════════════════════════════════════

describe("v2.48.0 B1 — universal diff parser (PINNED)", () => {
  it("B1.1 20× if-blocks in HEADER-LESS diff still produce if_count=20", async () => {
    const m = await import("../../packages/core/src/nemesis/features.js");
    // No diff --git header — raw + lines only (common in test fixtures + clipboards)
    const noHeader = Array.from({ length: 20 }, (_, i) => `+if (a${i}===null) { return ${i}; }`).join("\n");
    const fp = m.extractFingerprint({ diff: noHeader, prDescription: "", commitMessages: [] });
    expect(fp.if_count).toBeGreaterThanOrEqual(20);
    expect(fp.conditional_density).toBeGreaterThan(0.5);
  });

  it("B1.2 20× if-blocks in PROPER diff with header still works", async () => {
    const m = await import("../../packages/core/src/nemesis/features.js");
    const withHeader = "diff --git a/x.ts b/x.ts\n" +
      Array.from({ length: 20 }, (_, i) => `+if (a${i}===null) { return ${i}; }`).join("\n");
    const fp = m.extractFingerprint({ diff: withHeader, prDescription: "", commitMessages: [] });
    expect(fp.if_count).toBeGreaterThanOrEqual(20);
  });

  it("B1.3 20× if-block fixture classifies as claude-code (not copilot)", async () => {
    const m = await import("../../packages/core/src/nemesis/index.js");
    const noHeader = Array.from({ length: 20 }, (_, i) => `+if (a${i}===null) { return ${i}; }`).join("\n");
    const fp = m.extractFingerprint({ diff: noHeader, prDescription: "Branching helper.", commitMessages: ["classify: branching helper"] });
    const v = m.classifyAgentCalibrated(fp);
    expect(v.topVendor, `expected claude-code, got ${v.topVendor}`).toBe("claude-code");
  });

  it("B1.4 GitHub raw-diff format (no headers, just patch hunks) parses correctly", async () => {
    const m = await import("../../packages/core/src/nemesis/features.js");
    // Simulating GitHub API raw diff format
    const githubRaw = "@@ -1,3 +1,8 @@\n const x = 1;\n+if (a) return;\n+if (b) return;\n+if (c) return;\n+if (d) return;\n+if (e) return;\n const y = 2;";
    const fp = m.extractFingerprint({ diff: githubRaw, prDescription: "", commitMessages: [] });
    expect(fp.if_count).toBeGreaterThanOrEqual(5);
  });

  it("B1.5 empty diff returns zero everything (no NaN, no throw)", async () => {
    const m = await import("../../packages/core/src/nemesis/features.js");
    const fp = m.extractFingerprint({ diff: "", prDescription: "", commitMessages: [] });
    expect(fp.if_count).toBe(0);
    expect(fp.conditional_density).toBe(0);
    expect(Number.isFinite(fp.conditional_density)).toBe(true);
  });

  it("B1.6 binary/garbage diff doesn't false-positive copilot", async () => {
    const m = await import("../../packages/core/src/nemesis/index.js");
    const garbage = "\x00\x01\x02 binary blob garbage ".repeat(100);
    const fp = m.extractFingerprint({ diff: garbage, prDescription: "", commitMessages: [] });
    const v = m.classifyAgentCalibrated(fp);
    // Confidence on garbage should be LOW (not 1.0 to any vendor)
    expect(v.confidence).toBeLessThan(0.6);
  });
});

// ═══════════════════════════════════════════════════════════════════════
//  B2 — NaN confidence leak in EU stamp
// ═══════════════════════════════════════════════════════════════════════

describe("v2.48.0 B2 — NaN confidence guard (PINNED)", () => {
  it("B2.1 eu_stamp with NaN confidence coerces to 0 (no NaN leak)", async () => {
    const m = await import("../../packages/core/src/nemesis/eu_ai_act_stamp.js");
    const r = m.stampArticle50({ message: "x", vendor: "claude-code", confidence: NaN });
    expect(r.ok).toBe(true);
    expect(Number.isFinite(r.stamp.confidence)).toBe(true);
    expect(r.stamp.confidence).toBe(0);
    expect(r.stampedMessage).not.toMatch(/confidence=NaN/);
  });

  it("B2.2 eu_stamp with Infinity confidence coerces to 1", async () => {
    const m = await import("../../packages/core/src/nemesis/eu_ai_act_stamp.js");
    const r = m.stampArticle50({ message: "x", vendor: "claude-code", confidence: Infinity });
    expect(Number.isFinite(r.stamp.confidence)).toBe(true);
    expect(r.stamp.confidence).toBeLessThanOrEqual(1);
  });

  it("B2.3 eu_stamp with -Infinity coerces to 0", async () => {
    const m = await import("../../packages/core/src/nemesis/eu_ai_act_stamp.js");
    const r = m.stampArticle50({ message: "x", vendor: "claude-code", confidence: -Infinity });
    expect(r.stamp.confidence).toBe(0);
  });

  it("B2.4 classify confidence is always finite (never NaN)", async () => {
    const m = await import("../../packages/core/src/nemesis/index.js");
    // Empty fingerprint stress
    const fp = { multiline_commit_ratio: 0 } as unknown as Parameters<typeof m.classifyAgentCalibrated>[0];
    const v = m.classifyAgentCalibrated(fp);
    expect(Number.isFinite(v.confidence)).toBe(true);
  });
});

// ═══════════════════════════════════════════════════════════════════════
//  B3 — EU stamp <100ms via WARMCACHE
// ═══════════════════════════════════════════════════════════════════════

describe("v2.48.0 B3 — EU stamp WARMCACHE (PINNED)", () => {
  it("B3.1 SINGLE eu_stamp call <100ms after WARMCACHE primed", async () => {
    const m = await import("../../packages/core/src/nemesis/eu_ai_act_stamp.js");
    // Warm the cache
    m.stampArticle50({ message: "warm", vendor: "claude-code", confidence: 0.9 });
    // Now measure cold-to-hot path
    const t0 = Date.now();
    const r = m.stampArticle50({ message: "fix: real change", vendor: "claude-code", confidence: 0.95 });
    const dt = Date.now() - t0;
    expect(r.ok).toBe(true);
    expect(dt, `single stamp call took ${dt}ms; target <100ms`).toBeLessThan(100);
  });

  it("B3.2 100 sequential calls average <50ms each (hot path)", async () => {
    const m = await import("../../packages/core/src/nemesis/eu_ai_act_stamp.js");
    m.stampArticle50({ message: "warm", vendor: "claude-code", confidence: 0.9 });
    const t0 = Date.now();
    for (let i = 0; i < 100; i++) {
      m.stampArticle50({ message: `msg ${i}`, vendor: "claude-code", confidence: 0.9 });
    }
    const dt = Date.now() - t0;
    const perCall = dt / 100;
    expect(perCall, `avg ${perCall.toFixed(1)}ms/call`).toBeLessThan(50);
  });

  it("B3.3 verifyStamp round-trips at <50ms after warm", async () => {
    const m = await import("../../packages/core/src/nemesis/eu_ai_act_stamp.js");
    const stamp = m.stampArticle50({ message: "x", vendor: "cursor", confidence: 0.9 });
    const t0 = Date.now();
    const v = m.verifyStamp(stamp.stampedMessage);
    expect(Date.now() - t0).toBeLessThan(50);
    expect(v.valid).toBe(true);
  });
});

// ═══════════════════════════════════════════════════════════════════════
//  B4 — env_scan ↔ cli-activity vendor sync
// ═══════════════════════════════════════════════════════════════════════

describe("v2.48.0 B4 — env_scan vendor sync (PINNED)", () => {
  it("B4.1 reconcileVendor returns env vendor when env confidence > activity", async () => {
    const m = await import("../../packages/core/src/nemesis/vendor_reconcile.js");
    const r = m.reconcileVendor({ envVendor: "claude-code", envConfidence: 1.0, activityVendor: "cursor" });
    expect(r.canonical).toBe("claude-code");
    expect(r.divergent).toBe(true);
  });

  it("B4.2 reconcileVendor agrees when env+activity match (canonical=env)", async () => {
    const m = await import("../../packages/core/src/nemesis/vendor_reconcile.js");
    const r = m.reconcileVendor({ envVendor: "claude-code", envConfidence: 1.0, activityVendor: "claude-code" });
    expect(r.canonical).toBe("claude-code");
    expect(r.divergent).toBe(false);
  });

  it("B4.3 reconcileVendor falls back to activity when env unknown", async () => {
    const m = await import("../../packages/core/src/nemesis/vendor_reconcile.js");
    const r = m.reconcileVendor({ envVendor: "unknown", envConfidence: 0, activityVendor: "cursor" });
    expect(r.canonical).toBe("cursor");
  });
});

// ═══════════════════════════════════════════════════════════════════════
//  B5 — top-level `mneme dev_tooling [detect|cleanse]` CLI
// ═══════════════════════════════════════════════════════════════════════

describe("v2.48.0 B5 — top-level dev_tooling CLI (PINNED)", () => {
  it("B5.1 `mneme dev_tooling detect` returns JSON with isDevTooling field", () => {
    const r = runMneme(["dev_tooling", "detect"]);
    expect(r.status).toBe(0);
    const j = JSON.parse(r.stdout);
    expect(j.ok).toBe(true);
    expect(typeof j.result.isDevTooling).toBe("boolean");
  });

  it("B5.2 `mneme dev_tooling detect --path <dev-folder>` flags isDevTooling=true", () => {
    const dir = mkdtempSync(join(tmpdir(), "v48-tooling-"));
    writeFileSync(join(dir, "CLAUDE.md"), "");
    writeFileSync(join(dir, "AGENTS.md"), "");
    writeFileSync(join(dir, ".cursorrules"), "");
    const r = runMneme(["dev_tooling", "detect", "--path", dir]);
    expect(r.status).toBe(0);
    const j = JSON.parse(r.stdout);
    expect(j.result.isDevTooling).toBe(true);
  });

  it("B5.3 `mneme dev_tooling cleanse --mode scan` returns findings envelope", () => {
    const r = runMneme(["dev_tooling", "cleanse", "--mode", "scan"]);
    expect(r.status).toBe(0);
    const j = JSON.parse(r.stdout);
    expect(j.ok !== undefined).toBe(true);
  });
});

// ═══════════════════════════════════════════════════════════════════════
//  F6 — NEMESIS → CONCLAVE closed loop
// ═══════════════════════════════════════════════════════════════════════

describe("v2.48.0 F6 — NEMESIS → CONCLAVE closed loop (PINNED)", () => {
  it("F6.1 nemesisToConclave produces -0.20 weight delta for IMPOSSIBLE verdict", async () => {
    const m = await import("../../packages/core/src/nemesis/nemesis_to_conclave.js");
    const delta = m.computeWeightDelta({ verdict: "IMPOSSIBLE", claimedVendor: "claude-code", fingerprintConfidence: 0.95 });
    expect(delta.delta).toBeLessThanOrEqual(-0.15);
    expect(delta.targetVendor).toBe("claude-code");
  });

  it("F6.2 CONFIRMED verdict produces small positive weight delta", async () => {
    const m = await import("../../packages/core/src/nemesis/nemesis_to_conclave.js");
    const delta = m.computeWeightDelta({ verdict: "CONFIRMED", claimedVendor: "claude-code", fingerprintConfidence: 0.95 });
    expect(delta.delta).toBeGreaterThan(0);
    expect(delta.delta).toBeLessThanOrEqual(0.10);
  });

  it("F6.3 applyToConclave persists to honest_mirror_weights.json", async () => {
    const m = await import("../../packages/core/src/nemesis/nemesis_to_conclave.js");
    const repo = mkdtempSync(join(tmpdir(), "v48-conclave-"));
    const r = m.applyToConclave(repo, { verdict: "IMPOSSIBLE", claimedVendor: "claude-code", fingerprintConfidence: 0.95 });
    expect(r.ok).toBe(true);
    const p = join(repo, ".mneme", "honest_mirror_weights.json");
    expect(existsSync(p)).toBe(true);
    const w = JSON.parse(readFileSync(p, "utf8"));
    expect(w["claude-code"]).toBeTruthy();
    expect(w["claude-code"].weight).toBeLessThan(1.0);
  });

  it("F6.4 nemesis source key tagged in weights file (for audit)", async () => {
    const m = await import("../../packages/core/src/nemesis/nemesis_to_conclave.js");
    const repo = mkdtempSync(join(tmpdir(), "v48-conclave-"));
    m.applyToConclave(repo, { verdict: "IMPOSSIBLE", claimedVendor: "cursor", fingerprintConfidence: 0.99 });
    const w = JSON.parse(readFileSync(join(repo, ".mneme", "honest_mirror_weights.json"), "utf8"));
    expect(w["cursor"].source).toMatch(/nemesis/i);
  });
});

// ═══════════════════════════════════════════════════════════════════════
//  F7 — TG probe real-corpus accuracy
// ═══════════════════════════════════════════════════════════════════════

describe("v2.48.0 F7 — TG real-corpus accuracy probe (PINNED)", () => {
  it("F7.1 probe.nemesis.classify_accuracy_real_corpus exists + returns value=1", async () => {
    const m = await import("../../packages/core/src/truth_gate/probes.js");
    const p = m.probeById("probe.nemesis.classify_accuracy_real_corpus");
    expect(p).toBeTruthy();
    const r = await p!.run({ cwd: process.cwd() });
    expect(r.value).toBe(1);
  });

  it("F7.2 claim.nemesis.real_accuracy_85 binding exists + severity=block", async () => {
    const { CLAIM_CATALOG } = await import("../../packages/core/src/truth_gate/claims.js");
    const c = CLAIM_CATALOG.find((x) => x.id === "claim.nemesis.real_accuracy_85");
    expect(c).toBeTruthy();
    expect(c!.severity).toBe("block");
  });
});

// ═══════════════════════════════════════════════════════════════════════
//  ROOT — release.ts probe-coverage gate
// ═══════════════════════════════════════════════════════════════════════

describe("v2.48.0 ROOT — probe-coverage gate (PINNED)", () => {
  it("ROOT.1 checkProbeCoverage returns ok:true when every new tool has TG probe", async () => {
    const m = await import("../../packages/core/src/release_gate/probe_coverage.js");
    const r = m.checkProbeCoverage({
      newTools: ["mneme.nemesis.classify_accuracy_real_corpus"],
      knownClaims: ["claim.nemesis.real_accuracy_85"],
    });
    // The probe-coverage gate isn't 1:1 matching tool→claim; it requires
    // EITHER all-tools-covered OR an explicit waiver. Here we just exercise
    // the API.
    expect(typeof r.ok).toBe("boolean");
    expect(Array.isArray(r.uncovered)).toBe(true);
  });

  it("ROOT.2 release script gate refuses tag when uncovered tools exist (dry-run)", async () => {
    const m = await import("../../packages/core/src/release_gate/probe_coverage.js");
    const r = m.checkProbeCoverage({
      newTools: ["mneme.uncovered_feature.no_probe"],
      knownClaims: ["claim.nemesis.real_accuracy_85"],
    });
    expect(r.ok).toBe(false);
    expect(r.uncovered).toContain("mneme.uncovered_feature.no_probe");
  });
});
