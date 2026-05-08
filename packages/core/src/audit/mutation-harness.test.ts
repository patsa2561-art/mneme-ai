/**
 * Mutation harness tests — uses a tiny in-test fixture (a function +
 * a tiny Node test command) instead of mocking the whole filesystem.
 */
import { describe, expect, it, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, writeFileSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runMutationCampaign } from "./mutation-harness.js";

let tmp: string;
beforeEach(() => {
  tmp = mkdtempSync(join(tmpdir(), "mneme-mut-harness-"));
});
afterEach(() => {
  try { rmSync(tmp, { recursive: true, force: true }); } catch {}
});

/** Write a source file + a tiny Node test that exits 0 when the source
 *  is intact and exits 1 when a key value flips. The test uses node -e
 *  so we don't depend on a test framework being installed. */
function writeFixture(srcContent: string, expectedReturn: string): { src: string; testCmd: string[] } {
  const src = join(tmp, "src.js");
  writeFileSync(src, srcContent, "utf8");
  // The test imports src via require + asserts the return matches expected
  const test = join(tmp, "test.js");
  const testCode = `
const path = require("path");
delete require.cache[require.resolve("./src.js")];
const m = require("./src.js");
if (m.value !== ${JSON.stringify(JSON.parse(expectedReturn))}) {
  console.error("FAIL: expected ${expectedReturn}, got " + m.value);
  process.exit(1);
}
process.exit(0);
`;
  writeFileSync(test, testCode, "utf8");
  return { src, testCmd: [process.execPath, "test.js"] };
}

describe("runMutationCampaign — strong tests catch mutants", () => {
  it("kills the boolean-flip mutant when tests assert the boolean value", async () => {
    const { src, testCmd } = writeFixture(
      `module.exports = { value: true };`,
      `true`,
    );
    const result = await runMutationCampaign({
      sourceFile: src,
      testCommand: testCmd,
      cwd: tmp,
      cap: 4,
    });
    // The mutator that flips `true` to `false` should be killed by the test
    expect(result.totalMutants).toBeGreaterThan(0);
    expect(result.killedMutants).toBeGreaterThanOrEqual(1);
    expect(result.mutationScore).toBeGreaterThan(0);
  });

  it("restores the original file after the campaign", async () => {
    const original = `module.exports = { value: true };`;
    const { src, testCmd } = writeFixture(original, `true`);
    await runMutationCampaign({ sourceFile: src, testCommand: testCmd, cwd: tmp, cap: 2 });
    expect(readFileSync(src, "utf8")).toBe(original);
  });
});

describe("runMutationCampaign — weak tests don't catch mutants", () => {
  it("low mutation score when tests don't actually assert the value", async () => {
    // src always exports something; test just checks the export EXISTS,
    // so most mutants survive
    const src = join(tmp, "src.js");
    writeFileSync(src, `module.exports = { count: 42, ok: true };`, "utf8");
    const test = join(tmp, "test.js");
    writeFileSync(
      test,
      `delete require.cache[require.resolve("./src.js")];
       const m = require("./src.js");
       if (typeof m !== "object") process.exit(1);
       process.exit(0);`,
      "utf8",
    );
    const result = await runMutationCampaign({
      sourceFile: src,
      testCommand: [process.execPath, "test.js"],
      cwd: tmp,
      cap: 6,
    });
    // Because the test only checks the shape, most mutants survive
    expect(result.mutationScore).toBeLessThan(0.6);
  });
});

describe("runMutationCampaign — empty + edge cases", () => {
  it("returns empty result when no applicable mutants found", async () => {
    const src = join(tmp, "src.js");
    writeFileSync(src, `// just a comment\n// another comment\n`, "utf8");
    const result = await runMutationCampaign({
      sourceFile: src,
      testCommand: [process.execPath, "-e", "process.exit(0)"],
      cwd: tmp,
      cap: 4,
    });
    expect(result.totalMutants).toBe(0);
    expect(result.killedMutants).toBe(0);
    expect(result.mutationScore).toBe(0);
  });

  it("captures error gracefully when the test runner itself crashes", async () => {
    const src = join(tmp, "src.js");
    writeFileSync(src, `module.exports = { v: 1 };`, "utf8");
    const result = await runMutationCampaign({
      sourceFile: src,
      // Non-existent binary — spawn errors
      testCommand: ["nonexistent-binary-xyz-9999"],
      cwd: tmp,
      cap: 2,
    });
    // The harness records error rather than throwing
    expect(result.totalMutants).toBeGreaterThan(0);
    expect(result.results.every((r) => !r.killed)).toBe(true);
    expect(result.results[0]!.error).toBeTruthy();
  });

  it("respects the timeoutMs option", async () => {
    const src = join(tmp, "src.js");
    writeFileSync(src, `module.exports = { v: 1 };`, "utf8");
    // node -e that sleeps forever
    const result = await runMutationCampaign({
      sourceFile: src,
      testCommand: [process.execPath, "-e", "setInterval(()=>{}, 1000)"],
      cwd: tmp,
      cap: 2,
      timeoutMs: 500,
    });
    // Each mutant should time out → exitCode null → not killed
    for (const r of result.results) {
      expect(r.exitCode).toBeNull();
      expect(r.outputTail).toContain("timed out");
    }
  }, 15_000);
});
