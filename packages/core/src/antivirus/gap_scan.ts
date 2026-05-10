/**
 * MNEME ANTIVIRUS GAP-SCAN (v1.27.8) -- automatic pharmacopoeia
 * coverage evaluation using the user's OWN repo as ground truth.
 *
 * The wild idea: an antivirus can only catch what its vaccine library
 * knows about. Most antiviruses ship a static signature DB that drifts
 * out of date. Mneme antivirus does better -- it can audit ITSELF
 * against ground truth that ALREADY EXISTS in your repo:
 *
 *   - Real git commit SHAs from `git log` (citatio_viridis ground truth)
 *   - Real package.json deps (depends_imaginarium ground truth)
 *   - Real file paths from `git ls-files` (structura_invenita ground truth)
 *   - Real author names from `git log` (persona_fictum ground truth)
 *
 * For each strain, gap-scan synthesises:
 *
 *   POSITIVES (must catch):  mutated copies of real entities
 *     -- e.g. real SHA "a3f9b21..." -> "a3f9b22..." (1 char swapped)
 *        Should be flagged as phantom (the swap doesn't exist).
 *
 *   NEGATIVES (must NOT catch):  real entities verbatim
 *     -- e.g. real SHA "a3f9b21..." used in a sentence
 *        Should NOT be flagged (it does exist).
 *
 * Then runs the strain's vaccine against the synthetic test set and
 * reports per-strain recall, precision, F1. A strain below 0.80 recall
 * triggers a "vaccine gap" report with recommendations.
 *
 * This is a RECURRING SELF-HEAL LOOP: the antivirus evaluates itself
 * against the repo's reality, surfaces gaps, lets the maintainer ship
 * sharper patterns. Closes the same loop EVOLVE closes for code,
 * but for the vaccine library itself.
 */

import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

import type { StrainId, SuspectClaim } from "./types.js";
import { SEED_VACCINES, buildCache } from "./vaccines.js";
import { bestEffortMutate } from "./mutators.js";
import { buildCalibrationReport, type CalibrationReport, type CalibrationCase } from "./calibration.js";

const ALL_VACCINES = SEED_VACCINES;

export interface GapTestCase {
  /** What the synthetic case is testing. */
  label: string;
  /** Surface text fed to the vaccine. */
  match: string;
  /** Should the vaccine flag this as infected? */
  shouldBeInfected: boolean;
}

export interface StrainGapReport {
  strain: StrainId;
  vaccineId: string;
  /** True positives: positives the vaccine correctly flagged as infected. */
  tp: number;
  /** True negatives: negatives the vaccine correctly left alone. */
  tn: number;
  /** False positives: negatives the vaccine WRONGLY flagged as infected. */
  fp: number;
  /** False negatives: positives the vaccine MISSED. */
  fn: number;
  precision: number | null;
  recall: number | null;
  f1: number | null;
  /** v1.28.0 -- calibration metrics (Brier + margin). */
  calibration: CalibrationReport;
  /** v1.28.0 -- the actual FN sample texts (for auto-synth). */
  fnSamples: string[];
  /** Human-readable diagnostic. */
  recommendation: string;
}

export interface GapScanReport {
  computedAt: string;
  groundTruthSize: { shas: number; deps: number; paths: number; authors: number };
  perStrain: StrainGapReport[];
  /** Strains with recall < 0.80 -- need attention. */
  gapStrains: StrainId[];
}

// ─── ground-truth collectors ────────────────────────────────────────────

function collectShas(repoRoot: string, limit = 50): string[] {
  try {
    const r = spawnSync("git", ["log", `-${limit}`, "--format=%H"], { cwd: repoRoot, encoding: "utf8", timeout: 5000 });
    if (r.status !== 0) return [];
    return (r.stdout ?? "").split("\n").map((s) => s.trim()).filter((s) => /^[0-9a-f]{40}$/.test(s));
  } catch { return []; }
}

function collectDeps(repoRoot: string): string[] {
  try {
    const pkg = JSON.parse(readFileSync(join(repoRoot, "package.json"), "utf8")) as {
      dependencies?: Record<string, string>; devDependencies?: Record<string, string>;
    };
    return [...Object.keys(pkg.dependencies ?? {}), ...Object.keys(pkg.devDependencies ?? {})];
  } catch { return []; }
}

function collectPaths(repoRoot: string, limit = 30): string[] {
  try {
    const r = spawnSync("git", ["ls-files"], { cwd: repoRoot, encoding: "utf8", timeout: 5000, maxBuffer: 50 * 1024 * 1024 });
    if (r.status !== 0) return [];
    const all = (r.stdout ?? "").split("\n").map((s) => s.trim()).filter(Boolean);
    return all.slice(0, limit);
  } catch { return []; }
}

// ─── synthetic test-set generators ──────────────────────────────────────

/** Mutate one character of the SHA so it becomes a phantom. */
function mutateSha(sha: string): string {
  if (sha.length < 7) return sha;
  const idx = Math.floor(sha.length / 2);
  const orig = sha[idx]!;
  const swapped = orig === "a" ? "b" : orig === "0" ? "9" : "a";
  return sha.slice(0, idx) + swapped + sha.slice(idx + 1);
}

/** Mutate a package name so it becomes phantom. */
function mutatePackage(pkg: string): string {
  if (pkg.startsWith("@")) {
    const slash = pkg.indexOf("/");
    if (slash > 0) return `${pkg.slice(0, slash)}/quickfix-${Math.floor(Math.random() * 100)}`;
  }
  return `${pkg}-phantom-${Math.floor(Math.random() * 100)}`;
}

/** Mutate a file path. */
function mutatePath(path: string): string {
  return path.replace(/\.(\w+)$/, "_phantom.$1");
}

export function buildGapCases(repoRoot: string): { strain: StrainId; cases: GapTestCase[] }[] {
  const shas = collectShas(repoRoot, 20);
  const deps = collectDeps(repoRoot);
  const paths = collectPaths(repoRoot, 15);

  // v1.28.0: use bestEffortMutate (5-family adversarial mutators) when
  // the entity is amenable; fall back to the trivial swap when not.
  // Each positive case is generated 2x -- once with the deterministic
  // simple mutator and once with bestEffortMutate -- to widen the
  // adversarial surface against the vaccine.
  function mutatePosCases<T>(
    items: T[],
    asText: (x: T) => string,
    simpleMutator: (x: T) => string,
    label: (m: string) => string,
  ): GapTestCase[] {
    const out: GapTestCase[] = [];
    let seed = 0;
    for (const item of items.slice(0, 5)) {
      const text = asText(item);
      const simple = simpleMutator(item);
      out.push({ label: label(simple), match: simple, shouldBeInfected: true });
      const adv = bestEffortMutate(text, seed++);
      if (adv && adv.mutated !== simple && adv.mutated !== text) {
        out.push({
          label: `${label(adv.mutated)} (mut=${adv.name})`,
          match: adv.mutated,
          shouldBeInfected: true,
        });
      }
    }
    return out;
  }

  return [
    {
      strain: "citatio_viridis",
      cases: [
        ...shas.slice(0, 5).map((sha): GapTestCase => ({
          label: `negative: real SHA ${sha.slice(0, 8)}...`,
          match: `commit ${sha}`,
          shouldBeInfected: false,
        })),
        ...mutatePosCases(
          shas,
          (sha) => sha,
          (sha) => `commit ${mutateSha(sha)}`,
          (m) => `positive: mutated SHA ${m.slice(0, 24)}...`,
        ),
      ],
    },
    {
      strain: "depends_imaginarium",
      cases: [
        ...deps.slice(0, 5).map((dep): GapTestCase => ({
          label: `negative: real dep ${dep}`,
          match: `from "${dep}"`,
          shouldBeInfected: false,
        })),
        ...mutatePosCases(
          deps,
          (dep) => dep,
          (dep) => `from "${mutatePackage(dep)}"`,
          (m) => `positive: phantom dep ${m}`,
        ),
      ],
    },
    {
      strain: "structura_invenita",
      cases: [
        ...paths.slice(0, 5).map((p): GapTestCase => ({
          label: `negative: real path ${p}`,
          match: p,
          shouldBeInfected: false,
        })),
        ...mutatePosCases(
          paths,
          (p) => p,
          mutatePath,
          (m) => `positive: mutated path ${m}`,
        ),
      ],
    },
  ];
}

// ─── vaccine evaluation ─────────────────────────────────────────────────

async function evaluateStrain(
  repoRoot: string,
  strain: StrainId,
  cases: GapTestCase[],
): Promise<StrainGapReport> {
  const emptyCal = buildCalibrationReport([]);
  const vaccine = ALL_VACCINES.find((v) => v.strain === strain);
  if (!vaccine || cases.length === 0) {
    return {
      strain, vaccineId: vaccine?.id ?? "(none)",
      tp: 0, tn: 0, fp: 0, fn: 0,
      precision: null, recall: null, f1: null,
      calibration: emptyCal, fnSamples: [],
      recommendation: vaccine ? "no test cases (insufficient ground truth)" : "no vaccine for this strain",
    };
  }
  const cache = buildCache(repoRoot);
  let tp = 0, tn = 0, fp = 0, fn = 0;
  const fnSamples: string[] = [];
  const calCases: CalibrationCase[] = [];
  for (const c of cases) {
    const claim: SuspectClaim = { strain, match: c.match, offset: 0, surfaceConfidence: 0.7 };
    let infected = false;
    let confidence = 0.5;
    try {
      const r = await vaccine.assay(claim, { repoRoot, cache });
      infected = r.infected;
      // Vaccines today return boolean, not probability. Map: infected
      // = 0.85 (high but not perfect), clean = 0.15. Future vaccines
      // can supply graded confidence directly.
      confidence = infected ? 0.85 : 0.15;
    }
    catch { infected = false; confidence = 0.5; }
    calCases.push({ confidence, actual: c.shouldBeInfected });
    if (c.shouldBeInfected && infected) tp++;
    else if (!c.shouldBeInfected && !infected) tn++;
    else if (!c.shouldBeInfected && infected) fp++;
    else { fn++; fnSamples.push(c.match); }   // capture FN samples for auto-synth
  }
  const precision = tp + fp === 0 ? null : tp / (tp + fp);
  const recall = tp + fn === 0 ? null : tp / (tp + fn);
  const f1 = precision != null && recall != null && precision + recall > 0
    ? 2 * (precision * recall) / (precision + recall) : null;
  const calibration = buildCalibrationReport(calCases);
  let recommendation = "ok";
  if (recall != null && recall < 0.80) {
    recommendation = `LOW RECALL ${(recall * 100).toFixed(0)}%: vaccine misses real-world phantoms. Try \`mneme antivirus synthesize ${strain}\` to auto-generate patterns from the ${fnSamples.length} FN samples.`;
  } else if (precision != null && precision < 0.80) {
    recommendation = `LOW PRECISION ${(precision * 100).toFixed(0)}%: vaccine flags false positives. Tighten the assay in vaccines.ts:VAC_${strain.toUpperCase()}.`;
  }
  return { strain, vaccineId: vaccine.id, tp, tn, fp, fn, precision, recall, f1, calibration, fnSamples, recommendation };
}

/**
 * Run a complete gap scan. Returns per-strain F1 + a list of strains
 * with recall below 0.80 (the "gap strains" maintainer should fix).
 */
export async function gapScan(repoRoot: string): Promise<GapScanReport> {
  const buckets = buildGapCases(repoRoot);
  const perStrain: StrainGapReport[] = [];
  for (const b of buckets) {
    perStrain.push(await evaluateStrain(repoRoot, b.strain, b.cases));
  }
  const gapStrains = perStrain
    .filter((p) => p.recall != null && p.recall < 0.80)
    .map((p) => p.strain);

  // Ground-truth size for the report header.
  const groundTruthSize = {
    shas: collectShas(repoRoot, 1000).length,
    deps: collectDeps(repoRoot).length,
    paths: collectPaths(repoRoot, 10000).length,
    authors: 0, // not used yet
  };

  return {
    computedAt: new Date().toISOString(),
    groundTruthSize,
    perStrain,
    gapStrains,
  };
}
