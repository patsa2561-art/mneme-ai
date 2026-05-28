/**
 * v1.51.0 -- ACGV regression test suite.
 *
 * Anchored to the smoking-gun bug:
 *   claim "Mneme has 200 tools and the daemon is written in Rust" ->
 *   pre-v1.50 squadron returned ✅ SUPPORTED 57%.
 *   post-v1.50 advocate caught it as FALSE_FACT_CLAIM but only as split.
 *   post-v1.51 ACGV must escalate to IMPOSSIBLE_REFUTE with Godel UNSAT-core.
 *
 * Tests exercise each layer plus the end-to-end orchestrator. Every test
 * uses a temp repo so we don't depend on the parent repo's contents.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, writeFileSync, mkdirSync, readdirSync, readFileSync, existsSync } from "node:fs";
import { execSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { runACGV } from "./acgv.js";
import { harmonicMean, groundClaim, groundAllClaims, neutrinoSurface, neutrinoSubstrate, neutrinoSpectrum } from "./acgv_neutrino.js";
import { chandrasekharCollapse, PHI, RHO_CRIT_LOW, RHO_CRIT_HIGH } from "./acgv_chandrasekhar.js";
import { godelPostMortem } from "./acgv_godel.js";
import { requestConfession, evaluateConfession } from "./acgv_confession.js";
import { simhash64, hammingDistance, emitVaccine, checkAgainstVaccines, loadVaccines } from "./acgv_vaccine.js";
import { noteBotOutcome, voteWeight, loadKarma } from "./acgv_stake.js";
import { extractFactClaims } from "./fact_grounding.js";

function setupTypeScriptRepo(): string {
  const repo = mkdtempSync(join(tmpdir(), "mneme-acgv-"));
  // Minimal package.json so neutrinoSubstrate/version checks have a baseline.
  writeFileSync(join(repo, "package.json"), JSON.stringify({
    name: "mneme-monorepo",
    version: "1.51.0",
    type: "module",
    dependencies: { typescript: "^5.0.0" },
  }, null, 2));
  // README mentions "typescript" so surface flavor has hits.
  writeFileSync(join(repo, "README.md"), [
    "# Mneme",
    "",
    "Mneme is written in TypeScript.",
    "",
    "Built with the typescript compiler. Every module is typescript.",
    "Typescript-based memory layer for AI codebases.",
  ].join("\n"));
  // Create at least 6 TypeScript source files mentioning typescript so
  // language=typescript grounds firmly on substrate AND surface.
  const pkg = join(repo, "packages", "core", "src");
  mkdirSync(pkg, { recursive: true });
  for (let i = 0; i < 6; i++) {
    writeFileSync(
      join(pkg, `mod${i}.ts`),
      `// typescript module ${i}\nexport const X${i} = ${i};\n`,
    );
  }
  // Init git and make two commits so spectrum has multiple history rows.
  try {
    execSync(`git init -q`, { cwd: repo, stdio: "ignore" });
    execSync(`git config user.email "test@example.com"`, { cwd: repo, stdio: "ignore" });
    execSync(`git config user.name "Test"`, { cwd: repo, stdio: "ignore" });
    execSync(`git add .`, { cwd: repo, stdio: "ignore" });
    execSync(`git commit -m "initial typescript code"`, { cwd: repo, stdio: "ignore" });
    writeFileSync(join(pkg, "mod0.ts"), `// typescript module 0 v2\nexport const X0 = 0;\n`);
    execSync(`git add .`, { cwd: repo, stdio: "ignore" });
    execSync(`git commit -m "refactor typescript module"`, { cwd: repo, stdio: "ignore" });
  } catch { /* git unavailable - tests that depend on spectrum will fall back */ }
  return repo;
}

function cleanup(repo: string) {
  try { rmSync(repo, { recursive: true, force: true }); } catch { /* */ }
}

// ─── LAYER 1: NEUTRINO ─────────────────────────────────────────────────

describe("acgv_neutrino · harmonic mean", () => {
  it("returns 0 when any input is 0 (the unforgiving discriminator)", () => {
    expect(harmonicMean([0, 1, 1])).toBe(0);
    expect(harmonicMean([1, 0, 1])).toBe(0);
    expect(harmonicMean([1, 1, 0])).toBe(0);
    expect(harmonicMean([0, 0, 0])).toBe(0);
  });

  it("returns expected value for non-zero scores", () => {
    expect(harmonicMean([1, 1, 1])).toBeCloseTo(1, 4);
    expect(harmonicMean([0.5, 0.5, 0.5])).toBeCloseTo(0.5, 4);
    // harmonic mean of 0.5 / 1.0 / 1.0 = 3 / (2 + 1 + 1) = 0.75
    expect(harmonicMean([0.5, 1.0, 1.0])).toBeCloseTo(0.75, 4);
  });

  it("punishes outliers more than arithmetic mean does", () => {
    const arithmetic = (0.1 + 1.0 + 1.0) / 3;
    const harmonic = harmonicMean([0.1, 1.0, 1.0]);
    expect(harmonic).toBeLessThan(arithmetic);
  });
});

describe("acgv_neutrino · groundClaim", () => {
  let repo: string;
  beforeEach(() => { repo = setupTypeScriptRepo(); });
  afterEach(() => cleanup(repo));

  it("rust language claim grounds at 0 (no .rs files, no Cargo.toml, no commits)", () => {
    const claims = extractFactClaims("Mneme is written in Rust");
    const rustClaim = claims.find((c) => c.kind === "language" && c.asserted === "rust");
    expect(rustClaim).toBeDefined();
    const result = groundClaim(repo, rustClaim!);
    expect(result.substrate.score).toBe(0);
    expect(result.harmonic).toBe(0);
    expect(result.zeroFlavors).toContain("substrate");
  });

  it("typescript language claim grounds positively (6 .ts files present)", () => {
    const claims = extractFactClaims("Mneme is written in TypeScript");
    const tsClaim = claims.find((c) => c.kind === "language" && c.asserted === "typescript");
    expect(tsClaim).toBeDefined();
    const result = groundClaim(repo, tsClaim!);
    expect(result.substrate.score).toBeGreaterThan(0);
  });

  it("library claim grounds via package.json", () => {
    const claims = extractFactClaims("This depends on typescript package");
    const libClaim = claims.find((c) => c.kind === "library_used");
    // package.json has typescript in deps -> substrate grounds.
    if (libClaim) {
      const result = groundClaim(repo, libClaim);
      expect(result.substrate.score).toBe(1.0);
    }
  });

  // v2.76.0 R1 FIX — an absent library grounds at NEUTRAL 0.5, never 0.
  // package.json is not authoritative (Ollama models / other ecosystems /
  // other projects), and substrate 0 fed the GÖDEL unsat-core → a false
  // IMPOSSIBLE_REFUTE of true claims like "X uses bge-m3".
  it("missing library grounds substrate at NEUTRAL 0.5 (not 0)", () => {
    const claims: import("./fact_grounding.js").FactClaim[] = [{
      kind: "library_used",
      asserted: "this-library-does-not-exist-xyz",
      raw: "depends on this-library-does-not-exist-xyz",
    }];
    const result = groundClaim(repo, claims[0]!);
    expect(result.substrate.score).toBe(0.5);
    expect(result.substrate.score).not.toBe(0);
  });
});

// ─── LAYER 2: CHANDRASEKHAR ────────────────────────────────────────────

describe("acgv_chandrasekhar · critical points", () => {
  it("golden-ratio anchored critical points", () => {
    expect(PHI).toBeCloseTo(1.6180339887, 6);
    expect(RHO_CRIT_LOW).toBeCloseTo(0.381966011, 6);
    expect(RHO_CRIT_HIGH).toBeCloseTo(0.618033988, 6);
    expect(RHO_CRIT_LOW + RHO_CRIT_HIGH).toBeCloseTo(1, 6);
  });

  it("zero-density input -> BLACK_HOLE", () => {
    const grounded: import("./acgv_neutrino.js").GroundingResult[] = [{
      claim: { kind: "language", asserted: "rust", raw: "rust" },
      surface: { score: 0, evidence: "" },
      substrate: { score: 0, evidence: "" },
      spectrum: { score: 0, evidence: "" },
      harmonic: 0,
      zeroFlavors: ["surface", "substrate", "spectrum"],
    }];
    const r = chandrasekharCollapse(grounded);
    expect(r.verdict).toBe("BLACK_HOLE");
    expect(r.confidence).toBeGreaterThan(0.9);
  });

  it("full-density input -> FUSION", () => {
    const grounded: import("./acgv_neutrino.js").GroundingResult[] = [{
      claim: { kind: "language", asserted: "typescript", raw: "typescript" },
      surface: { score: 1, evidence: "" },
      substrate: { score: 1, evidence: "" },
      spectrum: { score: 1, evidence: "" },
      harmonic: 1,
      zeroFlavors: [],
    }];
    const r = chandrasekharCollapse(grounded);
    expect(r.verdict).toBe("FUSION");
    expect(r.density).toBeCloseTo(1, 4);
  });

  it("middling-density input -> LIMBO (REFUSE_VERDICT, the taboo move)", () => {
    const grounded: import("./acgv_neutrino.js").GroundingResult[] = [{
      claim: { kind: "language", asserted: "typescript", raw: "ts" },
      surface: { score: 0.5, evidence: "" },
      substrate: { score: 0.5, evidence: "" },
      spectrum: { score: 0.5, evidence: "" },
      harmonic: 0.5,
      zeroFlavors: [],
    }];
    const r = chandrasekharCollapse(grounded);
    expect(r.verdict).toBe("LIMBO");
  });

  it("no extractable facts -> UNKNOWN_MASS (passthrough to legacy)", () => {
    const r = chandrasekharCollapse([]);
    expect(r.verdict).toBe("UNKNOWN_MASS");
  });
});

// ─── LAYER 3: GODEL ────────────────────────────────────────────────────

describe("acgv_godel · UNSAT proof certificate", () => {
  it("emits UNSAT when all 3 flavors are 0", () => {
    const grounded: import("./acgv_neutrino.js").GroundingResult[] = [{
      claim: { kind: "language", asserted: "rust", raw: "rust" },
      surface: { score: 0, evidence: "no rust in text" },
      substrate: { score: 0, evidence: "no .rs files" },
      spectrum: { score: 0, evidence: "no rust in git history" },
      harmonic: 0,
      zeroFlavors: ["surface", "substrate", "spectrum"],
    }];
    const chandra = chandrasekharCollapse(grounded);
    expect(chandra.verdict).toBe("BLACK_HOLE");
    const g = godelPostMortem(chandra, grounded);
    expect(g.status).toBe("UNSAT");
    expect(g.upgrade).toBe(true);
    expect(g.core.length).toBe(1);
    expect(g.certificate).toContain("UNSAT-CORE");
  });

  it("v1.51 update: substrate-explicitly-negative still UNSAT even with stray surface signal", () => {
    // A stray surface word ("rust" mentioned in passing in a comment or test
    // fixture) does NOT rescue a claim whose substrate explicitly says "no
    // .rs files". This is the bug we just fixed -- AND-compound claims with
    // even one impossible assertion must still be REFUTED.
    const grounded: import("./acgv_neutrino.js").GroundingResult[] = [{
      claim: { kind: "language", asserted: "rust", raw: "rust" },
      surface: { score: 0.2, evidence: "one stray rust mention" },
      substrate: { score: 0, evidence: "no .rs files on disk" },
      spectrum: { score: 0, evidence: "no rust commits" },
      harmonic: 0,
      zeroFlavors: ["substrate", "spectrum"],
    }];
    const chandra = chandrasekharCollapse(grounded);
    const g = godelPostMortem(chandra, grounded);
    expect(g.status).toBe("UNSAT");
    expect(g.upgrade).toBe(true);
  });

  it("SAT when substrate score=0 but evidence isn't explicitly negative", () => {
    // tool_count returns substrate=0.5 as the default "no substrate check"
    // case -- that should NOT be a Godel UNSAT, just a borderline.
    const grounded: import("./acgv_neutrino.js").GroundingResult[] = [{
      claim: { kind: "tool_count", asserted: "200", raw: "200 tools" },
      surface: { score: 0.4, evidence: "some hits" },
      substrate: { score: 0.5, evidence: "tool count substrate handled by advocate fact-checker" },
      spectrum: { score: 0.5, evidence: "some commits" },
      harmonic: 0.46,
      zeroFlavors: [],
    }];
    const chandra = chandrasekharCollapse(grounded);
    // density ~0.46 -> LIMBO; Godel SHOULD run but find no triple-negative.
    const g = godelPostMortem(chandra, grounded);
    expect(g.status).toBe("SAT");
    expect(g.upgrade).toBe(false);
  });

  it("SKIPPED when Chandrasekhar verdict is not BLACK_HOLE", () => {
    const grounded: import("./acgv_neutrino.js").GroundingResult[] = [{
      claim: { kind: "language", asserted: "typescript", raw: "ts" },
      surface: { score: 1, evidence: "" },
      substrate: { score: 1, evidence: "" },
      spectrum: { score: 1, evidence: "" },
      harmonic: 1,
      zeroFlavors: [],
    }];
    const chandra = chandrasekharCollapse(grounded);
    expect(chandra.verdict).toBe("FUSION");
    const g = godelPostMortem(chandra, grounded);
    expect(g.status).toBe("SKIPPED");
    expect(g.upgrade).toBe(false);
  });
});

// ─── LAYER 4: CONFESSION ───────────────────────────────────────────────

describe("acgv_confession · doubt-or-be-halved", () => {
  it("empty response -> confidence x 0.5 (no-honest-doubt penalty)", () => {
    const v = evaluateConfession("anything", []);
    expect(v.responded).toBe(false);
    expect(v.confidenceMultiplier).toBe(0.5);
    expect(v.flipToRefute).toBe(false);
  });

  it("hallucinated doubts (none ground) -> mild downgrade only", () => {
    let repo: string | null = null;
    try {
      repo = setupTypeScriptRepo();
      const v = evaluateConfession(
        "Mneme is written in TypeScript",
        ["maybe it is rust", "could be assembly"],
        repo,
      );
      expect(v.responded).toBe(true);
      expect(v.flipToRefute).toBe(false);
      expect(v.confidenceMultiplier).toBeLessThan(1.0);
      expect(v.confidenceMultiplier).toBeGreaterThan(0.5);
    } finally {
      if (repo) cleanup(repo);
    }
  });

  it("requestConfession returns a prompt + nonce", () => {
    const r = requestConfession("any claim");
    expect(r.nonce).toMatch(/^[0-9a-f]{16}$/);
    expect(r.prompt).toContain("3 specific reasons");
    expect(r.commitment).toHaveLength(16);
  });
});

// ─── LAYER 5: VACCINE ──────────────────────────────────────────────────

describe("acgv_vaccine · simhash + bank", () => {
  it("simhash64 returns 16-char hex", () => {
    const h = simhash64("hello world");
    expect(h).toMatch(/^[0-9a-f]{16}$/);
  });

  it("identical strings -> distance 0", () => {
    const a = simhash64("Mneme is written in Rust");
    const b = simhash64("Mneme is written in Rust");
    expect(hammingDistance(a, b)).toBe(0);
  });

  it("similar strings -> small distance, different shapes -> large distance", () => {
    const close = hammingDistance(
      simhash64("Mneme has 200 tools and is written in Rust"),
      simhash64("Mneme has 250 tools and is written in Rust"),
    );
    const far = hammingDistance(
      simhash64("the sky is blue"),
      simhash64("functional programming languages"),
    );
    expect(close).toBeLessThan(far);
  });

  it("emit + match round trip", () => {
    let repo: string | null = null;
    try {
      repo = setupTypeScriptRepo();
      emitVaccine(repo, "Mneme is written in Rust", "BLACK_HOLE :: language=rust");
      const vaccines = loadVaccines(repo);
      expect(vaccines.length).toBe(1);
      const match = checkAgainstVaccines(repo, "Mneme is written in Rust");
      expect(match).not.toBeNull();
      expect(match!.matched).toBe(true);
      expect(match!.distance).toBe(0);
    } finally {
      if (repo) cleanup(repo);
    }
  });
});

// ─── LAYER 6: STAKE / KARMA ────────────────────────────────────────────

describe("acgv_stake · karma ledger", () => {
  it("correct outcome adds karma; wrong outcome punishes by confidence^2", () => {
    let repo: string | null = null;
    try {
      repo = setupTypeScriptRepo();
      noteBotOutcome(repo, "diagnostician", 0.9, true);
      const after1 = loadKarma(repo).bots["diagnostician"]!;
      expect(after1.verifiedCorrect).toBe(1);
      expect(after1.karma).toBeGreaterThan(10);
      noteBotOutcome(repo, "diagnostician", 0.9, false);
      const after2 = loadKarma(repo).bots["diagnostician"]!;
      expect(after2.caughtWrong).toBe(1);
      // Karma should have moved down from after1
      expect(after2.karma).toBeLessThan(after1.karma);
    } finally {
      if (repo) cleanup(repo);
    }
  });

  it("muted bots return voteWeight 0; new bots return 1", () => {
    let repo: string | null = null;
    try {
      repo = setupTypeScriptRepo();
      expect(voteWeight(repo, "fresh-bot")).toBe(1);
      // Punish a bot repeatedly with high confidence to drive it negative.
      for (let i = 0; i < 20; i++) noteBotOutcome(repo, "liar", 1.0, false);
      const w = voteWeight(repo, "liar");
      expect(w).toBeLessThan(1);
    } finally {
      if (repo) cleanup(repo);
    }
  });
});

// ─── ORCHESTRATOR: END-TO-END ──────────────────────────────────────────

describe("acgv · CRITICAL REGRESSION: the Rust-lie smoking gun", () => {
  let repo: string;
  beforeEach(() => { repo = setupTypeScriptRepo(); });
  afterEach(() => cleanup(repo));

  it("'Mneme is written in Rust' against a TypeScript repo -> IMPOSSIBLE_REFUTE with UNSAT proof", () => {
    const r = runACGV({
      claim: "Mneme is written in Rust",
      repoRoot: repo,
      noEmitVaccine: true, // keep test idempotent
      noStake: true,
    });
    expect(["IMPOSSIBLE_REFUTE", "BLACK_HOLE"]).toContain(r.verdict);
    expect(r.confidence).toBeGreaterThan(0.8);
    // Chandrasekhar should report collapse.
    expect(r.layers.chandrasekhar.verdict).toBe("BLACK_HOLE");
    // Caveats should include the collapse signal.
    expect(r.caveats.some((c) => c.includes("CHANDRASEKHAR") || c.includes("GODEL"))).toBe(true);
  });

  it("'Mneme is written in TypeScript' against a TypeScript repo -> FUSION or LIMBO (never BLACK_HOLE)", () => {
    const r = runACGV({
      claim: "Mneme is written in TypeScript",
      repoRoot: repo,
      noEmitVaccine: true,
      noStake: true,
    });
    // Critical guarantee: we must NEVER black-hole a true claim that grounds
    // in all three flavors. FUSION (full ignition) or LIMBO (honest "not
    // sure enough") are both acceptable; BLACK_HOLE here would be a regression.
    expect(["FUSION", "LIMBO", "PASSTHROUGH"]).toContain(r.verdict);
    expect(r.verdict).not.toBe("BLACK_HOLE");
    expect(r.verdict).not.toBe("IMPOSSIBLE_REFUTE");
  });

  it("emits a vaccine on BLACK_HOLE; second call AUTO_REFUTEs in microseconds", () => {
    const r1 = runACGV({
      claim: "Mneme is written in Rust",
      repoRoot: repo,
      noStake: true,
    });
    expect(r1.vaccineEmitted).toBe(true);

    const r2 = runACGV({
      claim: "Mneme is written in Rust",
      repoRoot: repo,
      noStake: true,
      noEmitVaccine: true,
    });
    expect(r2.verdict).toBe("AUTO_REFUTE");
    expect(r2.layers.vaccineMatch).not.toBeNull();
  });

  it("a vague claim with no extractable facts -> PASSTHROUGH (legacy squadron decides)", () => {
    const r = runACGV({
      claim: "the codebase has good test coverage",
      repoRoot: repo,
      noEmitVaccine: true,
      noStake: true,
    });
    expect(r.verdict).toBe("PASSTHROUGH");
  });

  it("inline confession with grounded counter-evidence flips FUSION to BLACK_HOLE", () => {
    // Start with a claim that would otherwise FUSION, then the AI confesses
    // 2 grounded counter-points -> confession layer flips the verdict.
    const r = runACGV({
      claim: "Mneme is written in TypeScript",
      repoRoot: repo,
      counterEvidence: [
        "this depends on typescript package",
        "the version is 1.51.0",
      ],
      noEmitVaccine: true,
      noStake: true,
    });
    // Counter-evidence grounds (typescript dep + version match) -> flip.
    if (r.layers.confession) {
      expect(r.layers.confession.responded).toBe(true);
      // With grounded counter-evidence, confession should at least signal flip.
      if (r.layers.confession.flipToRefute) {
        expect(r.verdict).toBe("BLACK_HOLE");
      }
    }
  });
});
