import { describe, expect, it, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";

import { computePatchRisk, summarizeRisk } from "./risk.js";

let repo: string;

beforeEach(() => {
  repo = mkdtempSync(join(tmpdir(), "mneme-risk-"));
  spawnSync("git", ["init", "-q"], { cwd: repo });
  spawnSync("git", ["config", "user.email", "test@test"], { cwd: repo });
  spawnSync("git", ["config", "user.name", "test"], { cwd: repo });
});
afterEach(() => { try { rmSync(repo, { recursive: true, force: true }); } catch { /* */ } });

function commit(repoRoot: string, msg: string): void {
  spawnSync("git", ["add", "."], { cwd: repoRoot });
  spawnSync("git", ["commit", "-q", "-m", msg], { cwd: repoRoot });
}

function writeFile(repoRoot: string, relPath: string, body: string): void {
  const full = join(repoRoot, relPath);
  mkdirSync(join(full, ".."), { recursive: true });
  writeFileSync(full, body, "utf8");
}

describe("computePatchRisk", () => {
  it("returns sane defaults on a freshly-created small file", () => {
    writeFile(repo, "src/tiny.ts", "export const x = 1;\n");
    commit(repo, "init");
    const r = computePatchRisk(repo, "src/tiny.ts");
    expect(r.loc).toBe(2); // "export const x = 1;\n" -> 2 split lines
    expect(r.fanIn).toBe(0);
    expect(r.testDensity).toBe(0);
    expect(r.churn30d).toBe(1);
    expect(r.fileAgeDays).not.toBeNull();
    expect(r.riskScore).toBeGreaterThanOrEqual(0);
    expect(r.riskScore).toBeLessThanOrEqual(1);
    expect(r.safetyScore).toBeCloseTo(1 - r.riskScore, 5);
  });

  it("a LARGE file scores HIGHER risk than a SMALL file (entropy demo)", () => {
    const tinyBody = "export const x = 1;\n";
    const bigBody = Array(800).fill("export const z = 0;").join("\n") + "\n";
    writeFile(repo, "src/tiny.ts", tinyBody);
    writeFile(repo, "src/big.ts", bigBody);
    commit(repo, "init");
    const tiny = computePatchRisk(repo, "src/tiny.ts");
    const big = computePatchRisk(repo, "src/big.ts");
    expect(big.loc).toBeGreaterThan(tiny.loc);
    expect(big.riskScore).toBeGreaterThan(tiny.riskScore);
  });

  it("a file with HIGH churn scores HIGHER risk than a stable file", () => {
    writeFile(repo, "src/stable.ts", "export const a = 1;\n");
    commit(repo, "init stable");
    writeFile(repo, "src/churned.ts", "export const b = 1;\n");
    commit(repo, "init churned");
    for (let i = 2; i <= 7; i++) {
      writeFile(repo, "src/churned.ts", `export const b = ${i};\n`);
      commit(repo, `bump ${i}`);
    }
    const stable = computePatchRisk(repo, "src/stable.ts");
    const churned = computePatchRisk(repo, "src/churned.ts");
    expect(churned.churn30d).toBeGreaterThan(stable.churn30d!);
    expect(churned.riskScore).toBeGreaterThan(stable.riskScore);
  });

  it("a file with HIGH fan-in scores HIGHER risk than an isolated file", () => {
    // foo.ts is imported by 4 callers; isolated.ts is imported by none.
    writeFile(repo, "src/foo.ts", "export const foo = 1;\n");
    writeFile(repo, "src/isolated.ts", "export const x = 1;\n");
    for (let i = 1; i <= 4; i++) {
      writeFile(repo, `src/caller${i}.ts`, `import { foo } from "./foo.js"; void foo;\n`);
    }
    commit(repo, "init");
    const foo = computePatchRisk(repo, "src/foo.ts");
    const isolated = computePatchRisk(repo, "src/isolated.ts");
    expect(foo.fanIn).toBeGreaterThan(isolated.fanIn);
    expect(foo.riskScore).toBeGreaterThan(isolated.riskScore);
  });

  it("co-located test density is counted (it() calls in <name>.test.ts)", () => {
    writeFile(repo, "src/x.ts", "export const x = 1;\n");
    writeFile(repo, "src/x.test.ts", `import { it } from "vitest";\nit("a", ()=>{});\nit("b", ()=>{});\nit("c", ()=>{});\n`);
    commit(repo, "init");
    const r = computePatchRisk(repo, "src/x.ts");
    expect(r.testDensity).toBe(3);
  });

  it("HIGHER test density yields LOWER risk on otherwise-identical files", () => {
    writeFile(repo, "src/no-test.ts", "export const x = 1;\n");
    writeFile(repo, "src/well-tested.ts", "export const y = 1;\n");
    writeFile(repo, "src/well-tested.test.ts",
      `import { it } from "vitest";\n` + Array(20).fill('it("t", ()=>{});').join("\n") + "\n");
    commit(repo, "init");
    const noTest = computePatchRisk(repo, "src/no-test.ts");
    const wellTested = computePatchRisk(repo, "src/well-tested.ts");
    expect(wellTested.testDensity).toBeGreaterThan(noTest.testDensity);
    expect(wellTested.riskScore).toBeLessThan(noTest.riskScore);
  });

  it("summarizeRisk renders a one-line human summary", () => {
    writeFile(repo, "src/y.ts", "x");
    commit(repo, "init");
    const r = computePatchRisk(repo, "src/y.ts");
    const s = summarizeRisk(r);
    expect(s).toMatch(/^risk=\d+%/);
    expect(s).toMatch(/loc=\d+/);
    expect(s).toMatch(/fan-in=\d+/);
  });

  it("score is bounded in [0, 1]", () => {
    // Pathological: empty file, no git, no test.
    writeFile(repo, "src/empty.ts", "");
    commit(repo, "init");
    const r = computePatchRisk(repo, "src/empty.ts");
    expect(r.riskScore).toBeGreaterThanOrEqual(0);
    expect(r.riskScore).toBeLessThanOrEqual(1);
  });
});
