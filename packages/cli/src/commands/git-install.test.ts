/**
 * git-install — unit tests.
 *
 * Goal: 100% confidence in correctness across:
 *   - happy path (fresh repo, no existing hooks)
 *   - idempotency (re-running refreshes Mneme hooks)
 *   - non-overwrite of user-customized hooks (safety property)
 *   - --dry-run reports without writing
 *   - --no-hooks skips hooks entirely
 *   - --hooks <subset> installs only the named ones
 *   - non-git-repo error path
 *   - hook templates contain the expected commands
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, existsSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execSync } from "node:child_process";
import { gitInstallCommand } from "./git-install.js";

let tmp: string;
let originalCwd: string;

beforeEach(() => {
  originalCwd = process.cwd();
  tmp = mkdtempSync(join(tmpdir(), "mneme-git-install-"));
  // Initialise a real git repo — git-install resolves the actual hooks dir
  // by reading .git, so we need git on the path during test execution.
  execSync("git init -q", { cwd: tmp });
  execSync("git config user.email ci@mneme.dev", { cwd: tmp });
  execSync("git config user.name Mneme", { cwd: tmp });
});

afterEach(() => {
  process.chdir(originalCwd);
  try {
    rmSync(tmp, { recursive: true, force: true });
  } catch {}
});

describe("git-install — happy path", () => {
  it("installs all 4 hooks by default", async () => {
    const code = await gitInstallCommand({ cwd: tmp, json: true });
    expect(code).toBe(0);
    for (const h of ["pre-commit", "post-commit", "pre-push", "post-merge"]) {
      const hookPath = join(tmp, ".git", "hooks", h);
      expect(existsSync(hookPath), `hook ${h} should exist`).toBe(true);
      const content = readFileSync(hookPath, "utf8");
      expect(content).toContain("Mneme");
      expect(content).toContain("mneme"); // calls the CLI
    }
  });

  it("makes hooks executable on POSIX", async () => {
    if (process.platform === "win32") return; // file mode is irrelevant on Windows
    await gitInstallCommand({ cwd: tmp, json: true });
    const { statSync } = await import("node:fs");
    const stat = statSync(join(tmp, ".git", "hooks", "pre-commit"));
    // mode & 0o111 should be non-zero (any execute bit set)
    expect(stat.mode & 0o111).not.toBe(0);
  });
});

describe("git-install — idempotency + safety", () => {
  it("refreshes existing Mneme hooks on re-run (idempotent)", async () => {
    await gitInstallCommand({ cwd: tmp, json: true });
    // tamper the hook a bit
    const hookPath = join(tmp, ".git", "hooks", "pre-commit");
    writeFileSync(hookPath, "#!/usr/bin/env bash\n# Mneme pre-commit hook\necho stale\n");
    const code = await gitInstallCommand({ cwd: tmp, json: true });
    expect(code).toBe(0);
    const refreshed = readFileSync(hookPath, "utf8");
    expect(refreshed).not.toContain("echo stale");
    expect(refreshed).toContain("mneme guard");
  });

  it("does NOT overwrite a user-customized non-Mneme hook", async () => {
    const hooksDir = join(tmp, ".git", "hooks");
    mkdirSync(hooksDir, { recursive: true });
    const userHook = join(hooksDir, "pre-commit");
    writeFileSync(userHook, "#!/usr/bin/env bash\n# user's own logic\necho 'do not touch me'\n");
    await gitInstallCommand({ cwd: tmp, json: true });
    const after = readFileSync(userHook, "utf8");
    expect(after).toContain("do not touch me");
    expect(after).not.toContain("Mneme pre-commit hook");
  });
});

describe("git-install — flags", () => {
  it("--no-hooks skips hook installation", async () => {
    await gitInstallCommand({ cwd: tmp, noHooks: true, json: true });
    expect(existsSync(join(tmp, ".git", "hooks", "pre-commit"))).toBe(false);
    expect(existsSync(join(tmp, ".git", "hooks", "pre-push"))).toBe(false);
  });

  it("--hooks <subset> installs only the named ones", async () => {
    await gitInstallCommand({
      cwd: tmp,
      hooks: ["pre-push"],
      json: true,
    });
    expect(existsSync(join(tmp, ".git", "hooks", "pre-push"))).toBe(true);
    expect(existsSync(join(tmp, ".git", "hooks", "pre-commit"))).toBe(false);
    expect(existsSync(join(tmp, ".git", "hooks", "post-commit"))).toBe(false);
  });

  it("--dry-run does NOT write", async () => {
    await gitInstallCommand({ cwd: tmp, dryRun: true, json: true });
    expect(existsSync(join(tmp, ".git", "hooks", "pre-commit"))).toBe(false);
    expect(existsSync(join(tmp, ".git", "hooks", "pre-push"))).toBe(false);
  });
});

describe("git-install — error paths", () => {
  it("returns 1 when not in a git repo", async () => {
    const nonGit = mkdtempSync(join(tmpdir(), "mneme-non-git-"));
    try {
      const code = await gitInstallCommand({ cwd: nonGit, json: true });
      expect(code).toBe(1);
    } finally {
      rmSync(nonGit, { recursive: true, force: true });
    }
  });
});

describe("git-install — hook content correctness", () => {
  it("pre-commit calls `mneme guard --pre-commit`", async () => {
    await gitInstallCommand({ cwd: tmp, json: true });
    const content = readFileSync(join(tmp, ".git", "hooks", "pre-commit"), "utf8");
    expect(content).toContain("mneme guard --pre-commit");
    expect(content).toContain("--no-verify"); // documented bypass
  });

  it("pre-push calls `mneme audit --certify` and respects MNEME_AUDIT_DISABLE", async () => {
    await gitInstallCommand({ cwd: tmp, json: true });
    const content = readFileSync(join(tmp, ".git", "hooks", "pre-push"), "utf8");
    expect(content).toContain("mneme audit --certify");
    expect(content).toContain("MNEME_AUDIT_DISABLE");
    expect(content).toContain("MNEME_AUDIT_STRICT");
  });

  it("post-commit calls `mneme heal --last 1`", async () => {
    await gitInstallCommand({ cwd: tmp, json: true });
    const content = readFileSync(join(tmp, ".git", "hooks", "post-commit"), "utf8");
    expect(content).toContain("mneme heal --last 1");
    expect(content).toContain("|| true"); // never blocks
  });

  it("post-merge calls `mneme briefing` and never blocks", async () => {
    await gitInstallCommand({ cwd: tmp, json: true });
    const content = readFileSync(join(tmp, ".git", "hooks", "post-merge"), "utf8");
    expect(content).toContain("mneme briefing");
    expect(content).toContain("|| true");
  });

  it("every hook starts with #!/usr/bin/env bash", async () => {
    await gitInstallCommand({ cwd: tmp, json: true });
    for (const h of ["pre-commit", "post-commit", "pre-push", "post-merge"]) {
      const content = readFileSync(join(tmp, ".git", "hooks", h), "utf8");
      expect(content.startsWith("#!/usr/bin/env bash")).toBe(true);
    }
  });
});

describe("git-install — JSON output shape", () => {
  it("JSON mode emits structured outcomes array", async () => {
    // Capture stdout
    const chunks: string[] = [];
    const origWrite = process.stdout.write.bind(process.stdout);
    process.stdout.write = ((s: string | Uint8Array) => {
      chunks.push(typeof s === "string" ? s : Buffer.from(s).toString());
      return true;
    }) as typeof process.stdout.write;
    try {
      await gitInstallCommand({ cwd: tmp, json: true });
    } finally {
      process.stdout.write = origWrite;
    }
    const json = JSON.parse(chunks.join(""));
    expect(Array.isArray(json.outcomes)).toBe(true);
    expect(json.outcomes.length).toBeGreaterThan(0);
    for (const o of json.outcomes) {
      expect(typeof o.step).toBe("string");
      expect(["INSTALLED", "ALREADY", "SKIPPED", "ERROR"]).toContain(o.status);
      expect(typeof o.detail).toBe("string");
    }
  });
});
