/**
 * v2.19.69 — REGRESSION TEST for MNEME_LITE postinstall pruner
 *            (Gap 3 workaround #2 — npm 10 global --omit=optional bug).
 *
 *   The pruner script lives at bin/postinstall-mneme-lite.cjs and runs
 *   under npm's `postinstall` lifecycle when the user sets MNEME_LITE=1
 *   in their environment before `npm install -g mneme-ai`.
 *
 *   This test pins the four invariants the pruner must guarantee
 *   forever (otherwise the documented "lite install" path silently
 *   stops freeing disk space):
 *
 *     1. No env var → no-op (default install UX untouched, no logs)
 *     2. MNEME_LITE=1 + targets exist → prune removes them + logs summary
 *     3. MNEME_LITE=1 + targets ABSENT → no-op, exit 0, no failure
 *     4. Pruner NEVER exits non-zero (must never abort the install)
 *
 *   Each invariant builds a tmp `node_modules/` sandbox + runs the
 *   pruner script against it via spawnSync, so the test is fully
 *   hermetic — it never touches the real global install.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, resolve, join } from "node:path";
import { mkdirSync, writeFileSync, existsSync, rmSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";

const here = dirname(fileURLToPath(import.meta.url));
const prunerPath = resolve(here, "..", "bin", "postinstall-mneme-lite.cjs");

/** Build a tmp `node_modules/` tree that mimics the global-install layout
 *  the pruner expects: `<sandbox>/bin/` is the cwd it's invoked from, and
 *  `<sandbox>/node_modules/<target>/` is what it tries to delete. */
function buildSandbox(targets: string[]): { sandbox: string; binDir: string } {
  const sandbox = mkdtempSync(join(tmpdir(), "mneme-lite-test-"));
  const binDir = join(sandbox, "bin");
  mkdirSync(binDir, { recursive: true });
  for (const t of targets) {
    const target = join(sandbox, "node_modules", t);
    mkdirSync(target, { recursive: true });
    // Add a small file so the dir has non-zero size in the prune log.
    writeFileSync(join(target, "README.md"), `# ${t}\n`);
  }
  return { sandbox, binDir };
}

function copyPruner(binDir: string): string {
  // Copy the actual production pruner into the sandbox's bin dir so its
  // __dirname-based path resolution matches the real layout.
  const dst = join(binDir, "postinstall-mneme-lite.cjs");
  const { copyFileSync } = require("node:fs");
  copyFileSync(prunerPath, dst);
  return dst;
}

interface PrunerResult {
  exitCode: number;
  stdout: string;
  stderr: string;
}

function runPruner(binDir: string, env: Record<string, string> = {}): PrunerResult {
  const r = spawnSync(process.execPath, [join(binDir, "postinstall-mneme-lite.cjs")], {
    encoding: "utf8",
    timeout: 20_000,
    windowsHide: true,
    // v2.19.71: postinstall now does TWO jobs (lite-prune + dual-install
    // detection).  These tests exercise JOB 1 only; pass through
    // MNEME_SKIP_DUAL_CHECK=1 so the second job is silent + doesn't
    // pollute the real ~/.mneme-global with marker files during tests.
    env: { ...process.env, MNEME_SKIP_DUAL_CHECK: "1", ...env },
  });
  return {
    exitCode: r.status ?? -1,
    stdout: r.stdout ?? "",
    stderr: r.stderr ?? "",
  };
}

describe("postinstall-mneme-lite — MNEME_LITE=1 pruner", () => {
  let sandboxDir: string | null = null;

  afterEach(() => {
    if (sandboxDir && existsSync(sandboxDir)) {
      try { rmSync(sandboxDir, { recursive: true, force: true }); } catch { /* */ }
    }
    sandboxDir = null;
  });

  it("default install (no env var) is a silent no-op — preserves the 99% UX", () => {
    const { sandbox, binDir } = buildSandbox(["@huggingface", "@img", "sharp"]);
    sandboxDir = sandbox;
    copyPruner(binDir);
    // No MNEME_LITE — explicit '' to override any inherited env.
    const r = runPruner(binDir, { MNEME_LITE: "" });
    expect(r.exitCode, `stderr: ${r.stderr}`).toBe(0);
    expect(r.stdout).toBe("");
    expect(r.stderr).toBe("");
    // Targets MUST still exist — we did not opt into pruning.
    for (const t of ["@huggingface", "@img", "sharp"]) {
      expect(existsSync(join(sandbox, "node_modules", t)), `${t} should NOT have been pruned`).toBe(true);
    }
  });

  it("MNEME_LITE=1 prunes the known optional-dep targets + logs a summary", () => {
    const { sandbox, binDir } = buildSandbox(["@huggingface", "@img", "sharp", "onnxruntime-node"]);
    sandboxDir = sandbox;
    copyPruner(binDir);
    const r = runPruner(binDir, { MNEME_LITE: "1" });
    expect(r.exitCode, `stderr: ${r.stderr}`).toBe(0);
    // Summary line MUST mention the lite mode + at least one pruned target.
    expect(r.stdout).toMatch(/\[mneme-lite\] MNEME_LITE=1/);
    expect(r.stdout).toMatch(/pruned \d+\/\d+ optional-dep directories/);
    expect(r.stdout).toMatch(/@huggingface/);
    expect(r.stdout).toMatch(/@img/);
    expect(r.stdout).toMatch(/sharp/);
    // Targets MUST be gone.
    for (const t of ["@huggingface", "@img", "sharp", "onnxruntime-node"]) {
      expect(existsSync(join(sandbox, "node_modules", t)), `${t} should have been pruned`).toBe(false);
    }
  });

  it("MNEME_LITE=1 + targets absent → no-op, exit 0 (idempotent)", () => {
    // Empty sandbox — none of the prune targets exist.
    const { sandbox, binDir } = buildSandbox([]);
    sandboxDir = sandbox;
    copyPruner(binDir);
    const r = runPruner(binDir, { MNEME_LITE: "1" });
    expect(r.exitCode).toBe(0);
    expect(r.stdout).toMatch(/pruned 0\/\d+ optional-dep directories/);
    // Skipped list should include the names we never created.
    expect(r.stdout).toMatch(/skipped:.*@huggingface/);
  });

  it("alternative truthy values (`true`, `yes`) are honoured for the lite mode", () => {
    for (const value of ["true", "TRUE", "yes", "YES"]) {
      const { sandbox, binDir } = buildSandbox(["@img"]);
      sandboxDir = sandbox;
      copyPruner(binDir);
      const r = runPruner(binDir, { MNEME_LITE: value });
      expect(r.exitCode, `value=${value} stderr: ${r.stderr}`).toBe(0);
      expect(r.stdout, `value=${value} should trigger prune`).toMatch(/MNEME_LITE=/);
      expect(existsSync(join(sandbox, "node_modules", "@img")), `value=${value} should prune @img`).toBe(false);
      // Clean up between iterations.
      try { rmSync(sandbox, { recursive: true, force: true }); } catch { /* */ }
      sandboxDir = null;
    }
  });

  it("never aborts the install — exit code is ALWAYS 0, even on partial failure", () => {
    // We can't easily simulate "rm failed for one dir" cross-platform in
    // a hermetic test, but we CAN verify the contract on the happy path
    // + the empty path + an arbitrarily-set env var.  Combined they cover
    // every observable code path; the "never throws" branch is a master
    // try/catch in the script — pinned by reading the script source.
    const { sandbox, binDir } = buildSandbox(["@huggingface"]);
    sandboxDir = sandbox;
    copyPruner(binDir);
    // Garbage env var value — should fall back to no-op (exit 0).
    const r = runPruner(binDir, { MNEME_LITE: "garbage" });
    expect(r.exitCode).toBe(0);
    // Garbage was NOT a truthy value, so target stays untouched.
    expect(existsSync(join(sandbox, "node_modules", "@huggingface"))).toBe(true);
  });

  it("CI environments (CI=true) silence JOB 2 dual-install check", () => {
    // Just verify it doesn't crash + still exit 0 with CI flag set.
    const { sandbox, binDir } = buildSandbox([]);
    sandboxDir = sandbox;
    copyPruner(binDir);
    // Note: we drop the default MNEME_SKIP_DUAL_CHECK so JOB 2 would
    // normally fire — but CI=true should silence it independently.
    const r = spawnSync(process.execPath, [join(binDir, "postinstall-mneme-lite.cjs")], {
      encoding: "utf8",
      timeout: 20_000,
      windowsHide: true,
      env: { ...process.env, CI: "true", MNEME_LITE: "" },
    });
    expect(r.status ?? -1).toBe(0);
    expect(r.stdout, "CI=true should suppress dual-install warning").not.toMatch(/dual-install detected/);
  });

  it("read the pruner source — `process.exit(0)` is the only exit path (master invariant)", () => {
    // The "never abort install" guarantee is implemented as a single
    // exit-with-0 at end-of-script + no `throw` outside the master
    // try/catch.  Pin both invariants by static-reading the source.
    const { readFileSync } = require("node:fs");
    const src = readFileSync(prunerPath, "utf8");
    // No raw `throw` statements that escape the script body.
    const throws = src.match(/^\s*throw /gm) || [];
    expect(throws.length, `pruner must never throw — found: ${throws.join(" | ")}`).toBe(0);
    // Every `process.exit(N)` MUST be exit 0.
    const exits = src.match(/process\.exit\(\s*(-?\d+)\s*\)/g) || [];
    expect(exits.length, "pruner should call process.exit at least once").toBeGreaterThan(0);
    for (const ex of exits) {
      expect(ex, "every process.exit MUST be 0 (never abort the install)").toMatch(/process\.exit\(\s*0\s*\)/);
    }
  });
});
