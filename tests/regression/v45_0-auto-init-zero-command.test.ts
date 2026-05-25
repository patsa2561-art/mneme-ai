// v2.45.0 — AUTO-INIT + RETROACTIVE CLEANSE + DEV-TOOLING DETECTOR
//
// Closes the 3 caveats from user's audit screenshot:
//   1. user shouldn't have to run `mneme init` — AUTO-INIT on every MCP
//      tool call (idempotent, silent, <50ms when already done)
//   2. files committed BEFORE Mneme install stay in history — RETROACTIVE
//      CLEANSE MCP tool with DRY-RUN default + safe uncommit OR opt-in
//      filter-repo
//   3. user's own AI-dev tooling folder isn't a customer repo — DEV-TOOLING
//      DETECTOR: skip AUTO-INIT when CWD looks like a dev scratch dir
//
// Plus TRUTH GATE binding so the "zero-command install" marketing claim
// self-verifies on every release.

import { describe, it, expect } from "vitest";
import { execSync } from "node:child_process";
import { mkdtempSync, writeFileSync, readFileSync, existsSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

function mkFreshRepo(): string {
  const dir = mkdtempSync(join(tmpdir(), "v45-"));
  try { execSync("git init --quiet", { cwd: dir, stdio: "ignore" }); } catch { /* offline */ }
  // Stub user identity so commits work in CI.
  try {
    execSync('git config user.email "t@t.io"', { cwd: dir, stdio: "ignore" });
    execSync('git config user.name "test"', { cwd: dir, stdio: "ignore" });
  } catch { /* */ }
  writeFileSync(join(dir, "package.json"), JSON.stringify({ name: "t", version: "1.0.0" }));
  try {
    execSync("git add package.json && git commit --quiet --no-gpg-sign -m init", { cwd: dir, stdio: "ignore" });
  } catch { /* */ }
  return dir;
}

function mkDevToolingFolder(): string {
  // Mimic user's D:\typecrypt\ — no .git, multiple AI fingerprint files.
  const dir = mkdtempSync(join(tmpdir(), "v45-tooling-"));
  writeFileSync(join(dir, "CLAUDE.md"), "# my AI tooling");
  writeFileSync(join(dir, "AGENTS.md"), "# agents");
  writeFileSync(join(dir, ".cursorrules"), "# cursor");
  writeFileSync(join(dir, ".windsurfrules"), "# windsurf");
  mkdirSync(join(dir, ".mneme"), { recursive: true });
  return dir;
}

// ═══════════════════════════════════════════════════════════════════════
//  C1 — AUTO-INIT idempotent bootstrap
// ═══════════════════════════════════════════════════════════════════════

describe("v2.45.0 C1 — AUTO-INIT (PINNED)", () => {
  it("C1.1 autoInit creates .mneme/ + appends .gitignore on fresh repo", async () => {
    const repo = mkFreshRepo();
    const m = await import("../../packages/core/src/auto_init/index.js");
    const r = m.autoInit(repo);
    expect(r.ok).toBe(true);
    expect(r.created).toContain(".mneme/");
    expect(existsSync(join(repo, ".mneme"))).toBe(true);
    const gi = readFileSync(join(repo, ".gitignore"), "utf8");
    expect(gi).toMatch(/CLAUDE\.md/);
    expect(gi).toMatch(/\.mneme\//);
  });

  it("C1.2 autoInit is IDEMPOTENT — second call returns alreadyInit", async () => {
    const repo = mkFreshRepo();
    const m = await import("../../packages/core/src/auto_init/index.js");
    m.autoInit(repo); // first
    const r2 = m.autoInit(repo); // second
    expect(r2.ok).toBe(true);
    expect(r2.alreadyInit).toBe(true);
  });

  it("C1.3 autoInit runs in <100ms on idempotent path", async () => {
    const repo = mkFreshRepo();
    const m = await import("../../packages/core/src/auto_init/index.js");
    m.autoInit(repo);
    const t0 = Date.now();
    m.autoInit(repo);
    expect(Date.now() - t0).toBeLessThan(100);
  });

  it("C1.4 autoInit NEVER throws (returns ok:false on error, no exception)", async () => {
    const m = await import("../../packages/core/src/auto_init/index.js");
    // Pass a path that doesn't exist
    const r = m.autoInit("/nonexistent/path/12345/" + Date.now());
    expect(r.ok).toBe(false);
    expect(typeof r.reason).toBe("string");
  });

  it("C1.5 autoInit doesn't duplicate .gitignore entries on re-run", async () => {
    const repo = mkFreshRepo();
    const m = await import("../../packages/core/src/auto_init/index.js");
    m.autoInit(repo);
    m.autoInit(repo);
    m.autoInit(repo);
    const gi = readFileSync(join(repo, ".gitignore"), "utf8");
    const claudeCount = (gi.match(/CLAUDE\.md/g) ?? []).length;
    expect(claudeCount).toBe(1);
  });
});

// ═══════════════════════════════════════════════════════════════════════
//  C2 — RETROACTIVE CLEANSE
// ═══════════════════════════════════════════════════════════════════════

describe("v2.45.0 C2 — RETROACTIVE CLEANSE (PINNED)", () => {
  it("C2.1 scan mode lists AI-fingerprint files in git history", async () => {
    const repo = mkFreshRepo();
    // commit a CLAUDE.md BEFORE Mneme is installed
    writeFileSync(join(repo, "CLAUDE.md"), "# pre-Mneme tooling");
    try { execSync("git add CLAUDE.md && git commit --quiet --no-gpg-sign -m claude", { cwd: repo, stdio: "ignore" }); } catch { /* */ }
    const m = await import("../../packages/core/src/auto_init/retroactive_cleanse.js");
    const r = m.cleanse({ repoRoot: repo, mode: "scan" });
    expect(r.ok).toBe(true);
    expect(r.findings.length).toBeGreaterThan(0);
    expect(r.findings.some((f) => f.path === "CLAUDE.md")).toBe(true);
  });

  it("C2.2 uncommit mode runs git rm --cached + keeps file on disk", async () => {
    const repo = mkFreshRepo();
    writeFileSync(join(repo, ".cursorrules"), "# cursor rules");
    try { execSync("git add .cursorrules && git commit --quiet --no-gpg-sign -m cursor", { cwd: repo, stdio: "ignore" }); } catch { /* */ }
    const m = await import("../../packages/core/src/auto_init/retroactive_cleanse.js");
    const r = m.cleanse({ repoRoot: repo, mode: "uncommit", dryRun: false });
    expect(r.ok).toBe(true);
    expect(r.actions.length).toBeGreaterThan(0);
    // File still on disk (uncommit only stops tracking)
    expect(existsSync(join(repo, ".cursorrules"))).toBe(true);
  });

  it("C2.3 dryRun default returns plan without executing", async () => {
    const repo = mkFreshRepo();
    writeFileSync(join(repo, "AGENTS.md"), "# agents");
    try { execSync("git add AGENTS.md && git commit --quiet --no-gpg-sign -m agents", { cwd: repo, stdio: "ignore" }); } catch { /* */ }
    const m = await import("../../packages/core/src/auto_init/retroactive_cleanse.js");
    const r = m.cleanse({ repoRoot: repo, mode: "uncommit" }); // dryRun defaults TRUE
    expect(r.ok).toBe(true);
    expect(r.dryRun).toBe(true);
    expect(r.plan.length).toBeGreaterThan(0);
  });

  it("C2.4 filter-repo mode requires explicit confirm flag (safety)", async () => {
    const repo = mkFreshRepo();
    const m = await import("../../packages/core/src/auto_init/retroactive_cleanse.js");
    const r = m.cleanse({ repoRoot: repo, mode: "filter-repo" }); // no confirm
    expect(r.ok).toBe(false);
    expect(r.reason).toMatch(/confirm|destructive|filter-repo/i);
  });

  it("C2.5 cleanse emits HMAC-signed receipt for audit trail", async () => {
    const repo = mkFreshRepo();
    writeFileSync(join(repo, "CLAUDE.md"), "x");
    try { execSync("git add CLAUDE.md && git commit --quiet --no-gpg-sign -m c", { cwd: repo, stdio: "ignore" }); } catch { /* */ }
    const m = await import("../../packages/core/src/auto_init/retroactive_cleanse.js");
    const r = m.cleanse({ repoRoot: repo, mode: "uncommit", dryRun: false });
    expect(r.ok).toBe(true);
    expect(typeof r.hmac).toBe("string");
    expect(r.hmac!.length).toBeGreaterThan(8);
  });
});

// ═══════════════════════════════════════════════════════════════════════
//  C3 — DEV-TOOLING DETECTOR
// ═══════════════════════════════════════════════════════════════════════

describe("v2.45.0 C3 — DEV-TOOLING DETECTOR (PINNED)", () => {
  it("C3.1 detects AI-dev scratch folder (no .git + multiple AI fingerprints)", async () => {
    const dir = mkDevToolingFolder();
    const m = await import("../../packages/core/src/auto_init/dev_tooling_detector.js");
    const r = m.detectDevTooling(dir);
    expect(r.isDevTooling).toBe(true);
    expect(r.fingerprints.length).toBeGreaterThanOrEqual(3);
  });

  it("C3.2 customer git repo with single AI file is NOT flagged as tooling", async () => {
    const repo = mkFreshRepo();
    writeFileSync(join(repo, "CLAUDE.md"), "# customer's own claude file");
    const m = await import("../../packages/core/src/auto_init/dev_tooling_detector.js");
    const r = m.detectDevTooling(repo);
    expect(r.isDevTooling).toBe(false);
  });

  it("C3.3 autoInit becomes no-op when called on dev-tooling folder", async () => {
    const dir = mkDevToolingFolder();
    const m = await import("../../packages/core/src/auto_init/index.js");
    const r = m.autoInit(dir);
    expect(r.ok).toBe(true);
    expect(r.skippedReason).toMatch(/dev.*tooling|scratch|not.*git/i);
  });
});

// ═══════════════════════════════════════════════════════════════════════
//  C4 — TRUTH GATE marketing-verify probe
// ═══════════════════════════════════════════════════════════════════════

describe("v2.45.0 C4 — TRUTH GATE binding (PINNED)", () => {
  it("C4.1 probe.auto_init.zero_command_install_works returns value=1", async () => {
    const m = await import("../../packages/core/src/truth_gate/probes.js");
    const p = m.probeById("probe.auto_init.zero_command_install_works");
    expect(p).toBeTruthy();
    const r = await p!.run({ cwd: process.cwd() });
    expect(r.value).toBe(1);
  });

  it("C4.2 claim.auto_init.zero_command bound + severity=block", async () => {
    const { CLAIM_CATALOG } = await import("../../packages/core/src/truth_gate/claims.js");
    const c = CLAIM_CATALOG.find((x) => x.id === "claim.auto_init.zero_command");
    expect(c).toBeTruthy();
    expect(c!.severity).toBe("block");
  });
});
