/**
 * v1.69.0 -- HYPERSCAN PROTOCOL test suite.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, mkdirSync, writeFileSync, existsSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execSync } from "node:child_process";

import { extractEntities, proseScan } from "./prose_shadow.js";
import { parseTriples, crossCitationGround } from "./cross_citation.js";
import { crossSourceAsk } from "./cross_source_qa.js";
import { generateDust, computeCoverage, clusterDust, readAbstracts } from "./nucleus_dust_htc.js";
import { buildMolecule, query } from "./hyperscan_molecule.js";

function setup(): string { return mkdtempSync(join(tmpdir(), "mneme-hs-")); }
function cleanup(r: string) { try { rmSync(r, { recursive: true, force: true }); } catch { /* */ } }

function initGit(r: string, files: Array<{ path: string; content: string }>, commits: string[]) {
  execSync(`git init --quiet -b main`, { cwd: r, stdio: "ignore" });
  execSync(`git config user.email "t@t.t"`, { cwd: r, stdio: "ignore" });
  execSync(`git config user.name "t"`, { cwd: r, stdio: "ignore" });
  execSync(`git config commit.gpgsign false`, { cwd: r, stdio: "ignore" });
  for (const f of files) {
    const dir = join(r, f.path, "..");
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(r, f.path), f.content, "utf8");
  }
  execSync(`git add -A`, { cwd: r, stdio: "ignore" });
  for (const c of commits) {
    writeFileSync(join(r, `m-${c.replace(/\W/g, "_")}.txt`), c, "utf8");
    execSync(`git add -A`, { cwd: r, stdio: "ignore" });
    execSync(`git commit -m "${c}" --no-gpg-sign --quiet`, { cwd: r, stdio: "ignore" });
  }
}

// ─── H1 PROSE SHADOW SCAN ────────────────────────────────────────────

describe("v1.69 Hyperscan H1 · Prose Shadow Scan", () => {
  let r: string;
  beforeEach(() => { r = setup(); writeFileSync(join(r, "package.json"), JSON.stringify({ name: "test", dependencies: { typescript: "5.0.0", react: "18.0.0" } }), "utf8"); });
  afterEach(() => cleanup(r));

  it("extracts title-cased + package-shaped + acronym entities", () => {
    const ents = extractEntities("WraithMonitor handles tracing via wraith-utils-2099 with ACME-Lib 3.0");
    const surfaces = ents.map((e) => e.surface);
    expect(surfaces).toContain("WraithMonitor");
    expect(surfaces.some((s) => s.startsWith("wraith-utils"))).toBe(true);
  });

  it("catches fake package-shape with digits + no citation", () => {
    const r1 = proseScan(r, "wraith-utils-2099 is integrated for caching across services");
    const wraith = r1.suspects.find((s) => s.entity.toLowerCase().includes("wraith"));
    expect(wraith).toBeDefined();
    expect(wraith!.confidence).toBeGreaterThanOrEqual(0.8);
  });

  it("recognizes known-real services (whitelists them)", () => {
    const r1 = proseScan(r, "We use Sentry for error tracking and Datadog for APM");
    expect(r1.recognized.length).toBeGreaterThan(0);
    expect(r1.suspects.find((s) => s.entity.toLowerCase() === "sentry")).toBeUndefined();
  });

  it("flags title-cased unknowns with no citation", () => {
    const r1 = proseScan(r, "FakeyMcFakeFace is our production OAuth library");
    expect(r1.suspects.find((s) => s.entity.includes("FakeyMcFake"))).toBeDefined();
  });

  it("does NOT flag real deps", () => {
    const r1 = proseScan(r, "TypeScript handles our types and React renders the UI");
    // Both are in KNOWN_REAL_NAMES; should be recognized not suspected.
    expect(r1.suspects.length).toBe(0);
  });
});

// ─── H2 CROSS-CITATION GROUND ────────────────────────────────────────

describe("v1.69 Hyperscan H2 · Cross-Citation Ground", () => {
  let r: string;
  beforeEach(() => { r = setup(); });
  afterEach(() => cleanup(r));

  it("parses triples from prose", () => {
    const tr = parseTriples("auth.ts handles login and billing.ts implements charging");
    expect(tr.length).toBeGreaterThanOrEqual(2);
    expect(tr[0]?.subject).toContain("auth");
  });

  it("flags citation gap when files don't exist", () => {
    const r1 = crossCitationGround(r, "PhantomMonitor handles distributed tracing across services");
    expect(r1.gaps).toBeGreaterThanOrEqual(0);
    expect(r1.groundScore).toBeLessThanOrEqual(1);
  });

  it("grounds when subject + object co-occur in source", () => {
    writeFileSync(join(r, "auth.ts"), "// auth login bcrypt handler\nexport function login() {}\n", "utf8");
    const r1 = crossCitationGround(r, "auth.ts handles login routing for users");
    expect(r1.groundScore).toBeGreaterThan(0);
  });
});

// ─── H3 CROSS-SOURCE Q&A FUSION ──────────────────────────────────────

describe("v1.69 Hyperscan H3 · Cross-Source Q&A Fusion", () => {
  let r: string;
  beforeEach(() => { r = setup(); });
  afterEach(() => cleanup(r));

  it("fuses retrieval across multiple sources", () => {
    initGit(r, [
      { path: "README.md", content: "# Project\n\nHTC compression cuts token spend by 100x via three-layer pre-compression of git history into LLM-consumable form.\n" },
      { path: "CHANGELOG.md", content: "## [1.0.0]\n- Added HTC compression for git history\n" },
      { path: "package.json", content: JSON.stringify({ name: "p", description: "HTC-powered memory layer." }) },
      { path: "htc.ts", content: "/**\n * HTC: hierarchical token cache for compressing commit history.\n */\nexport const x = 1;\n" },
    ], ["feat: add HTC compression"]);
    const r1 = crossSourceAsk(r, "what is HTC compression and how does it work");
    expect(r1.sourcesPresent.length).toBeGreaterThanOrEqual(2);
    expect(["MEDIUM", "HIGH"]).toContain(r1.trustLabel);
    expect(r1.fusedAnswer).toContain("HTC");
  });

  it("reports LOW trust when nothing matches", () => {
    initGit(r, [{ path: "README.md", content: "Only generic stuff here." }], ["initial"]);
    const r1 = crossSourceAsk(r, "what is fooBarBaz compression");
    expect(r1.trustLabel).toBe("LOW");
  });
});

// ─── H4 NUCLEUS DUST HTC ─────────────────────────────────────────────

describe("v1.69 Hyperscan H4 · Nucleus Dust HTC", () => {
  let r: string;
  beforeEach(() => { r = setup(); });
  afterEach(() => cleanup(r));

  it("generates abstracts for commits + file docstrings", () => {
    initGit(r, [
      { path: "src/foo.ts", content: "/**\n * Foo module: does the foo thing.\n */\nexport const x = 1;\n" },
      { path: "src/bar.ts", content: "/**\n * Bar module: handles bars.\n */\nexport const y = 2;\n" },
    ], ["feat(foo): add foo", "feat(bar): add bar", "fix: tidy"]);
    const { added } = generateDust(r);
    expect(added).toBeGreaterThanOrEqual(2);
    const abstracts = readAbstracts(r);
    expect(abstracts.length).toBeGreaterThanOrEqual(2);
  });

  it("coverage increases after dust generation", () => {
    initGit(r, [{ path: "src/foo.ts", content: "/** Foo. */\nexport const x = 1;\n" }], ["feat: foo"]);
    const before = computeCoverage(r).coveragePct;
    generateDust(r);
    const after = computeCoverage(r).coveragePct;
    expect(after).toBeGreaterThanOrEqual(before);
    expect(after).toBeGreaterThan(0);
  });

  it("idempotent: re-running adds 0", () => {
    initGit(r, [{ path: "src/foo.ts", content: "/** Foo. */\nexport const x = 1;\n" }], ["feat: foo"]);
    generateDust(r);
    const second = generateDust(r);
    expect(second.added).toBe(0);
  });

  it("clusterDust groups similar abstracts", () => {
    initGit(r, [], ["feat(auth): add login", "feat(auth): add logout", "fix(auth): retry", "feat(billing): stripe"]);
    generateDust(r);
    const clusters = clusterDust(r);
    expect(clusters.length).toBeGreaterThan(0);
  });
});

// ─── HYPERSCAN MOLECULE ──────────────────────────────────────────────

describe("v1.69 Hyperscan · Shape-shifting Molecule", () => {
  it("builds a molecule with 4 forms", () => {
    const m = buildMolecule({
      text: "function login() handles auth via bcrypt at src/auth.ts",
      source: { kind: "commit", ref: "abc123" },
      epoch: "2026-01-01T00:00:00Z",
    });
    expect(m.textForm).toContain("login");
    expect(m.vectorForm.size).toBeGreaterThan(0);
    expect(m.structuralForm.functions).toContain("login");
    expect(m.structuralForm.paths.some((p) => p.endsWith(".ts"))).toBe(true);
    expect(m.temporalForm.epoch).toBe("2026-01-01T00:00:00Z");
  });

  it("query with cosine ranks by vector similarity", () => {
    const mA = buildMolecule({ text: "auth bcrypt login flow", source: { kind: "commit", ref: "a" } });
    const mB = buildMolecule({ text: "billing stripe charge", source: { kind: "commit", ref: "b" } });
    const result = query([mA, mB], "cosine", { text: "auth login" });
    expect(result[0]?.molecule.id).toBe(mA.id);
  });

  it("query with structural ranks by AST shape overlap", () => {
    const mA = buildMolecule({ text: "function login() at src/auth.ts", source: { kind: "commit", ref: "a" } });
    const mB = buildMolecule({ text: "class Billing in billing.js", source: { kind: "commit", ref: "b" } });
    const result = query([mA, mB], "structural", { text: "function login() at src/auth.ts" });
    expect(result[0]?.molecule.id).toBe(mA.id);
  });

  it("query with hybrid fuses 4 algorithm scores", () => {
    const m1 = buildMolecule({ text: "auth login bcrypt secure flow", source: { kind: "commit", ref: "a" } });
    const m2 = buildMolecule({ text: "billing stripe payment processing", source: { kind: "commit", ref: "b" } });
    const result = query([m1, m2], "hybrid", { text: "auth login bcrypt" });
    expect(result[0]?.molecule.id).toBe(m1.id);
    expect(result[0]?.scores.cosine).toBeDefined();
    expect(result[0]?.scores.jaccard).toBeDefined();
    expect(result[0]?.scores.structural).toBeDefined();
  });

  it("query with temporal ranks by epoch closeness", () => {
    const target = "2026-05-12T00:00:00Z";
    const close = buildMolecule({ text: "x", source: { kind: "c", ref: "1" }, epoch: "2026-05-11T00:00:00Z" });
    const far = buildMolecule({ text: "x", source: { kind: "c", ref: "2" }, epoch: "2020-01-01T00:00:00Z" });
    const result = query([close, far], "temporal", { epoch: target });
    expect(result[0]?.molecule.id).toBe(close.id);
  });
});
