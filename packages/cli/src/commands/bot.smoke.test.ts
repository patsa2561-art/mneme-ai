/**
 * Live capture: print the actual `mneme bot --dry-run` stdout so we have
 * a known-good sample.  This file is named *.smoke.test.ts so it is
 * easy to skip in fast unit runs but still exercised in the smoke pass.
 */
import { describe, it, expect } from "vitest";
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { join } from "node:path";

const REPO = process.cwd().replace(/\\/g, "/");
const CLI = join(REPO, "packages/cli/bin/mneme.js");
const distExists = existsSync(join(REPO, "packages/cli/dist/commands/bot.js"));
const describeIfBuilt = distExists ? describe : describe.skip;

describeIfBuilt("mneme bot — sample capture", () => {
  it("captures a representative `mneme bot --dry-run --include audit` output", () => {
    const r = spawnSync(process.execPath, [CLI, "bot", "--dry-run", "--include", "audit"], {
      cwd: REPO,
      encoding: "utf8",
      env: { ...process.env, FORCE_COLOR: "0", NO_COLOR: "1" },
      windowsHide: true,
      timeout: 120_000,
    });
    expect(r.status).toBe(0);
    expect(r.stdout).toMatch(/Mneme audit|Verdict:/);
    expect(r.stdout).toMatch(/dry-run/i);
  });
});
