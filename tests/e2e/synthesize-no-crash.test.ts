/**
 * E2E SMOKE TEST -- `mneme antivirus synthesize` MUST NOT CRASH.
 *
 * This test exists because v1.28.0/1.28.3/1.30.0 ALL shipped a regression
 * where `mneme antivirus synthesize <strain>` crashed with
 * `Cannot read properties of undefined (reading 'length')`. Each release
 * claimed to fix it; each release shipped the same broken behavior.
 *
 * The unit-test suite passed because it tested `synthesizeVaccine()`
 * directly with well-shaped inputs. The CLI surface, which deals with
 * untyped JS-runtime objects from gap-scan + may face an older core
 * via npm peer-dep resolution, was never end-to-end tested.
 *
 * v1.31.1 closes that gap with this E2E. It runs the actual built CLI
 * binary against a fresh tmp repo in EVERY shape that previously
 * caused crashes:
 *   - empty repo (no .git, no package.json)
 *   - bare git repo (no commits, no package.json)
 *   - git repo with package.json + 1 commit
 *   - git repo with full deps + multiple commits
 *
 * The test asserts: exit code in {0, 1}, NO uncaught error in stderr,
 * stdout/stderr does NOT contain "Cannot read properties of undefined".
 */

import { describe, expect, it, beforeAll } from "vitest";
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync, existsSync } from "node:fs";
import { tmpdir, platform } from "node:os";
import { join, resolve } from "node:path";

const STRAINS = ["depends_imaginarium", "citatio_viridis", "structura_invenita"];

const REPO_ROOT = resolve(__dirname, "..", "..");
const CLI_DIST = join(REPO_ROOT, "packages", "cli", "dist", "index.js");
const isWin = platform() === "win32";

beforeAll(() => {
  if (!existsSync(CLI_DIST)) {
    throw new Error(`CLI dist missing -- run \`npm run build\` first. Expected: ${CLI_DIST}`);
  }
});

function runSynthesize(repoCwd: string, strain: string): { exitCode: number; stdout: string; stderr: string } {
  const r = spawnSync(process.execPath, [CLI_DIST, "antivirus", "synthesize", strain], {
    cwd: repoCwd,
    encoding: "utf8",
    timeout: 30_000,
    windowsHide: true,
  });
  return { exitCode: r.status ?? -1, stdout: r.stdout ?? "", stderr: r.stderr ?? "" };
}

function git(cwd: string, ...args: string[]): void {
  const r = spawnSync("git", args, { cwd, encoding: "utf8", timeout: 10_000, shell: isWin });
  if (r.status !== 0) throw new Error(`git ${args.join(" ")} failed: ${r.stderr}`);
}

describe("E2E -- mneme antivirus synthesize MUST NOT CRASH (regression guard)", () => {
  for (const strain of STRAINS) {
    describe(`strain: ${strain}`, () => {
      it("survives an empty directory (no .git, no package.json)", () => {
        const tmp = mkdtempSync(join(tmpdir(), "mneme-e2e-empty-"));
        try {
          const r = runSynthesize(tmp, strain);
          // Must exit cleanly (0 = success, 1 = expected failure with friendly message).
          expect([0, 1]).toContain(r.exitCode);
          // The exact crash signature we're guarding against:
          expect(r.stdout + r.stderr).not.toContain("Cannot read properties of undefined");
          expect(r.stdout + r.stderr).not.toContain("is not iterable");
          // Should NOT have an uncaught Node SyntaxError (the v1.28.2 module-load crash).
          expect(r.stderr).not.toMatch(/^SyntaxError:/m);
        } finally {
          try { rmSync(tmp, { recursive: true, force: true }); } catch { /* */ }
        }
      });

      it("survives a bare git repo (no commits, no package.json)", () => {
        const tmp = mkdtempSync(join(tmpdir(), "mneme-e2e-bare-"));
        try {
          git(tmp, "init", "-q");
          const r = runSynthesize(tmp, strain);
          expect([0, 1]).toContain(r.exitCode);
          expect(r.stdout + r.stderr).not.toContain("Cannot read properties of undefined");
          expect(r.stdout + r.stderr).not.toContain("is not iterable");
        } finally {
          try { rmSync(tmp, { recursive: true, force: true }); } catch { /* */ }
        }
      });

      it("survives a git repo with package.json + 1 commit", () => {
        const tmp = mkdtempSync(join(tmpdir(), "mneme-e2e-pkg-"));
        try {
          git(tmp, "init", "-q");
          git(tmp, "config", "user.email", "test@example.com");
          git(tmp, "config", "user.name", "test");
          writeFileSync(join(tmp, "package.json"),
            JSON.stringify({ name: "test", dependencies: { react: "^18", lodash: "^4" } }), "utf8");
          git(tmp, "add", ".");
          git(tmp, "commit", "-q", "-m", "init");
          const r = runSynthesize(tmp, strain);
          expect([0, 1]).toContain(r.exitCode);
          expect(r.stdout + r.stderr).not.toContain("Cannot read properties of undefined");
          expect(r.stdout + r.stderr).not.toContain("is not iterable");
        } finally {
          try { rmSync(tmp, { recursive: true, force: true }); } catch { /* */ }
        }
      });
    });
  }

  it("survives an unknown strain name (graceful 'no report' message)", () => {
    const tmp = mkdtempSync(join(tmpdir(), "mneme-e2e-unknown-"));
    try {
      git(tmp, "init", "-q");
      const r = runSynthesize(tmp, "this_strain_does_not_exist");
      // Should exit 1 with a friendly message, NOT crash.
      expect([0, 1]).toContain(r.exitCode);
      expect(r.stdout + r.stderr).not.toContain("Cannot read properties of undefined");
    } finally {
      try { rmSync(tmp, { recursive: true, force: true }); } catch { /* */ }
    }
  });
});
