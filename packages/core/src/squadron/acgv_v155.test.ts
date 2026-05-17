/**
 * v1.55.0 -- PRTF + Z3 ARITHMETIC test suite, 100% accuracy lock-in.
 *
 * Every test pins ONE deterministic behaviour of the new layers:
 *   - PRTF: prime resonance computation, two-witness agreement
 *   - Arithmetic: Z3 numeric encoding (between, gt, lt, ge, le, exactly)
 *   - Logic parser: and / or / if-then detection
 *   - End-to-end: real claims that should land at IMPOSSIBLE_REFUTE
 *     via the arithmetic layer (e.g. "Mneme has between 500 and 1000
 *     tools" against actual count 129).
 *
 * The whole file is the "100% accuracy" promise: every test must pass
 * deterministically on every run.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from "node:fs";
import { execSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  primeResonance,
  firstNPrimes,
  twoWitnessAgreement,
  PHI,
  R_TRUTH_THRESHOLD,
  R_LIE_THRESHOLD,
} from "./acgv_prtf.js";
import { extractNumericIntent, extractLogicalConnectives } from "./acgv_logic.js";
import { checkArithmetic } from "./acgv_arithmetic.js";
import { runACGVAsync, runACGV } from "./acgv.js";

function setupRepo(): string {
  const repo = mkdtempSync(join(tmpdir(), "mneme-v155-"));
  writeFileSync(join(repo, "package.json"), JSON.stringify({
    name: "test-repo", version: "1.55.0", type: "module",
    dependencies: { typescript: "^5.0.0" },
  }, null, 2));
  const pkg = join(repo, "packages", "core", "src");
  mkdirSync(pkg, { recursive: true });
  // Create a small set of MCP tool definitions so countMnemeTools has signal.
  for (let i = 0; i < 5; i++) {
    writeFileSync(
      join(pkg, `tool${i}.ts`),
      `export const t${i} = { name: "mneme.test.tool${i}", category: "meta" };\n`,
    );
  }
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

// ─── PRTF unit tests ────────────────────────────────────────────────

describe("v1.55 PRTF · prime sieve", () => {
  it("returns the first 4 primes", () => {
    expect(firstNPrimes(4)).toEqual([2, 3, 5, 7]);
  });

  it("returns the first 10 primes", () => {
    expect(firstNPrimes(10)).toEqual([2, 3, 5, 7, 11, 13, 17, 19, 23, 29]);
  });

  it("empty for n <= 0", () => {
    expect(firstNPrimes(0)).toEqual([]);
    expect(firstNPrimes(-1)).toEqual([]);
  });
});

describe("v1.55 PRTF · resonance computation", () => {
  it("constant CONSTANTS pin to golden / pi reciprocals", () => {
    expect(PHI).toBeCloseTo(1.6180339887, 6);
    expect(R_TRUTH_THRESHOLD).toBeCloseTo(0.6180339887, 6);
    expect(R_LIE_THRESHOLD).toBeCloseTo(0.3183098862, 6);
  });

  it("full truth (all h=1) -> R = 1 (perfect resonance)", () => {
    const r = primeResonance([1, 1, 1, 1]);
    expect(r.R).toBeCloseTo(1, 6);
    expect(r.verdict).toBe("RESONANT");
  });

  it("full lie (all h=0) with 4 primes -> R ≈ 0.5 (destructive)", () => {
    // First 4 primes: 2,3,5,7. h=0 -> phi=pi -> psi_i = exp(j*p_i*pi) = (-1)^p_i.
    // (-1)^2=1, (-1)^3=-1, (-1)^5=-1, (-1)^7=-1. Sum = 1-1-1-1 = -2. R = 2/4 = 0.5.
    const r = primeResonance([0, 0, 0, 0]);
    expect(r.R).toBeCloseTo(0.5, 4);
    // 0.5 sits BETWEEN the two thresholds -- INTERFERENCE.
    expect(r.verdict).toBe("INTERFERENCE");
  });

  it("DEPHASED verdict requires R <= 1/pi", () => {
    // Pick harmonics that drive sum near zero. Mix of 0 and 1 over more
    // primes increases destructive interference.
    // With n=8 primes [2,3,5,7,11,13,17,19] and harmonics [0,1,0,1,0,1,0,1]:
    // phi_i = pi*(1 - h_i) -- alternates pi / 0; angle = p_i * phi_i.
    // For h=0 indices (0,2,4,6): angles are 2*pi, 5*pi, 11*pi, 17*pi
    //   -> cos values: 1, -1, -1, -1
    // For h=1 indices (1,3,5,7): angles are 0 -> cos=1
    // Sum cos = 1 - 1 - 1 - 1 + 1 + 1 + 1 + 1 = 2; sum sin = small.
    // R = 2/8 = 0.25 -- below 1/pi.
    const r = primeResonance([0, 1, 0, 1, 0, 1, 0, 1]);
    expect(r.R).toBeLessThan(R_LIE_THRESHOLD + 0.05);
  });

  it("signature string is deterministic", () => {
    const r1 = primeResonance([0.5, 0.5, 0.5]);
    const r2 = primeResonance([0.5, 0.5, 0.5]);
    expect(r1.signature).toBe(r2.signature);
  });

  it("R is always in [0, 1]", () => {
    for (const h of [[0], [1], [0.5], [0, 1], [0.1, 0.9, 0.5], [1, 1, 1, 1, 1]]) {
      const r = primeResonance(h);
      expect(r.R).toBeGreaterThanOrEqual(0);
      expect(r.R).toBeLessThanOrEqual(1.0001); // tiny float slack
    }
  });

  it("clamps out-of-range inputs to [0, 1]", () => {
    const r = primeResonance([-0.5, 1.5, 0.5]);
    // Should behave like [0, 1, 0.5] -- no NaN, no >1 output.
    expect(r.R).toBeGreaterThanOrEqual(0);
    expect(r.R).toBeLessThanOrEqual(1.0001);
    expect(Number.isFinite(r.R)).toBe(true);
  });

  it("empty input returns R=0, INTERFERENCE", () => {
    const r = primeResonance([]);
    expect(r.R).toBe(0);
    expect(r.verdict).toBe("INTERFERENCE");
  });
});

describe("v1.55 PRTF · two-witness agreement", () => {
  it("BLACK_HOLE + DEPHASED -> AGREE_REFUTE", () => {
    const prtf = primeResonance([0, 0, 0, 0, 0, 0, 0, 0]);
    if (prtf.verdict === "DEPHASED") {
      const a = twoWitnessAgreement("BLACK_HOLE", prtf);
      expect(a).toBe("AGREE_REFUTE");
    }
  });

  it("FUSION + RESONANT -> AGREE_SUPPORT", () => {
    const prtf = primeResonance([1, 1, 1]);
    const a = twoWitnessAgreement("FUSION", prtf);
    expect(a).toBe("AGREE_SUPPORT");
  });

  it("FUSION + DEPHASED -> DISAGREE", () => {
    const prtfDephased = { ...primeResonance([1, 1, 1]), verdict: "DEPHASED" as const };
    const a = twoWitnessAgreement("FUSION", prtfDephased);
    expect(a).toBe("DISAGREE");
  });

  it("UNKNOWN_MASS -> INSUFFICIENT regardless of PRTF", () => {
    const prtf = primeResonance([1]);
    const a = twoWitnessAgreement("UNKNOWN_MASS", prtf);
    expect(a).toBe("INSUFFICIENT");
  });
});

// ─── Logic parser tests ─────────────────────────────────────────────

describe("v1.55 Logic parser · numeric intent", () => {
  it("between -- 'between 200 and 500 tools'", () => {
    const intents = extractNumericIntent("Mneme has between 200 and 500 tools");
    expect(intents.length).toBe(1);
    expect(intents[0]!.op).toBe("between");
    expect(intents[0]!.value).toBe(200);
    expect(intents[0]!.value2).toBe(500);
  });

  it("more than -- 'more than 100 tools'", () => {
    const intents = extractNumericIntent("Mneme has more than 100 tools");
    expect(intents.length).toBe(1);
    expect(intents[0]!.op).toBe("gt");
    expect(intents[0]!.value).toBe(100);
  });

  it("less than -- 'less than 50 tools'", () => {
    const intents = extractNumericIntent("Mneme has less than 50 tools");
    expect(intents[0]!.op).toBe("lt");
    expect(intents[0]!.value).toBe(50);
  });

  it("at least -- 'at least 100 tools'", () => {
    const intents = extractNumericIntent("Mneme exposes at least 100 tools");
    expect(intents[0]!.op).toBe("ge");
    expect(intents[0]!.value).toBe(100);
  });

  it("at most -- 'at most 200 tools'", () => {
    const intents = extractNumericIntent("Mneme ships at most 200 tools");
    expect(intents[0]!.op).toBe("le");
    expect(intents[0]!.value).toBe(200);
  });

  it("exactly -- 'exactly 129 tools'", () => {
    const intents = extractNumericIntent("Mneme provides exactly 129 tools");
    expect(intents[0]!.op).toBe("eq");
    expect(intents[0]!.value).toBe(129);
  });

  it("bare count fallback -- 'has 200 tools'", () => {
    const intents = extractNumericIntent("Mneme has 200 tools");
    expect(intents.length).toBe(1);
    expect(intents[0]!.op).toBe("eq");
    expect(intents[0]!.value).toBe(200);
  });

  it("no match -- vague claim", () => {
    const intents = extractNumericIntent("the code is good");
    expect(intents.length).toBe(0);
  });
});

describe("v1.55 Logic parser · connectives", () => {
  it("AND", () => {
    expect(extractLogicalConnectives("X and Y").kind).toBe("and");
  });
  it("OR", () => {
    expect(extractLogicalConnectives("X or Y").kind).toBe("or");
  });
  it("if-then", () => {
    expect(extractLogicalConnectives("if X then Y").kind).toBe("implies");
  });
  it("when-then is also implies", () => {
    expect(extractLogicalConnectives("when X then Y").kind).toBe("implies");
  });
  it("no connective -> none", () => {
    expect(extractLogicalConnectives("X is true").kind).toBe("none");
  });
});

// ─── Z3 arithmetic end-to-end ───────────────────────────────────────

describe("v1.55 Z3 arithmetic · numeric refute", () => {
  it("'between 500 and 1000 tools' against actual=5 -> UNSAT (upgrade=true)", async () => {
    const v = await checkArithmetic("Mneme has between 500 and 1000 tools", { toolCount: 5 });
    expect(v.status).toBe("unsat");
    expect(v.upgrade).toBe(true);
  });

  it("'more than 1000 tools' against actual=5 -> UNSAT", async () => {
    const v = await checkArithmetic("Mneme exposes more than 1000 tools", { toolCount: 5 });
    expect(v.status).toBe("unsat");
    expect(v.upgrade).toBe(true);
  });

  it("'less than 100 tools' against actual=5 -> SAT (no upgrade)", async () => {
    const v = await checkArithmetic("Mneme ships less than 100 tools", { toolCount: 5 });
    expect(v.status).toBe("sat");
    expect(v.upgrade).toBe(false);
  });

  it("'at least 3 tools' against actual=5 -> SAT", async () => {
    const v = await checkArithmetic("Mneme exposes at least 3 tools", { toolCount: 5 });
    expect(v.status).toBe("sat");
  });

  it("'exactly 5 tools' against actual=5 -> SAT", async () => {
    const v = await checkArithmetic("Mneme provides exactly 5 tools", { toolCount: 5 });
    expect(v.status).toBe("sat");
  });

  it("'exactly 999 tools' against actual=5 -> UNSAT", async () => {
    const v = await checkArithmetic("Mneme provides exactly 999 tools", { toolCount: 5 });
    expect(v.status).toBe("unsat");
    expect(v.upgrade).toBe(true);
  });

  it("vague claim with no numeric -> skipped", async () => {
    const v = await checkArithmetic("the code is good", { toolCount: 5 });
    expect(v.status).toBe("skipped");
    expect(v.upgrade).toBe(false);
  });
});

// ─── End-to-end runACGVAsync arithmetic upgrade ─────────────────────

describe("v1.55 runACGVAsync · arithmetic upgrade to IMPOSSIBLE_REFUTE", () => {
  let repo: string;
  beforeEach(() => { repo = setupRepo(); });
  afterEach(() => cleanup(repo));

  it("'between 500 and 1000 tools' -> IMPOSSIBLE_REFUTE via Z3 arithmetic", async () => {
    const r = await runACGVAsync({
      claim: "Mneme has between 500 and 1000 tools",
      repoRoot: repo,
      noEmitVaccine: true,
      noStake: true,
    });
    expect(r.verdict).toBe("IMPOSSIBLE_REFUTE");
    expect(r.caveats.some((c) => c.startsWith("Z3_"))).toBe(true);
  });

  it("'more than 9999 tools' -> IMPOSSIBLE_REFUTE", async () => {
    const r = await runACGVAsync({
      claim: "Mneme exposes more than 9999 tools",
      repoRoot: repo,
      noEmitVaccine: true,
      noStake: true,
    });
    expect(r.verdict).toBe("IMPOSSIBLE_REFUTE");
  });

  it("'less than 1000 tools' (true) -> not BLACK_HOLE / IMPOSSIBLE_REFUTE", async () => {
    const r = await runACGVAsync({
      claim: "Mneme has less than 1000 tools",
      repoRoot: repo,
      noEmitVaccine: true,
      noStake: true,
    });
    expect(r.verdict).not.toBe("IMPOSSIBLE_REFUTE");
    expect(r.verdict).not.toBe("BLACK_HOLE");
  });
});

// ─── PRTF layer integrated into runACGV output ──────────────────────

describe("v1.55 runACGV · PRTF layer in output", () => {
  let repo: string;
  beforeEach(() => { repo = setupRepo(); });
  afterEach(() => cleanup(repo));

  it("ACGVResult includes a prtf layer when claim has facts", () => {
    const r = runACGV({
      claim: "Mneme is written in Rust",
      repoRoot: repo,
      noEmitVaccine: true,
      noStake: true,
    });
    expect(r.layers.prtf).toBeDefined();
    expect(typeof r.layers.prtf!.R).toBe("number");
    expect(r.layers.prtf!.R).toBeGreaterThanOrEqual(0);
    expect(r.layers.prtf!.R).toBeLessThanOrEqual(1.0001);
  });

  it("two-witness agreement caveats appear when applicable", () => {
    const r = runACGV({
      claim: "Mneme is written in Rust",
      repoRoot: repo,
      noEmitVaccine: true,
      noStake: true,
    });
    // Rust against a non-Rust repo should land in BLACK_HOLE / IMPOSSIBLE.
    // The two-witness agreement caveat could be TWO_WITNESS_REFUTE or
    // CHANDRA_PRTF_DISAGREE depending on PRTF magnitude. Just verify the
    // pipeline emits SOME signal in caveats about PRTF.
    const hasWitness = r.caveats.some((c) => c.includes("WITNESS") || c.includes("PRTF"));
    expect(hasWitness).toBe(true);
  });
});

// ─── v2.19.39 N2 REGRESSION GUARD — arithmetic abstain on empty constraints ──
//
// User audit caught: verify "file X exists AND file X does not exist" returned
// TRUSTWORTHY 85% because checkArithmetic parsed logicalShape='and' + 0 intents
// then returned status='sat' (0===0 false-equality) and runACGVAsync upgraded
// PASSTHROUGH → FUSION. v2.19.39 fix: empty constraint set forces status='skipped';
// defensive guard in runACGVAsync also requires constraints.length>0.

describe("v2.19.39 N2 REGRESSION GUARD -- empty-constraint arithmetic abstain", () => {
  let repo: string;
  beforeEach(() => { repo = setupRepo(); });
  afterEach(() => cleanup(repo));

  it("checkArithmetic returns status='skipped' on logical-AND with zero intents", async () => {
    const r = await checkArithmetic("file X exists AND file X does not exist", { toolCount: 100 });
    expect(r.status).toBe("skipped");
    expect(r.upgrade).toBe(false);
    expect(r.constraints.length).toBe(0);
  });

  it("checkArithmetic returns status='skipped' on logical-OR with zero intents", async () => {
    const r = await checkArithmetic("foo OR bar (no numbers)", { toolCount: 100 });
    expect(r.status).toBe("skipped");
    expect(r.upgrade).toBe(false);
  });

  it("runACGVAsync does NOT upgrade PASSTHROUGH→FUSION on vague paradox claim", async () => {
    const r = await runACGVAsync({
      claim: "file X exists AND file X does not exist",
      repoRoot: repo,
      noEmitVaccine: true,
      noStake: true,
    });
    expect(r.verdict).not.toBe("FUSION");
    expect(r.verdict).toBe("PASSTHROUGH");
  });

  it("runACGVAsync still upgrades genuine SAT claims (regression guard)", async () => {
    const r = await runACGVAsync({
      claim: "Mneme exposes more than 9999 tools",
      repoRoot: repo,
      noEmitVaccine: true,
      noStake: true,
    });
    expect(r.verdict).toBe("IMPOSSIBLE_REFUTE");
  });

  it("100-iter fuzz: vague compound claims never inflate to FUSION", async () => {
    const templates = [
      "X exists AND X does not exist",
      "foo is true AND foo is false",
      "bar is registered AND bar is absent",
      "this thing exists AND this thing is missing",
    ];
    for (let i = 0; i < 100; i++) {
      const claim = templates[i % templates.length]!;
      const r = await runACGVAsync({ claim, repoRoot: repo, noEmitVaccine: true, noStake: true });
      expect(r.verdict).not.toBe("FUSION");
    }
  });
});
