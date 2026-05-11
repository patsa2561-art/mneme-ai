/**
 * v1.52.0 -- tests for the Z3 SAT upgrade + plain-English explainer.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from "node:fs";
import { execSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { runACGV, runACGVAsync } from "./acgv.js";
import { explain, renderExplained } from "./acgv_explain.js";
import { godelPostMortemZ3 } from "./acgv_godel_z3.js";
import { chandrasekharCollapse } from "./acgv_chandrasekhar.js";
import { groundAllClaims } from "./acgv_neutrino.js";
import { extractFactClaims } from "./fact_grounding.js";

function setupRepo(): string {
  const repo = mkdtempSync(join(tmpdir(), "mneme-acgv152-"));
  writeFileSync(join(repo, "package.json"), JSON.stringify({
    name: "test-repo",
    version: "1.52.0",
    type: "module",
    dependencies: { typescript: "^5.0.0" },
  }, null, 2));
  writeFileSync(join(repo, "README.md"), "Built with TypeScript.\nThe typescript compiler runs every commit.");
  const pkg = join(repo, "packages", "core", "src");
  mkdirSync(pkg, { recursive: true });
  for (let i = 0; i < 6; i++) writeFileSync(join(pkg, `mod${i}.ts`), `// typescript module ${i}\nexport const X${i} = ${i};\n`);
  try {
    execSync(`git init -q`, { cwd: repo, stdio: "ignore" });
    execSync(`git config user.email "test@example.com"`, { cwd: repo, stdio: "ignore" });
    execSync(`git config user.name "Test"`, { cwd: repo, stdio: "ignore" });
    execSync(`git add .`, { cwd: repo, stdio: "ignore" });
    execSync(`git commit -m "typescript baseline"`, { cwd: repo, stdio: "ignore" });
  } catch { /* */ }
  return repo;
}
function cleanup(repo: string) { try { rmSync(repo, { recursive: true, force: true }); } catch { /* */ } }

describe("acgv_explain · plain-English layer", () => {
  let repo: string;
  beforeEach(() => { repo = setupRepo(); });
  afterEach(() => cleanup(repo));

  it("IMPOSSIBLE_REFUTE -> black traffic light + retract action", () => {
    const r = runACGV({ claim: "Mneme is written in Rust", repoRoot: repo, noEmitVaccine: true, noStake: true });
    expect(r.verdict).toBe("IMPOSSIBLE_REFUTE");
    const e = explain(r, "Mneme is written in Rust");
    expect(e.trafficLight).toBe("black");
    expect(e.nextAction.toLowerCase()).toContain("retract");
    expect(e.headline.length).toBeLessThanOrEqual(120);
  });

  it("FUSION -> green traffic light + cite action", () => {
    const r = runACGV({ claim: "this depends on typescript", repoRoot: repo, noEmitVaccine: true, noStake: true });
    if (r.verdict === "FUSION") {
      const e = explain(r, "this depends on typescript");
      expect(e.trafficLight).toBe("green");
      expect(e.nextAction.toLowerCase()).toContain("quote");
    }
  });

  it("PASSTHROUGH -> yellow + needs-data action", () => {
    const r = runACGV({ claim: "the codebase has good test coverage", repoRoot: repo, noEmitVaccine: true, noStake: true });
    expect(r.verdict).toBe("PASSTHROUGH");
    const e = explain(r, "the codebase has good test coverage");
    expect(e.trafficLight).toBe("yellow");
    expect(e.nextAction.toLowerCase()).toContain("specific");
  });

  it("renderExplained produces ~9 scannable lines", () => {
    const r = runACGV({ claim: "Mneme is written in Rust", repoRoot: repo, noEmitVaccine: true, noStake: true });
    const e = explain(r, "Mneme is written in Rust");
    const lines = renderExplained(e, "Mneme is written in Rust");
    expect(lines.length).toBeGreaterThanOrEqual(7);
    expect(lines.length).toBeLessThanOrEqual(12);
    // First line should carry the traffic glyph + tone.
    expect(lines[0]).toMatch(/IMPOSSIBLE|REFUTED/);
  });

  it("confidence is rendered as percentage string", () => {
    const r = runACGV({ claim: "Mneme is written in Rust", repoRoot: repo, noEmitVaccine: true, noStake: true });
    const e = explain(r, "Mneme is written in Rust");
    expect(e.confidencePct).toMatch(/^\d{1,3}%$/);
  });
});

describe("acgv_godel_z3 · formal SAT upgrade", () => {
  let repo: string;
  beforeEach(() => { repo = setupRepo(); });
  afterEach(() => cleanup(repo));

  it("returns engine tag identifying which proof system carried the verdict", async () => {
    const claims = extractFactClaims("Mneme is written in Rust");
    const grounded = groundAllClaims(repo, claims);
    const chandra = chandrasekharCollapse(grounded);
    const result = await godelPostMortemZ3(chandra, grounded);
    expect(["z3", "propositional"]).toContain(result.engine);
  });

  it("UNSAT result for Rust-on-TypeScript repo regardless of engine", async () => {
    const claims = extractFactClaims("Mneme is written in Rust");
    const grounded = groundAllClaims(repo, claims);
    const chandra = chandrasekharCollapse(grounded);
    const result = await godelPostMortemZ3(chandra, grounded);
    expect(result.status).toBe("UNSAT");
    expect(result.upgrade).toBe(true);
  });

  it("SKIPPED when Chandrasekhar wasn't BLACK_HOLE or LIMBO", async () => {
    const claims = extractFactClaims("this depends on typescript");
    const grounded = groundAllClaims(repo, claims);
    const chandra = chandrasekharCollapse(grounded);
    // typescript grounds in all flavors -> FUSION expected
    if (chandra.verdict === "FUSION") {
      const result = await godelPostMortemZ3(chandra, grounded);
      expect(result.status).toBe("SKIPPED");
    }
  });
});

describe("runACGVAsync · async pipeline with Z3 upgrade", () => {
  let repo: string;
  beforeEach(() => { repo = setupRepo(); });
  afterEach(() => cleanup(repo));

  it("Rust-on-TypeScript -> IMPOSSIBLE_REFUTE with engine tag", async () => {
    const r = await runACGVAsync({ claim: "Mneme is written in Rust", repoRoot: repo, noEmitVaccine: true, noStake: true });
    expect(r.verdict).toBe("IMPOSSIBLE_REFUTE");
    expect(["z3", "propositional"]).toContain(r.engine);
  });

  it("PASSTHROUGH stays PASSTHROUGH (no Z3 needed)", async () => {
    const r = await runACGVAsync({ claim: "the codebase has good test coverage", repoRoot: repo, noEmitVaccine: true, noStake: true });
    expect(r.verdict).toBe("PASSTHROUGH");
    expect(r.engine).toBe("propositional");
  });

  it("AUTO_REFUTE short-circuits (no Z3 run)", async () => {
    // First refute emits vaccine.
    await runACGVAsync({ claim: "Mneme is written in Rust", repoRoot: repo, noStake: true });
    // Second call should match the vaccine.
    const r = await runACGVAsync({ claim: "Mneme is written in Rust", repoRoot: repo, noEmitVaccine: true, noStake: true });
    expect(r.verdict).toBe("AUTO_REFUTE");
  });
});
