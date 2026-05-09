/**
 * Mneme Antivirus -- benchmark harness.
 *
 * Runs every vaccine against its labeled benchmark cases, computes
 * precision/recall/F1, signs the result table with HMAC-SHA256 keyed by
 * the repo's identity, and persists per-vaccine reports under
 * .mneme/antivirus/benchmarks/<vaccine_id>.json.
 *
 * The signature makes results VERIFIABLE: anyone can recompute the HMAC
 * over (vaccine_id, version, ranAt, totalCases, tp, tn, fp, fn) and
 * confirm Mneme didn't lie about an efficacy score.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { createHmac, randomBytes } from "node:crypto";
import type { Vaccine, VaccineEfficacy, BenchmarkCase, VaccineCache } from "./types.js";
import { SEED_VACCINES, buildCache } from "./vaccines.js";
import { extractSuspects } from "./scan.js";
import { BENCHMARK_CASES } from "./benchmark_cases.js";

const BENCH_DIR = ".mneme/antivirus/benchmarks";
const SECRET_FILE = ".mneme/antivirus/.bench-secret";

function ensureBenchSecret(repoRoot: string): Buffer {
  const path = join(repoRoot, SECRET_FILE);
  if (existsSync(path)) {
    return Buffer.from(readFileSync(path, "utf8").trim(), "hex");
  }
  // 32 bytes of entropy per repo; persists across runs so signatures are stable.
  const buf = randomBytes(32);
  ensureBenchDir(repoRoot);
  writeFileSync(path, buf.toString("hex"), "utf8");
  return buf;
}

function ensureBenchDir(repoRoot: string): void {
  const dir = join(repoRoot, BENCH_DIR);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
}

function signEfficacy(eff: Omit<VaccineEfficacy, "signature">, vaccine: Vaccine, secret: Buffer): string {
  const payload = JSON.stringify({
    vaccine: vaccine.id, version: vaccine.version,
    ranAt: eff.ranAt, totalCases: eff.totalCases,
    tp: eff.tp, tn: eff.tn, fp: eff.fp, fn: eff.fn,
  });
  return createHmac("sha256", secret).update(payload).digest("hex").slice(0, 32);
}

/** Verify a recorded efficacy signature (used by tests + the cert ledger). */
export function verifyEfficacySignature(eff: VaccineEfficacy, vaccine: Vaccine, secret: Buffer): boolean {
  const expected = signEfficacy(eff, vaccine, secret);
  return expected === eff.signature;
}

/** Run a single vaccine through its benchmark cases. Honest pass/fail. */
export async function runBenchmark(
  repoRoot: string,
  vaccine: Vaccine,
  options: { cache?: VaccineCache } = {},
): Promise<VaccineEfficacy> {
  const cases = (BENCHMARK_CASES[vaccine.strain] ?? []) as BenchmarkCase[];
  if (cases.length === 0) {
    // No labeled cases yet -- return an honest zero-score record so the
    // ledger shows "unverified" rather than fake-100%.
    const ranAt = new Date().toISOString();
    const efficacy: VaccineEfficacy = {
      totalCases: 0, tp: 0, tn: 0, fp: 0, fn: 0,
      precision: null, recall: null, f1: null,
      ranAt, signature: "",
    };
    efficacy.signature = signEfficacy(efficacy, vaccine, ensureBenchSecret(repoRoot));
    return efficacy;
  }

  const cache = options.cache ?? buildCache(repoRoot);
  let tp = 0, tn = 0, fp = 0, fn = 0;
  for (const c of cases) {
    // Extract suspects from this case's draft for the strain we care about.
    const suspects = extractSuspects(c.draft).filter((s) => s.strain === vaccine.strain);
    let caughtAny = false;
    if (suspects.length > 0) {
      // Side-channel for cycle detector
      (globalThis as { __mnemeCurrentDraft?: string }).__mnemeCurrentDraft = c.draft;
      for (const s of suspects) {
        try {
          const r = await vaccine.assay(s, { repoRoot, cache });
          if (r.infected) { caughtAny = true; break; }
        } catch { /* assay error counts as not-caught */ }
      }
    }
    if (c.expectedInfected && caughtAny) tp++;
    else if (c.expectedInfected && !caughtAny) fn++;
    else if (!c.expectedInfected && caughtAny) fp++;
    else tn++;
  }
  const precision = tp + fp === 0 ? null : tp / (tp + fp);
  const recall = tp + fn === 0 ? null : tp / (tp + fn);
  const f1 = (precision == null || recall == null || precision + recall === 0)
    ? null
    : (2 * precision * recall) / (precision + recall);
  const ranAt = new Date().toISOString();
  const eff: VaccineEfficacy = {
    totalCases: cases.length, tp, tn, fp, fn,
    precision, recall, f1,
    ranAt, signature: "",
  };
  eff.signature = signEfficacy(eff, vaccine, ensureBenchSecret(repoRoot));
  return eff;
}

/** Run benchmarks for every vaccine. Returns a map. Persists each result. */
export async function runAllBenchmarks(
  repoRoot: string,
  vaccines: Vaccine[] = SEED_VACCINES,
): Promise<Record<string, VaccineEfficacy>> {
  const cache = buildCache(repoRoot);
  ensureBenchDir(repoRoot);
  const out: Record<string, VaccineEfficacy> = {};
  for (const vac of vaccines) {
    const eff = await runBenchmark(repoRoot, vac, { cache });
    out[vac.id] = eff;
    try {
      writeFileSync(
        join(repoRoot, BENCH_DIR, `${vac.id}.json`),
        JSON.stringify({ vaccine: vac.id, version: vac.version, efficacy: eff }, null, 2),
        "utf8",
      );
    } catch { /* best-effort */ }
  }
  return out;
}

/** Read the most recent benchmark result for a vaccine, if any. */
export function readBenchmark(repoRoot: string, vaccineId: string): VaccineEfficacy | null {
  const path = join(repoRoot, BENCH_DIR, `${vaccineId}.json`);
  if (!existsSync(path)) return null;
  try {
    const data = JSON.parse(readFileSync(path, "utf8")) as { efficacy: VaccineEfficacy };
    return data.efficacy ?? null;
  } catch { return null; }
}
