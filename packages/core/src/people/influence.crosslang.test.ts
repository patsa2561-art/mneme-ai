/**
 * Cross-language smoke test for `mneme influence`.
 *
 * Builds a tiny git repo with one Python file + one Go file (and one TS
 * file as a control), commits them, runs buildInfluenceReport, and checks
 * that shapes from all three languages were observed.
 *
 * Requires `git` on PATH. If not available, the test exits early.
 */
import { describe, it, expect } from "vitest";
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { execSync } from "node:child_process";
import { buildInfluenceReport } from "./influence.js";

function gitOk(): boolean {
  try {
    execSync("git --version", { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

function makeRepo(): string {
  const dir = mkdtempSync(join(tmpdir(), "mneme-influence-xlang-"));
  execSync("git init -q -b main", { cwd: dir });
  execSync('git config user.email "alice@x.io"', { cwd: dir });
  execSync('git config user.name "Alice"', { cwd: dir });
  // Python file
  mkdirSync(join(dir, "py"), { recursive: true });
  writeFileSync(
    join(dir, "py", "util.py"),
    "def parse_amount(s):\n    return int(s)\n\nclass Cache:\n    def get(self, k):\n        return None\n",
  );
  // Go file
  mkdirSync(join(dir, "go"), { recursive: true });
  writeFileSync(
    join(dir, "go", "util.go"),
    "package util\n\nfunc ParseAmount(s string) int { return 0 }\n\nfunc (c *Cache) Get(k string) string { return \"\" }\n",
  );
  // TS control
  mkdirSync(join(dir, "ts"), { recursive: true });
  writeFileSync(
    join(dir, "ts", "util.ts"),
    "export function parseAmount(s: string): number { return 0; }\nexport class Cache { get(k: string) { return null; } }\n",
  );
  execSync("git add .", { cwd: dir });
  execSync('git -c commit.gpgsign=false commit -q -m "init"', { cwd: dir });
  return dir;
}

describe("buildInfluenceReport — cross-language shape detection", () => {
  if (!gitOk()) {
    it.skip("requires git", () => {});
    return;
  }

  it("language mix includes python AND go AND a ts-like flavor", async () => {
    const dir = makeRepo();
    try {
      const report = await buildInfluenceReport({ cwd: dir, patternMinUses: 1 });
      const mix = report.languageMix;
      expect(mix.python ?? 0).toBeGreaterThan(0);
      expect(mix.go ?? 0).toBeGreaterThan(0);
      // TS-side may be reported as "typescript" or similar — we just want > 0.
      const tsLike =
        (mix.typescript ?? 0) +
        (mix.tsx ?? 0) +
        (mix.javascript ?? 0) +
        (mix.jsx ?? 0);
      expect(tsLike).toBeGreaterThan(0);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("headsUp message reflects multi-language coverage (no longer 'TS/JS only')", async () => {
    const dir = makeRepo();
    try {
      const report = await buildInfluenceReport({ cwd: dir, patternMinUses: 1 });
      // Either undefined (only supported langs present), or the new
      // multi-language message — never the old "TS/JS only" wording.
      if (report.headsUp) {
        expect(report.headsUp).not.toMatch(/TS\/JS only/);
        expect(report.headsUp).toMatch(/TypeScript \/ JavaScript \/ Python \/ Go/);
      }
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
}, 30000);
