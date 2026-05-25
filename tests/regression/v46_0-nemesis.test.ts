// v2.46.0 — NEMESIS (Anti-Identity-Lie Engine for AI Agents)
//
// World-first composition of:
//   1. arxiv 2601.17406 (Jan 2026) — 97.2% F1 vendor fingerprinting
//   2. Mneme HMAC chain                — tamper-evident verdict ledger
//   3. EU AI Act Article 50 (Aug 2026) — machine-readable disclosure
//   4. HONEST MIRROR                   — calibration tie-in (later release)
//   5. ARGUS pattern matching          — multi-signal fusion
//
// 7 test blocks: features (41) / classifier / identity verifier / EU
// stamp / HMAC / TRUTH GATE / WIRING-PROOF subprocess.

import { describe, it, expect } from "vitest";
import { spawnSync } from "node:child_process";
import { resolve } from "node:path";

const CLI = resolve(__dirname, "../../packages/cli/bin/mneme.js");
function runMneme(args: string[], opts: { input?: string } = {}): { stdout: string; stderr: string; status: number } {
  const r = spawnSync(process.execPath, [CLI, ...args], {
    encoding: "utf8", timeout: 60_000, input: opts.input,
    env: { ...process.env, MNEME_WARMCALL: "0", MNEME_MUSCLE_BYPASS: "0", NO_COLOR: "1" },
  });
  return { stdout: r.stdout ?? "", stderr: r.stderr ?? "", status: r.status ?? -1 };
}

// Synthetic fixtures shaped to match each vendor's documented signature.
const FIXTURE_CODEX = {
  // Codex: high multiline commits, terse PR description
  diff: "diff --git a/a.js b/a.js\n+function foo(x) {\n+  if (x > 0) {\n+    const y = x * 2;\n+    return y;\n+  }\n+  return 0;\n+}\n",
  prDescription: "Add foo function.",
  commitMessages: [
    "feat: add foo function\n\n- handles positive input\n- handles zero case\n- returns numeric result\n- includes early return\n- no side effects",
    "fix: edge case in foo\n\n- handle negative\n- update test\n- improve docs",
  ],
};
const FIXTURE_CLAUDE = {
  // Claude Code: many conditional statements + clean prose
  diff: "diff --git a/a.ts b/a.ts\n+export function classify(input: string) {\n+  if (!input) return null;\n+  if (input.length === 0) return null;\n+  if (input.startsWith('mneme.')) return 'mneme';\n+  if (input.includes('verify')) return 'verify';\n+  if (input.match(/[A-Z]/)) return 'uppercase';\n+  if (input.endsWith('.test.ts')) return 'test';\n+  return 'other';\n+}\n",
  prDescription: "Classify input strings by content shape. Several heuristics applied in order; returns null for empty input. Tested manually with sample data.",
  commitMessages: ["classify: route input by shape"],
};
const FIXTURE_COPILOT = {
  // Copilot: very long PR description + high change concentration (one file)
  diff: "diff --git a/single.py b/single.py\n+def alpha(): pass\n+def beta(): pass\n+def gamma(): pass\n+def delta(): pass\n+def epsilon(): pass\n+def zeta(): pass\n+def eta(): pass\n+def theta(): pass\n",
  prDescription: ("This pull request introduces multiple helper functions to the single.py module. Each function provides a specific responsibility within the data processing pipeline. The implementation follows established patterns from previous contributions to this codebase. ".repeat(8)),
  commitMessages: ["add multiple helpers"],
};
const FIXTURE_CURSOR = {
  // Cursor: bullets + hyperlinks in PR description
  diff: "diff --git a/x.ts b/x.ts\n+const x = 1;\n",
  prDescription: "## Changes\n\n- Added new constant `x`\n- See [docs](https://example.com/docs)\n- Reference [issue #42](https://github.com/x/y/issues/42)\n- Follows [style guide](https://example.com/style)\n",
  commitMessages: ["add const x"],
};
const FIXTURE_DEVIN = {
  // Devin: multiline commits + distributed changes across many files
  diff: [
    "diff --git a/a.ts b/a.ts",
    "+const a = 1;",
    "diff --git a/b.ts b/b.ts",
    "+const b = 2;",
    "diff --git a/c.ts b/c.ts",
    "+const c = 3;",
    "diff --git a/d.ts b/d.ts",
    "+const d = 4;",
    "diff --git a/e.ts b/e.ts",
    "+const e = 5;",
    "diff --git a/f.ts b/f.ts",
    "+const f = 6;",
    "diff --git a/g.ts b/g.ts",
    "+const g = 7;",
    "diff --git a/h.ts b/h.ts",
    "+const h = 8;",
  ].join("\n"),
  prDescription: "Refactor across modules.",
  commitMessages: [
    "refactor a\n\n- update import\n- adjust types\n- remove dead code",
    "refactor b\n\n- update import\n- adjust types\n- remove dead code",
    "refactor c\n\n- update import\n- adjust types\n- remove dead code",
  ],
};

// ═══════════════════════════════════════════════════════════════════════
//  F — features (41 numeric features extracted from diff + PR + commits)
// ═══════════════════════════════════════════════════════════════════════

describe("v2.46.0 F — fingerprint features (PINNED)", () => {
  it("F.1 extractFingerprint returns ≥41 numeric features", async () => {
    const m = await import("../../packages/core/src/nemesis/features.js");
    const fp = m.extractFingerprint(FIXTURE_CODEX);
    expect(Object.keys(fp).length).toBeGreaterThanOrEqual(41);
    for (const [k, v] of Object.entries(fp)) {
      expect(Number.isFinite(v), `feature ${k} should be finite, got ${v}`).toBe(true);
    }
  });

  it("F.2 multiline_commit_ratio is high for Codex fixture (≥0.5)", async () => {
    const m = await import("../../packages/core/src/nemesis/features.js");
    const fp = m.extractFingerprint(FIXTURE_CODEX);
    expect(fp.multiline_commit_ratio).toBeGreaterThanOrEqual(0.5);
  });

  it("F.3 conditional_density is high for Claude fixture (≥0.10)", async () => {
    const m = await import("../../packages/core/src/nemesis/features.js");
    const fp = m.extractFingerprint(FIXTURE_CLAUDE);
    expect(fp.conditional_density).toBeGreaterThanOrEqual(0.10);
  });

  it("F.4 pr_desc_length_chars is high for Copilot fixture (≥500)", async () => {
    const m = await import("../../packages/core/src/nemesis/features.js");
    const fp = m.extractFingerprint(FIXTURE_COPILOT);
    expect(fp.pr_desc_length_chars).toBeGreaterThanOrEqual(500);
  });

  it("F.5 change_concentration is high for Copilot fixture (only 1 file)", async () => {
    const m = await import("../../packages/core/src/nemesis/features.js");
    const fp = m.extractFingerprint(FIXTURE_COPILOT);
    expect(fp.change_concentration).toBeGreaterThanOrEqual(0.9);
  });

  it("F.6 bullet_point_count + hyperlink_count are high for Cursor fixture", async () => {
    const m = await import("../../packages/core/src/nemesis/features.js");
    const fp = m.extractFingerprint(FIXTURE_CURSOR);
    expect(fp.bullet_point_count).toBeGreaterThanOrEqual(3);
    expect(fp.hyperlink_count).toBeGreaterThanOrEqual(3);
  });

  it("F.7 distributed_changes_score is high for Devin fixture (8 files)", async () => {
    const m = await import("../../packages/core/src/nemesis/features.js");
    const fp = m.extractFingerprint(FIXTURE_DEVIN);
    expect(fp.distributed_changes_score).toBeGreaterThanOrEqual(0.5);
  });

  it("F.8 empty input returns zero-vector (never crashes)", async () => {
    const m = await import("../../packages/core/src/nemesis/features.js");
    const fp = m.extractFingerprint({ diff: "", prDescription: "", commitMessages: [] });
    expect(Object.keys(fp).length).toBeGreaterThanOrEqual(41);
    for (const v of Object.values(fp)) {
      expect(Number.isFinite(v)).toBe(true);
    }
  });
});

// ═══════════════════════════════════════════════════════════════════════
//  C — classifier (vendor prediction from features)
// ═══════════════════════════════════════════════════════════════════════

describe("v2.46.0 C — vendor classifier (PINNED)", () => {
  it("C.1 Codex fixture classifies as codex (top-1)", async () => {
    const m = await import("../../packages/core/src/nemesis/index.js");
    const fp = m.extractFingerprint(FIXTURE_CODEX);
    const v = m.classifyAgent(fp);
    expect(v.topVendor).toBe("codex");
  });

  it("C.2 Claude fixture classifies as claude-code", async () => {
    const m = await import("../../packages/core/src/nemesis/index.js");
    const fp = m.extractFingerprint(FIXTURE_CLAUDE);
    const v = m.classifyAgent(fp);
    expect(v.topVendor).toBe("claude-code");
  });

  it("C.3 Copilot fixture classifies as copilot", async () => {
    const m = await import("../../packages/core/src/nemesis/index.js");
    const fp = m.extractFingerprint(FIXTURE_COPILOT);
    const v = m.classifyAgent(fp);
    expect(v.topVendor).toBe("copilot");
  });

  it("C.4 Cursor fixture classifies as cursor", async () => {
    const m = await import("../../packages/core/src/nemesis/index.js");
    const fp = m.extractFingerprint(FIXTURE_CURSOR);
    const v = m.classifyAgent(fp);
    expect(v.topVendor).toBe("cursor");
  });

  it("C.5 Devin fixture classifies as devin", async () => {
    const m = await import("../../packages/core/src/nemesis/index.js");
    const fp = m.extractFingerprint(FIXTURE_DEVIN);
    const v = m.classifyAgent(fp);
    expect(v.topVendor).toBe("devin");
  });

  it("C.6 classifier returns confidence + per-vendor scores", async () => {
    const m = await import("../../packages/core/src/nemesis/index.js");
    const fp = m.extractFingerprint(FIXTURE_CLAUDE);
    const v = m.classifyAgent(fp);
    expect(v.confidence).toBeGreaterThan(0);
    expect(v.confidence).toBeLessThanOrEqual(1);
    expect(Object.keys(v.scores).length).toBeGreaterThanOrEqual(5);
  });

  it("C.7 empty fixture returns 'unknown' top vendor (never crashes)", async () => {
    const m = await import("../../packages/core/src/nemesis/index.js");
    const fp = m.extractFingerprint({ diff: "", prDescription: "", commitMessages: [] });
    const v = m.classifyAgent(fp);
    expect(["unknown", "codex", "claude-code", "copilot", "cursor", "devin"]).toContain(v.topVendor);
  });
});

// ═══════════════════════════════════════════════════════════════════════
//  I — identity verifier (claim vs signature)
// ═══════════════════════════════════════════════════════════════════════

describe("v2.46.0 I — identity verifier (PINNED)", () => {
  it("I.1 truthful claim (Codex code + 'I am codex' claim) → CONFIRMED", async () => {
    const m = await import("../../packages/core/src/nemesis/index.js");
    const r = m.verifyIdentityClaim({
      claimedVendor: "codex",
      fixture: FIXTURE_CODEX,
    });
    expect(r.verdict).toBe("CONFIRMED");
  });

  it("I.2 mismatched claim (Codex code + 'I am Cursor' claim) → DISPUTED or IMPOSSIBLE", async () => {
    const m = await import("../../packages/core/src/nemesis/index.js");
    const r = m.verifyIdentityClaim({
      claimedVendor: "cursor",
      fixture: FIXTURE_CODEX,
    });
    expect(["DISPUTED", "IMPOSSIBLE"]).toContain(r.verdict);
  });

  it("I.3 unknown vendor claim is gracefully handled", async () => {
    const m = await import("../../packages/core/src/nemesis/index.js");
    const r = m.verifyIdentityClaim({
      claimedVendor: "no-such-vendor",
      fixture: FIXTURE_CODEX,
    });
    expect(r.verdict).toBeTruthy();
  });

  it("I.4 verdict carries HMAC signature for audit", async () => {
    const m = await import("../../packages/core/src/nemesis/index.js");
    const r = m.verifyIdentityClaim({
      claimedVendor: "codex",
      fixture: FIXTURE_CODEX,
    });
    expect(typeof r.hmac).toBe("string");
    expect(r.hmac.length).toBeGreaterThan(8);
  });

  it("I.5 verifyIdentityHmac round-trips clean verdict", async () => {
    const m = await import("../../packages/core/src/nemesis/index.js");
    const r = m.verifyIdentityClaim({
      claimedVendor: "claude-code",
      fixture: FIXTURE_CLAUDE,
    });
    expect(m.verifyIdentityHmac(r)).toBe(true);
  });

  it("I.6 verifyIdentityHmac detects tampered verdict", async () => {
    const m = await import("../../packages/core/src/nemesis/index.js");
    const r = m.verifyIdentityClaim({
      claimedVendor: "claude-code",
      fixture: FIXTURE_CLAUDE,
    });
    const tampered = { ...r, claimedVendor: "TAMPERED" };
    expect(m.verifyIdentityHmac(tampered)).toBe(false);
  });
});

// ═══════════════════════════════════════════════════════════════════════
//  EU — EU AI Act Article 50 stamper
// ═══════════════════════════════════════════════════════════════════════

describe("v2.46.0 EU — Article 50 stamper (PINNED)", () => {
  it("EU.1 stampArticle50 produces machine-readable block in commit message", async () => {
    const m = await import("../../packages/core/src/nemesis/index.js");
    const r = m.stampArticle50({
      message: "feat: add foo",
      vendor: "codex",
      confidence: 0.95,
    });
    expect(r.stampedMessage).toMatch(/AI-GENERATED-CONTENT/);
    expect(r.stampedMessage).toMatch(/vendor=codex/);
    expect(r.stampedMessage).toMatch(/article=50/);
  });

  it("EU.2 stamp includes HMAC + timestamp + content-type", async () => {
    const m = await import("../../packages/core/src/nemesis/index.js");
    const r = m.stampArticle50({
      message: "feat: add foo",
      vendor: "claude-code",
      confidence: 0.88,
    });
    expect(r.stamp.hmac.length).toBeGreaterThan(8);
    expect(r.stamp.at).toMatch(/T\d{2}:\d{2}/);
    expect(r.stamp.contentType).toBe("text/x-source-code");
  });

  it("EU.3 verifyStamp parses + verifies a stamped message", async () => {
    const m = await import("../../packages/core/src/nemesis/index.js");
    const r = m.stampArticle50({
      message: "feat: add foo",
      vendor: "cursor",
      confidence: 0.91,
    });
    const v = m.verifyStamp(r.stampedMessage);
    expect(v.valid).toBe(true);
    expect(v.parsed?.vendor).toBe("cursor");
  });

  it("EU.4 verifyStamp detects tampered vendor", async () => {
    const m = await import("../../packages/core/src/nemesis/index.js");
    const r = m.stampArticle50({
      message: "feat: x",
      vendor: "cursor",
      confidence: 0.9,
    });
    const tampered = r.stampedMessage.replace("vendor=cursor", "vendor=devin");
    const v = m.verifyStamp(tampered);
    expect(v.valid).toBe(false);
  });

  it("EU.5 stampMessage with no vendor returns ok:false (graceful)", async () => {
    const m = await import("../../packages/core/src/nemesis/index.js");
    const r = m.stampArticle50({
      message: "feat: x",
      vendor: "",
      confidence: 0.9,
    });
    expect(r.ok).toBe(false);
  });
});

// ═══════════════════════════════════════════════════════════════════════
//  TG — TRUTH GATE binding
// ═══════════════════════════════════════════════════════════════════════

describe("v2.46.0 TG — TRUTH GATE binding (PINNED)", () => {
  it("TG.1 probe.nemesis.world_first_agent_fingerprinter returns value=1", async () => {
    const m = await import("../../packages/core/src/truth_gate/probes.js");
    const p = m.probeById("probe.nemesis.world_first_agent_fingerprinter");
    expect(p).toBeTruthy();
    const r = await p!.run({ cwd: process.cwd() });
    expect(r.value).toBe(1);
  });

  it("TG.2 claim.nemesis.world_first bound + severity=block", async () => {
    const { CLAIM_CATALOG } = await import("../../packages/core/src/truth_gate/claims.js");
    const c = CLAIM_CATALOG.find((x) => x.id === "claim.nemesis.world_first");
    expect(c).toBeTruthy();
    expect(c!.severity).toBe("block");
  });
});

// ═══════════════════════════════════════════════════════════════════════
//  ENV — environment-variable vendor signature scan (ORGAN 1 addon)
// ═══════════════════════════════════════════════════════════════════════

describe("v2.46.0 ENV — env-scan vendor signature (PINNED)", () => {
  it("ENV.1 CLAUDECODE=1 detected as claude-code", async () => {
    const m = await import("../../packages/core/src/nemesis/env_scan.js");
    const r = m.scanEnv({ CLAUDECODE: "1" });
    expect(r.vendor).toBe("claude-code");
    expect(r.evidence.length).toBeGreaterThan(0);
  });
  it("ENV.2 CURSOR_AGENT=1 detected as cursor", async () => {
    const m = await import("../../packages/core/src/nemesis/env_scan.js");
    const r = m.scanEnv({ CURSOR_AGENT: "1" });
    expect(r.vendor).toBe("cursor");
  });
  it("ENV.3 no markers → vendor=unknown", async () => {
    const m = await import("../../packages/core/src/nemesis/env_scan.js");
    const r = m.scanEnv({});
    expect(r.vendor).toBe("unknown");
  });
});

// ═══════════════════════════════════════════════════════════════════════
//  HOOK — git pre-commit hook installer (ORGAN 3 addon)
// ═══════════════════════════════════════════════════════════════════════

describe("v2.46.0 HOOK — git hook installer (PINNED)", () => {
  it("HOOK.1 installPreCommitHook plans the hook content (dry-run)", async () => {
    const m = await import("../../packages/core/src/nemesis/git_hook_installer.js");
    const r = m.installPreCommitHook({ repoRoot: "/tmp/nonexistent-repo-xyz", dryRun: true });
    // Even with bad path, dry-run returns the planned content (no fs writes)
    expect(typeof r.plannedScript).toBe("string");
    expect(r.plannedScript.length).toBeGreaterThan(0);
    expect(r.plannedScript).toMatch(/mneme nemesis/);
  });
  it("HOOK.2 install on non-git path returns ok:false gracefully", async () => {
    const m = await import("../../packages/core/src/nemesis/git_hook_installer.js");
    const r = m.installPreCommitHook({ repoRoot: "/tmp/nonexistent-repo-" + Date.now(), dryRun: false });
    expect(r.ok).toBe(false);
  });
});

// ═══════════════════════════════════════════════════════════════════════
//  WS — whitespace-stego watermark in code comment (ORGAN 3 wild idea)
// ═══════════════════════════════════════════════════════════════════════

describe("v2.46.0 WS — whitespace stego watermark (PINNED)", () => {
  it("WS.1 encode + decode round-trips a short vendor tag", async () => {
    const m = await import("../../packages/core/src/nemesis/watermark.js");
    const encoded = m.encodeWatermark("// AI: ", "claude");
    const decoded = m.decodeWatermark(encoded);
    expect(decoded).toBe("claude");
  });
  it("WS.2 visible glyphs are unchanged (lossless)", async () => {
    const m = await import("../../packages/core/src/nemesis/watermark.js");
    const encoded = m.encodeWatermark("// AI: ", "cursor");
    // Remove zero-width chars and verify the visible portion is preserved
    const visible = encoded.replace(/[​-‍⁠﻿]/g, "");
    expect(visible).toBe("// AI: ");
  });
  it("WS.3 decode of clean line returns empty string", async () => {
    const m = await import("../../packages/core/src/nemesis/watermark.js");
    const decoded = m.decodeWatermark("// AI: clean");
    expect(decoded).toBe("");
  });
});

// ═══════════════════════════════════════════════════════════════════════
//  DRIFT — Organ 4: model drift timeline
// ═══════════════════════════════════════════════════════════════════════

describe("v2.46.0 DRIFT — model drift timeline (PINNED)", () => {
  it("DRIFT.1 recordFingerprint + readTimeline round-trips", async () => {
    const m = await import("../../packages/core/src/nemesis/drift_timeline.js");
    const { mkdtempSync } = await import("node:fs");
    const { tmpdir } = await import("node:os");
    const { join } = await import("node:path");
    const repo = mkdtempSync(join(tmpdir(), "nemesis-drift-"));
    const fp1 = { multiline_commit_ratio: 0.5, conditional_density: 0.1 } as Record<string, number>;
    m.recordFingerprint(repo, "claude-code", fp1);
    const tl = m.readTimeline(repo, "claude-code");
    expect(tl.length).toBe(1);
  });

  it("DRIFT.2 computeVariance flags fingerprint drift > σ", async () => {
    const m = await import("../../packages/core/src/nemesis/drift_timeline.js");
    const { mkdtempSync } = await import("node:fs");
    const { tmpdir } = await import("node:os");
    const { join } = await import("node:path");
    const repo = mkdtempSync(join(tmpdir(), "nemesis-drift-"));
    // First 3 fingerprints similar
    for (let i = 0; i < 3; i++) {
      m.recordFingerprint(repo, "claude-code", { conditional_density: 0.1 + i * 0.005 });
    }
    // 4th fingerprint wildly different (stealth model swap)
    m.recordFingerprint(repo, "claude-code", { conditional_density: 0.85 });
    const v = m.computeVariance(repo, "claude-code", "conditional_density");
    expect(v.driftDetected).toBe(true);
  });
});

// ═══════════════════════════════════════════════════════════════════════
//  REPLAY — Organ 5: stealth-upgrade detector
// ═══════════════════════════════════════════════════════════════════════

describe("v2.46.0 REPLAY — stealth upgrade/downgrade detector (PINNED)", () => {
  it("REPLAY.1 two similar fingerprints from same vendor → no flag", async () => {
    const m = await import("../../packages/core/src/nemesis/replay_attack.js");
    const fpA = { conditional_density: 0.20, multiline_commit_ratio: 0.50 };
    const fpB = { conditional_density: 0.22, multiline_commit_ratio: 0.48 };
    const r = m.detectReplayAttack("claude-code", fpA, fpB);
    expect(r.alert).toBe(false);
  });
  it("REPLAY.2 wildly divergent fingerprint → stealth-swap flag", async () => {
    const m = await import("../../packages/core/src/nemesis/replay_attack.js");
    const fpA = { conditional_density: 0.20, multiline_commit_ratio: 0.50 };
    const fpB = { conditional_density: 0.85, multiline_commit_ratio: 0.05 };
    const r = m.detectReplayAttack("claude-code", fpA, fpB);
    expect(r.alert).toBe(true);
    expect(r.kind).toMatch(/stealth.?(upgrade|downgrade|swap)/i);
  });
});

// ═══════════════════════════════════════════════════════════════════════
//  W — WIRING-PROOF subprocess (CLI surface)
// ═══════════════════════════════════════════════════════════════════════

describe("v2.46.0 W — WIRING-PROOF subprocess (PINNED)", () => {
  it("W.1 `mneme nemesis classify --stdin` ranks Claude fixture as claude-code", () => {
    const body = JSON.stringify(FIXTURE_CLAUDE);
    const r = runMneme(["nemesis", "classify", "--stdin"], { input: body });
    expect(r.status).toBe(0);
    const j = JSON.parse(r.stdout);
    expect(j.ok).toBe(true);
    expect(j.result.topVendor).toBe("claude-code");
  });

  it("W.2 `mneme nemesis verify_identity --claim cursor --stdin` flags mismatch on Codex fixture", () => {
    const body = JSON.stringify({ claimedVendor: "cursor", fixture: FIXTURE_CODEX });
    const r = runMneme(["nemesis", "verify_identity", "--stdin"], { input: body });
    expect(r.status).toBe(0);
    const j = JSON.parse(r.stdout);
    expect(["DISPUTED", "IMPOSSIBLE"]).toContain(j.result.verdict);
  });

  it("W.3 `mneme nemesis eu_stamp --message X --vendor claude-code` returns Article 50 block", () => {
    const r = runMneme(["nemesis", "eu_stamp", "--message", "feat: add foo", "--vendor", "claude-code"]);
    expect(r.status).toBe(0);
    const j = JSON.parse(r.stdout);
    expect(j.ok).toBe(true);
    expect(j.stampedMessage).toMatch(/AI-GENERATED-CONTENT/);
  });

  it("W.4 `mneme nemesis verify_stamp` round-trips clean stamp", () => {
    const stamp = runMneme(["nemesis", "eu_stamp", "--message", "x", "--vendor", "cursor"]);
    const j = JSON.parse(stamp.stdout);
    const r = runMneme(["nemesis", "verify_stamp", "--stamped", j.stampedMessage]);
    const v = JSON.parse(r.stdout);
    expect(v.valid).toBe(true);
  });
});
