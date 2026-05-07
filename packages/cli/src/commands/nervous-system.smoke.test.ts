/**
 * End-to-end CLI smoke for `nervous-system` and `passport` against Mneme's
 * own repo.  Skipped when `.mneme/mneme.db` is not populated (no index).
 *
 * This is a real-world test: it spawns the built CLI, captures stdout, and
 * asserts the output contains the expected sections.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { spawnSync } from "node:child_process";
import { existsSync, statSync, readFileSync, mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

const REPO = process.cwd().replace(/\\/g, "/");
// Use the bin shim — it kicks off the run() entry point identically to npm.
const CLI = join(REPO, "packages/cli/bin/mneme.js");
const DB = join(REPO, ".mneme/mneme.db");

const hasIndex = existsSync(DB) && existsSync(CLI);

const describeIfIndexed = hasIndex ? describe : describe.skip;

function runCli(args: string[]): { exitCode: number | null; stdout: string; stderr: string } {
  const r = spawnSync(process.execPath, [CLI, ...args], {
    cwd: REPO,
    encoding: "utf8",
    env: { ...process.env, FORCE_COLOR: "0", NO_COLOR: "1" },
    windowsHide: true,
    timeout: 180_000,
  });
  return { exitCode: r.status, stdout: r.stdout || "", stderr: r.stderr || "" };
}

describeIfIndexed("nervous-system + passport — end-to-end smoke", () => {
  let tmp: string;
  beforeEach(() => {
    tmp = mkdtempSync(join(tmpdir(), "mneme-smoke-"));
  });
  afterEach(() => {
    try {
      rmSync(tmp, { recursive: true, force: true });
    } catch {
      /* ignore */
    }
  });

  it("`mneme passport` (no args) auto-picks the top contributor + renders terminal output", () => {
    const r = runCli(["passport"]);
    if (r.exitCode !== 0 || r.stdout.length < 200) {
      // Surface debugging detail if the smoke run failed.
      console.error("DEBUG passport stdout:", JSON.stringify(r.stdout.slice(0, 500)));
      console.error("DEBUG passport stderr:", JSON.stringify(r.stderr.slice(0, 500)));
      console.error("DEBUG passport exitCode:", r.exitCode);
    }
    expect(r.exitCode).toBe(0);
    expect(r.stdout).toMatch(/(?:passport|Passport|PASSPORT|Identity|engineer|fingerprint)/);
    expect(r.stdout.length).toBeGreaterThan(200);
  });

  it("`mneme passport --html PATH` writes a self-contained HTML dossier", () => {
    const html = join(tmp, "passport.html");
    const r = runCli(["passport", "--html", html]);
    expect(r.exitCode).toBe(0);
    expect(existsSync(html)).toBe(true);
    const size = statSync(html).size;
    expect(size).toBeGreaterThan(5_000);
    const head = readFileSync(html, "utf8").slice(0, 200);
    expect(head.toLowerCase()).toMatch(/^<!doctype html>/);
  });

  it("`mneme nervous-system --html PATH` writes a self-contained HTML report", () => {
    const html = join(tmp, "nervous.html");
    const r = runCli(["nervous-system", "--html", html]);
    expect(r.exitCode).toBe(0);
    expect(existsSync(html)).toBe(true);
    expect(statSync(html).size).toBeGreaterThan(5_000);
    const body = readFileSync(html, "utf8");
    expect(body.toLowerCase()).toMatch(/^<!doctype html>/);
    // Required sections.
    expect(body).toMatch(/Cultural alphas/);
    expect(body).toMatch(/Atrophy critical list/);
  });

  it("`mneme nervous-system --pdf PATH` falls back gracefully when puppeteer-core is missing", () => {
    const pdf = join(tmp, "nervous.pdf");
    const r = runCli(["nervous-system", "--pdf", pdf]);
    // Even when puppeteer is missing, the command must not fail.
    expect(r.exitCode).toBe(0);
    // Friendly message about puppeteer-core.
    expect(r.stdout).toMatch(/puppeteer-core|PDF/i);
    // The auto-default HTML should still be written somewhere readable.
    // (mneme stashes it in .mneme/ when --html is not given.)
    // We can't assert the path here without parsing stdout, but we expect
    // the tool to mention writing HTML.
  });

  it("`mneme passport --json` returns valid JSON", () => {
    const r = runCli(["passport", "--json"]);
    expect(r.exitCode).toBe(0);
    // The JSON might not be the only thing in stdout (banner etc), but the
    // first '{' should kick off a parseable object.
    const i = r.stdout.indexOf("{");
    expect(i).toBeGreaterThanOrEqual(0);
    const parsed = JSON.parse(r.stdout.slice(i));
    expect(parsed.identity).toBeDefined();
    expect(typeof parsed.identity.email).toBe("string");
  });

  it("`mneme nervous-system --json` returns valid JSON", () => {
    const r = runCli(["nervous-system", "--json"]);
    expect(r.exitCode).toBe(0);
    const i = r.stdout.indexOf("{");
    expect(i).toBeGreaterThanOrEqual(0);
    const parsed = JSON.parse(r.stdout.slice(i));
    expect(parsed.meta).toBeDefined();
    expect(Array.isArray(parsed.alphas)).toBe(true);
    expect(Array.isArray(parsed.passports)).toBe(true);
  });
});

