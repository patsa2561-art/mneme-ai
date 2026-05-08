/**
 * git-install v1.9.0 — pre-push baseline-existence guard.
 *
 * Covers the v1.9.0 fix where pre-push used to fail when no baseline
 * existed; now it skips with a friendly message.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, readFileSync, existsSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execSync } from "node:child_process";
import { gitInstallCommand } from "./git-install.js";

let tmp: string;

beforeEach(() => {
  tmp = mkdtempSync(join(tmpdir(), "mneme-git-install-v190-"));
  execSync("git init -q", { cwd: tmp });
  execSync("git config user.email t@x", { cwd: tmp });
  execSync("git config user.name T", { cwd: tmp });
});

afterEach(() => {
  try { rmSync(tmp, { recursive: true, force: true }); } catch {}
});

describe("git-install v1.9.0 — pre-push baseline guard", () => {
  it("pre-push hook checks for .mneme/audit-baseline.json before running certify", async () => {
    await gitInstallCommand({ cwd: tmp, hooks: ["pre-push"], json: true });
    const hook = readFileSync(join(tmp, ".git", "hooks", "pre-push"), "utf8");
    expect(hook).toContain(".mneme/audit-baseline.json");
    expect(hook).toContain("No audit baseline yet");
    expect(hook).toContain("mneme audit --baseline");
  });

  it("pre-push hook still calls audit certify if baseline exists", async () => {
    await gitInstallCommand({ cwd: tmp, hooks: ["pre-push"], json: true });
    const hook = readFileSync(join(tmp, ".git", "hooks", "pre-push"), "utf8");
    // Both branches present — the no-baseline branch and the certify branch
    expect(hook).toContain("mneme audit --certify");
  });

  it("hook still respects MNEME_AUDIT_DISABLE", async () => {
    await gitInstallCommand({ cwd: tmp, hooks: ["pre-push"], json: true });
    const hook = readFileSync(join(tmp, ".git", "hooks", "pre-push"), "utf8");
    expect(hook).toContain("MNEME_AUDIT_DISABLE");
  });
});
