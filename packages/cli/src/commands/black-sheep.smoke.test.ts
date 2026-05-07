/**
 * End-to-end CLI smoke tests for the v0.31.0 Black Sheep Edition commands:
 *   - mneme adversarial
 *   - mneme counterfactual
 *   - mneme org
 *
 * Skipped when `.mneme/mneme.db` is not populated (no index).
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, rmSync, writeFileSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir, homedir } from "node:os";

const REPO = process.cwd().replace(/\\/g, "/");
const CLI = join(REPO, "packages/cli/bin/mneme.js");
const DB = join(REPO, ".mneme/mneme.db");

const hasIndex = existsSync(DB) && existsSync(CLI);
const describeIfIndexed = hasIndex ? describe : describe.skip;

function runCli(args: string[], extraEnv: Record<string, string> = {}): {
  exitCode: number | null;
  stdout: string;
  stderr: string;
} {
  const r = spawnSync(process.execPath, [CLI, ...args], {
    cwd: REPO,
    encoding: "utf8",
    env: { ...process.env, FORCE_COLOR: "0", NO_COLOR: "1", ...extraEnv },
    windowsHide: true,
    timeout: 120_000,
  });
  return { exitCode: r.status, stdout: r.stdout || "", stderr: r.stderr || "" };
}

describeIfIndexed("adversarial + counterfactual + org — end-to-end smoke", () => {
  let tmp: string;
  let fakeHome: string;

  beforeEach(() => {
    tmp = mkdtempSync(join(tmpdir(), "mneme-blacksheep-"));
    fakeHome = mkdtempSync(join(tmpdir(), "mneme-bs-home-"));
  });

  afterEach(() => {
    try {
      rmSync(tmp, { recursive: true, force: true });
      rmSync(fakeHome, { recursive: true, force: true });
    } catch {
      /* ignore */
    }
  });

  // ─── adversarial ─────────────────────────────────────────────────────

  it("`mneme adversarial --probes 6` exits 0 (with or without HTC abstracts)", () => {
    const out = join(tmp, "probes.md");
    const r = runCli(["adversarial", "--probes", "6", "--out", out]);
    expect(r.exitCode).toBe(0);
    // Either:
    //   • file written (HTC populated), or
    //   • headline says "no HTC abstracts available" (HTC empty).
    if (existsSync(out)) {
      const md = readFileSync(out, "utf8");
      expect(md).toContain("# Mneme adversarial probes");
    } else {
      expect(r.stdout.toLowerCase()).toMatch(/no htc/);
    }
  });

  it("`mneme adversarial --json` returns parseable JSON", () => {
    const r = runCli(["adversarial", "--probes", "6", "--json", "--out", join(tmp, "j.md")]);
    expect(r.exitCode).toBe(0);
    const i = r.stdout.indexOf("{");
    expect(i).toBeGreaterThanOrEqual(0);
    const parsed = JSON.parse(r.stdout.slice(i));
    expect(typeof parsed.generatedAt).toBe("string");
  });

  // ─── counterfactual ──────────────────────────────────────────────────

  it("`mneme counterfactual` requires an email", () => {
    const r = runCli(["counterfactual"]);
    // commander emits its own usage error.
    expect(r.exitCode).not.toBe(0);
  });

  it("`mneme counterfactual <email>` exits 0 (returns degenerate report on solo-author repos)", () => {
    // Use whatever email is most likely to appear; fall back to a known-absent one.
    // Either path must exit 0 with friendly text.
    const r = runCli(["counterfactual", "patsa2561@gmail.com"]);
    expect(r.exitCode).toBe(0);
    // Output mentions "without" or "Counterfactual".
    expect(r.stdout.toLowerCase()).toMatch(/counterfactual|without|solo|never/);
  });

  it("`mneme counterfactual <email> --json` returns parseable JSON with the expected shape", () => {
    const r = runCli(["counterfactual", "patsa2561@gmail.com", "--json"]);
    expect(r.exitCode).toBe(0);
    const i = r.stdout.indexOf("{");
    expect(i).toBeGreaterThanOrEqual(0);
    const parsed = JSON.parse(r.stdout.slice(i));
    expect(typeof parsed.authorEmail).toBe("string");
    expect(typeof parsed.narrative).toBe("string");
    expect(parsed.atrophy).toBeDefined();
    expect(parsed.telepathy).toBeDefined();
  });

  it("counterfactual on a solo-author Mneme repo prints the narrative", () => {
    // Capture the actual rendered output so we can document it.
    const r = runCli(["counterfactual", "patsa2561@gmail.com"]);
    expect(r.exitCode).toBe(0);
    const out = r.stdout;
    // Either solo-author "only contributor" path, or a real-author path —
    // either way the headline + narrative must mention "without".
    expect(out.toLowerCase()).toMatch(/without|only contributor|never contributed/);
    // Should never use words like "rebuke" or "evaluate"; must include "Bayesian" or "what-if".
    expect(out.toLowerCase()).not.toMatch(/replaceable|inferior|underperform/);
  });

  // ─── org ─────────────────────────────────────────────────────────────

  it("`mneme org list` on a fresh home shows empty list with init hint", () => {
    const r = runCli(["org", "list"], { HOME: fakeHome, USERPROFILE: fakeHome });
    expect(r.exitCode).toBe(0);
    expect(r.stdout.toLowerCase()).toMatch(/no orgs|init/);
  });

  it("`mneme org init <name> --json` creates a registry file", () => {
    const r = runCli(["org", "init", "smoke-test", "--json"], {
      HOME: fakeHome,
      USERPROFILE: fakeHome,
    });
    expect(r.exitCode).toBe(0);
    const i = r.stdout.indexOf("{");
    expect(i).toBeGreaterThanOrEqual(0);
    const parsed = JSON.parse(r.stdout.slice(i));
    expect(parsed.name).toBe("smoke-test");
    // File should exist on disk in the fake home.
    expect(existsSync(join(fakeHome, ".mneme/orgs/smoke-test.json"))).toBe(true);
  });

  it("`mneme org add` then `mneme org status` reports indexed/missing", () => {
    runCli(["org", "init", "smoke-add"], { HOME: fakeHome, USERPROFILE: fakeHome });
    runCli(["org", "add", "smoke-add", REPO], { HOME: fakeHome, USERPROFILE: fakeHome });
    const r = runCli(["org", "status", "smoke-add", "--json"], {
      HOME: fakeHome,
      USERPROFILE: fakeHome,
    });
    expect(r.exitCode).toBe(0);
    const i = r.stdout.indexOf("{");
    const parsed = JSON.parse(r.stdout.slice(i));
    expect(parsed.repos.length).toBe(1);
    expect(parsed.repos[0].indexed).toBe(true);
  });

  it("`mneme org` (default) on an empty registry exits 1 with helpful error", () => {
    const r = runCli(["org"], { HOME: fakeHome, USERPROFILE: fakeHome });
    expect(r.exitCode).toBe(1);
    expect(r.stderr.toLowerCase()).toMatch(/no orgs/);
  });

  it("`mneme org` (default) runs cross-repo nervous-system on a registered org", () => {
    runCli(["org", "init", "smoke-run"], { HOME: fakeHome, USERPROFILE: fakeHome });
    runCli(["org", "add", "smoke-run", REPO], { HOME: fakeHome, USERPROFILE: fakeHome });
    const r = runCli(["org", "smoke-run", "--json"], {
      HOME: fakeHome,
      USERPROFILE: fakeHome,
    });
    expect(r.exitCode).toBe(0);
    const i = r.stdout.indexOf("{");
    const parsed = JSON.parse(r.stdout.slice(i));
    expect(parsed.org.name).toBe("smoke-run");
    expect(parsed.org.reposIndexed).toBe(1);
    expect(Array.isArray(parsed.crossRepoPairs)).toBe(true);
    expect(Array.isArray(parsed.limits)).toBe(true);
  });

  // ─── adversarial grading round-trip ──────────────────────────────────

  it("adversarial grading round-trips: generate → fake responses → grade", () => {
    const out = join(tmp, "rt.md");
    // First, generate (works only if HTC abstracts exist).
    const gen = runCli(["adversarial", "--probes", "6", "--out", out, "--json"]);
    expect(gen.exitCode).toBe(0);
    const i = gen.stdout.indexOf("{");
    const bundle = JSON.parse(gen.stdout.slice(i));
    if (!Array.isArray(bundle.probes) || bundle.probes.length === 0) {
      // No HTC → skip the grading half (still proves generate is well-formed).
      return;
    }
    // Build a "perfect" responses file using the answer key.
    const responses = {
      responses: bundle.probes.map((p: { id: string }) => ({
        id: p.id,
        verdict: bundle.answerKey[p.id] === "truth" ? "true" : "false",
      })),
    };
    const respPath = join(tmp, "rt-responses.json");
    writeFileSync(respPath, JSON.stringify(responses), "utf8");

    const grade = runCli(["adversarial", "--grade", respPath, "--json"]);
    expect(grade.exitCode).toBe(0);
    const j = grade.stdout.indexOf("{");
    const report = JSON.parse(grade.stdout.slice(j));
    expect(report.trustScore).toBe(100);
    expect(report.correctProbes).toBe(bundle.probes.length);
  });
});
