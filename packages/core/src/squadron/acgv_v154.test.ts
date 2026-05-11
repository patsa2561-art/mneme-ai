/**
 * v1.54.0 -- HONEST FIELD-TEST FIXES regression suite.
 *
 * Pins the safety + correctness behaviours surfaced in the tester's
 * field test before this release.
 *
 * Specifically:
 *   1. Negation flip -- "X is not Y" verifies as the OPPOSITE of "X is Y"
 *   2. Implicit language -- "this is a TypeScript project" extracts a
 *      language=typescript claim (no "written in" required)
 *   3. Workspace deps -- libraries in packages/<x>/package.json ground
 *      as found, not refuted as missing
 *   4. Commit existence -- "commit abc1234 ..." extracts commit_exists
 *      claim verified via git cat-file, surface/spectrum returns neutral
 *      so a real-but-unmentioned SHA doesn't get harmonic-killed
 *   5. LIBRARY_USED_RE doesn't capture conjunctions ("both", "and")
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from "node:fs";
import { execSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { extractFactClaims, verifyFacts, isLibraryInPackageJson } from "./fact_grounding.js";
import { runACGV } from "./acgv.js";

function setupRepo(): string {
  const repo = mkdtempSync(join(tmpdir(), "mneme-acgv154-"));
  writeFileSync(join(repo, "package.json"), JSON.stringify({
    name: "test-monorepo",
    version: "1.54.0",
    type: "module",
    workspaces: ["packages/*"],
  }, null, 2));
  const cliPkg = join(repo, "packages", "cli");
  mkdirSync(cliPkg, { recursive: true });
  writeFileSync(join(cliPkg, "package.json"), JSON.stringify({
    name: "@test/cli",
    version: "1.54.0",
    dependencies: { commander: "^12.1.0" },
  }, null, 2));
  const corePkg = join(repo, "packages", "core", "src");
  mkdirSync(corePkg, { recursive: true });
  for (let i = 0; i < 6; i++) writeFileSync(join(corePkg, `m${i}.ts`), `export const X${i} = ${i};\n`);
  writeFileSync(join(repo, "README.md"), "Built with TypeScript.");
  try {
    execSync(`git init -q`, { cwd: repo, stdio: "ignore" });
    execSync(`git config user.email "t@t.com"`, { cwd: repo, stdio: "ignore" });
    execSync(`git config user.name "t"`, { cwd: repo, stdio: "ignore" });
    execSync(`git add .`, { cwd: repo, stdio: "ignore" });
    execSync(`git commit -m "first"`, { cwd: repo, stdio: "ignore" });
  } catch { /* */ }
  return repo;
}
function cleanup(r: string) { try { rmSync(r, { recursive: true, force: true }); } catch { /* */ } }

describe("v1.54 SAFETY: negation flip", () => {
  let repo: string;
  beforeEach(() => { repo = setupRepo(); });
  afterEach(() => cleanup(repo));

  it("'Mneme is NOT written in Rust' extracts negated=true on language=rust", () => {
    const claims = extractFactClaims("Mneme is not written in Rust");
    const rust = claims.find((c) => c.kind === "language" && c.asserted === "rust");
    expect(rust).toBeDefined();
    expect(rust!.negated).toBe(true);
  });

  it("'commander is not installed' extracts negation on library", () => {
    const claims = extractFactClaims("the project does not depend on commander");
    const lib = claims.find((c) => c.kind === "library_used");
    expect(lib).toBeDefined();
    expect(lib!.negated).toBe(true);
  });

  it("verifyFacts flips verdict for negated claim", () => {
    // Repo has no Rust files. Without negation: "Mneme is written in Rust" -> false.
    // With negation: "Mneme is NOT written in Rust" should verify true.
    const claims = extractFactClaims("Mneme is not written in Rust");
    const results = verifyFacts(repo, claims);
    const rustResult = results.find((r) => r.claim.kind === "language");
    expect(rustResult).toBeDefined();
    expect(rustResult!.verdict).toBe("true");
    expect(rustResult!.evidence).toMatch(/negation flip/i);
  });

  it("end-to-end ACGV: 'X is not Rust' grounds in a non-Rust repo", () => {
    const r = runACGV({ claim: "Mneme is not written in Rust", repoRoot: repo, noEmitVaccine: true, noStake: true });
    // The negation flips raw harmonic=0 to 1.0 -> FUSION expected.
    expect(["FUSION", "PASSTHROUGH"]).toContain(r.verdict);
    expect(r.verdict).not.toBe("BLACK_HOLE");
    expect(r.verdict).not.toBe("IMPOSSIBLE_REFUTE");
  });

  it("'X is NOT installed' when X IS installed -> REFUTE (the safety case)", () => {
    // Repo has commander in packages/cli. Claim DENIES it -> should be false.
    const r = runACGV({ claim: "this project does not depend on commander", repoRoot: repo, noEmitVaccine: true, noStake: true });
    // The claim is FALSE (commander IS in workspace) -> raw substrate=1.0,
    // negated flips to 0 -> BLACK_HOLE or similar refute.
    expect(["BLACK_HOLE", "IMPOSSIBLE_REFUTE"]).toContain(r.verdict);
  });
});

describe("v1.54 COVERAGE: implicit language patterns", () => {
  let repo: string;
  beforeEach(() => { repo = setupRepo(); });
  afterEach(() => cleanup(repo));

  it("'this is a TypeScript project' extracts language=typescript", () => {
    const claims = extractFactClaims("this is a TypeScript project");
    const ts = claims.find((c) => c.kind === "language" && c.asserted === "typescript");
    expect(ts).toBeDefined();
    expect(ts!.negated).toBe(false);
  });

  it("'rust codebase' extracts language=rust", () => {
    const claims = extractFactClaims("we maintain a rust codebase");
    const rust = claims.find((c) => c.kind === "language" && c.asserted === "rust");
    expect(rust).toBeDefined();
  });
});

describe("v1.54 COVERAGE: workspace package.json", () => {
  let repo: string;
  beforeEach(() => { repo = setupRepo(); });
  afterEach(() => cleanup(repo));

  it("library in workspace dep is found (not just root)", () => {
    expect(isLibraryInPackageJson(repo, "commander")).toBe(true);
  });

  it("non-installed library returns false", () => {
    expect(isLibraryInPackageJson(repo, "this-pkg-does-not-exist-xyz")).toBe(false);
  });
});

describe("v1.54 COVERAGE: commit_exists claim", () => {
  let repo: string;
  beforeEach(() => { repo = setupRepo(); });
  afterEach(() => cleanup(repo));

  it("'commit abc1234 ...' extracts commit_exists claim", () => {
    const claims = extractFactClaims("commit abc1234 introduced the bug");
    const c = claims.find((cl) => cl.kind === "commit_exists");
    expect(c).toBeDefined();
    expect(c!.asserted).toBe("abc1234");
  });

  it("real commit SHA verifies true via git cat-file", () => {
    // Get the actual HEAD commit
    const head = execSync(`git -C "${repo}" rev-parse HEAD`, { encoding: "utf8" }).trim().slice(0, 7);
    const claims = extractFactClaims(`commit ${head} is the initial commit`);
    const results = verifyFacts(repo, claims);
    const commitResult = results.find((r) => r.claim.kind === "commit_exists");
    expect(commitResult).toBeDefined();
    expect(commitResult!.verdict).toBe("true");
  });

  it("fabricated commit SHA verifies false", () => {
    const claims = extractFactClaims("commit 0000000 introduced X");
    const results = verifyFacts(repo, claims);
    const commitResult = results.find((r) => r.claim.kind === "commit_exists");
    expect(commitResult).toBeDefined();
    expect(commitResult!.verdict).toBe("false");
  });
});

describe("v1.54 COVERAGE: conjunctions not captured as libraries", () => {
  it("'both' is filtered as GENERIC", () => {
    const claims = extractFactClaims("Mneme uses both TypeScript and JavaScript");
    const libs = claims.filter((c) => c.kind === "library_used");
    // Should NOT extract 'both' as a library.
    expect(libs.some((l) => l.asserted === "both")).toBe(false);
  });

  it("'and' / 'or' filtered as well", () => {
    const claimsAnd = extractFactClaims("uses and");
    const claimsOr = extractFactClaims("uses or");
    expect(claimsAnd.filter((c) => c.asserted === "and").length).toBe(0);
    expect(claimsOr.filter((c) => c.asserted === "or").length).toBe(0);
  });
});
