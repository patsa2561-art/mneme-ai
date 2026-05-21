/**
 * v2.21.3 — EARTHQUAKE ALARM.
 *
 * "Silent-model-drift detector for AI vendor APIs."
 *
 * Every prod team has been bitten: Anthropic / OpenAI / Google ship
 * silent retrains + safety patches under live model names. Prompts
 * that worked yesterday fail today; no changelog, no notice.
 *
 * Earthquake Alarm continuously fingerprints vendor behaviour using
 * label-free quality metrics, computes a per-vendor baseline, and
 * fires a verdict (STABLE / DRIFTING / BROKEN) when the live
 * fingerprint diverges from baseline by more than a z-score threshold.
 *
 * INNOVATIONS
 *
 *   1. PHANTOM CANARY — probe content is arbitrary; the verdict is
 *      driven by behavioural FINGERPRINT, not answer correctness. This
 *      means you can probe with innocuous text (no labels, no truth
 *      database, no curated suite) and still detect drift.
 *
 *   2. 8-DIMENSIONAL BEHAVIOURAL FINGERPRINT — captures style, not
 *      semantics:
 *        responseLength     — total chars
 *        sentenceCount      — # of sentences
 *        sentenceCV         — coefficient of variation of sentence
 *                             lengths (style consistency signal)
 *        hedgeDensity       — count of hedges per 100 words
 *        absoluteDensity    — count of absolute markers per 100 words
 *        refusalDensity     — count of refusal markers per 100 words
 *        vocabEntropy       — Shannon entropy of word distribution
 *        markdownDensity    — count of markdown structures per 100 words
 *
 *   3. PER-DIMENSION Z-SCORE DRIFT — for each dimension compute
 *      z = (live - baselineMean) / baselineStdDev.  Any dim with
 *      |z| > BROKEN_Z → BROKEN.  Any dim with |z| > DRIFTING_Z but
 *      below BROKEN_Z → DRIFTING.  All others → STABLE.  More
 *      interpretable than a single Mahalanobis distance ("the AI got
 *      wordier by 3.2 sigma" vs "the fingerprint distance is 4.7").
 *
 *   4. ROLLING BASELINE — baseline is recomputed from the last N probes
 *      excluding the freshest M (so drift detection compares "this
 *      probe" against "what this vendor USED to do, last N-M ago").
 *      Drift-against-yesterday, not drift-against-startup.
 *
 *   5. VENDOR-AGNOSTIC askFn PATTERN — orchestrator takes a function
 *      that produces a response.  Users wire Anthropic SDK / OpenAI
 *      SDK / their own gateway.  No vendor lock-in.
 *
 * Composes with Mneme polygraph drift (CI gating), bounty Wilson-LB
 * (per-vendor trust band), super-nova experience pool (audit trail).
 */

import { existsSync, readFileSync, writeFileSync, appendFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { createHmac, randomBytes, createHash } from "node:crypto";
import { withSuperNova } from "../super_nova/index.js";

const DIR = ".mneme/earthquake";
const PROBES = "probes.jsonl";
const CONFIG = "config.json";
const ALERTS = "alerts.jsonl";
const KEY = "earthquake.key";

// ─── 1. CONFIG ─────────────────────────────────────────────────────────

export interface EarthquakeConfig {
  v: 1;
  /** Number of probes that anchor the baseline. */
  baselineWindow: number;
  /** Number of MOST-RECENT probes excluded from baseline (so live ≠ baseline). */
  baselineExcludeFresh: number;
  /** z-score threshold for DRIFTING verdict. */
  driftingZ: number;
  /** z-score threshold for BROKEN verdict (higher = more confident). */
  brokenZ: number;
}

const DEFAULTS: EarthquakeConfig = {
  v: 1,
  baselineWindow: 30,
  baselineExcludeFresh: 5,
  driftingZ: 2.0,
  brokenZ: 3.5,
};

function dir(repoRoot: string): string {
  const d = join(repoRoot, DIR);
  if (!existsSync(d)) mkdirSync(d, { recursive: true });
  return d;
}

function key(repoRoot: string): string {
  const d = dir(repoRoot);
  const p = join(d, KEY);
  if (existsSync(p)) return readFileSync(p, "utf8").trim();
  const k = randomBytes(32).toString("base64url");
  writeFileSync(p, k, "utf8");
  return k;
}

function sign(payload: string, k: string): string {
  return createHmac("sha256", k).update(payload).digest("base64url").slice(0, 22);
}

export function getConfig(repoRoot: string): EarthquakeConfig {
  const p = join(dir(repoRoot), CONFIG);
  if (!existsSync(p)) {
    writeFileSync(p, JSON.stringify(DEFAULTS, null, 2), "utf8");
    return { ...DEFAULTS };
  }
  try { return { ...DEFAULTS, ...JSON.parse(readFileSync(p, "utf8")) }; }
  catch { return { ...DEFAULTS }; }
}

export function setConfig(repoRoot: string, patch: Partial<EarthquakeConfig>): EarthquakeConfig {
  const cur = getConfig(repoRoot);
  const next = { ...cur, ...patch };
  writeFileSync(join(dir(repoRoot), CONFIG), JSON.stringify(next, null, 2), "utf8");
  return next;
}

// ─── 2. FINGERPRINT (8-dimensional) ────────────────────────────────────

export interface Fingerprint {
  responseLength: number;
  sentenceCount: number;
  sentenceCV: number;
  hedgeDensity: number;
  absoluteDensity: number;
  refusalDensity: number;
  vocabEntropy: number;
  markdownDensity: number;
}

export const FINGERPRINT_DIMS: (keyof Fingerprint)[] = [
  "responseLength", "sentenceCount", "sentenceCV",
  "hedgeDensity", "absoluteDensity", "refusalDensity",
  "vocabEntropy", "markdownDensity",
];

const HEDGE_TERMS = ["perhaps", "maybe", "might", "could be", "seems", "appears", "possibly", "i think", "i believe", "likely"];
const ABSOLUTE_TERMS = ["always", "never", "exactly", "definitely", "absolutely", "everyone", "nobody", "all of", "none of"];
const REFUSAL_TERMS = ["i can't", "i cannot", "i won't", "as an ai", "i'm not able to", "i don't", "i'm unable", "i shouldn't"];

function countOccurrences(text: string, terms: string[]): number {
  const lower = text.toLowerCase();
  let n = 0;
  for (const t of terms) {
    let idx = 0;
    while ((idx = lower.indexOf(t, idx)) !== -1) { n++; idx += t.length; }
  }
  return n;
}

function shannonEntropy(text: string): number {
  const words = text.toLowerCase().split(/[^a-z0-9']+/).filter((w) => w.length > 0);
  if (words.length === 0) return 0;
  const counts: Record<string, number> = {};
  for (const w of words) counts[w] = (counts[w] ?? 0) + 1;
  let H = 0;
  for (const k of Object.keys(counts)) {
    const p = counts[k]! / words.length;
    H -= p * Math.log2(p);
  }
  return H;
}

function countMarkdownStructures(text: string): number {
  let n = 0;
  // Headers (lines starting with #).
  n += (text.match(/^#{1,6}\s/gm) ?? []).length;
  // Bullets.
  n += (text.match(/^[\s]*[-*+]\s/gm) ?? []).length;
  // Numbered lists.
  n += (text.match(/^[\s]*\d+\.\s/gm) ?? []).length;
  // Code fences.
  n += (text.match(/```/g) ?? []).length / 2;
  // Inline code.
  n += (text.match(/`[^`\n]+`/g) ?? []).length;
  return n;
}

/** Compute the 8-dimensional fingerprint of a response text. Pure;
 *  deterministic for the same input. No external deps. */
export function fingerprint(text: string): Fingerprint {
  const length = text.length;
  // Split into sentences (rough — period/!/? terminators).
  const sentences = text.split(/[.!?]+\s+/).filter((s) => s.trim().length > 0);
  const sentenceCount = sentences.length;
  // CV of sentence lengths.
  let sentenceCV = 0;
  if (sentences.length >= 2) {
    const lens = sentences.map((s) => s.length);
    const mean = lens.reduce((s, v) => s + v, 0) / lens.length;
    if (mean > 0) {
      const variance = lens.reduce((s, v) => s + (v - mean) ** 2, 0) / lens.length;
      sentenceCV = Math.sqrt(variance) / mean;
    }
  }
  // Density metrics: per 100 words.
  const wordCount = text.split(/\s+/).filter((w) => w.length > 0).length;
  const per100 = wordCount > 0 ? 100 / wordCount : 0;
  const hedgeDensity = countOccurrences(text, HEDGE_TERMS) * per100;
  const absoluteDensity = countOccurrences(text, ABSOLUTE_TERMS) * per100;
  const refusalDensity = countOccurrences(text, REFUSAL_TERMS) * per100;
  const vocabEntropy = shannonEntropy(text);
  const markdownDensity = countMarkdownStructures(text) * per100;

  return {
    responseLength: length,
    sentenceCount,
    sentenceCV: Number(sentenceCV.toFixed(4)),
    hedgeDensity: Number(hedgeDensity.toFixed(4)),
    absoluteDensity: Number(absoluteDensity.toFixed(4)),
    refusalDensity: Number(refusalDensity.toFixed(4)),
    vocabEntropy: Number(vocabEntropy.toFixed(4)),
    markdownDensity: Number(markdownDensity.toFixed(4)),
  };
}

// ─── 3. PROBE LEDGER ───────────────────────────────────────────────────

export interface ProbeRecord {
  v: 1;
  id: string;
  ts: string;
  vendor: string;
  promptSha: string;
  fp: Fingerprint;
  sig: string;
}

function probesPath(repoRoot: string): string { return join(dir(repoRoot), PROBES); }

export interface RecordProbeOptions {
  vendor: string;
  prompt: string;
  response: string;
}

export function recordProbe(repoRoot: string, opts: RecordProbeOptions): ProbeRecord {
  const k = key(repoRoot);
  const ts = new Date().toISOString();
  const id = "pr_" + randomBytes(4).toString("hex");
  const promptSha = createHash("sha256").update(opts.prompt).digest("hex").slice(0, 32);
  const fp = fingerprint(opts.response);
  const canonical = `${ts}|${opts.vendor}|${promptSha}|${JSON.stringify(fp)}`;
  const sig = sign(canonical, k);
  const rec: ProbeRecord = { v: 1, id, ts, vendor: opts.vendor, promptSha, fp, sig };
  appendFileSync(probesPath(repoRoot), JSON.stringify(rec) + "\n", "utf8");
  return rec;
}

export function listProbes(repoRoot: string, vendor?: string): ProbeRecord[] {
  const p = probesPath(repoRoot);
  if (!existsSync(p)) return [];
  try {
    const all = readFileSync(p, "utf8").trim().split("\n").map((l) => { try { return JSON.parse(l) as ProbeRecord; } catch { return null; } }).filter((r): r is ProbeRecord => !!r);
    return vendor ? all.filter((r) => r.vendor === vendor) : all;
  } catch { return []; }
}

export function verifyProbe(repoRoot: string, r: ProbeRecord): boolean {
  const k = key(repoRoot);
  const canonical = `${r.ts}|${r.vendor}|${r.promptSha}|${JSON.stringify(r.fp)}`;
  return sign(canonical, k) === r.sig;
}

// ─── 4. BASELINE ────────────────────────────────────────────────────────

export interface DimStat { mean: number; stddev: number; n: number; }
export type BaselineStats = Record<keyof Fingerprint, DimStat>;

export interface Baseline {
  vendor: string;
  totalProbes: number;
  baselineProbes: number;
  stats: BaselineStats;
  /** Probes used for baseline (excluded the freshest baselineExcludeFresh). */
  baselineProbeIds: string[];
  generatedAt: string;
}

function computeStats(values: number[]): DimStat {
  if (values.length === 0) return { mean: 0, stddev: 0, n: 0 };
  const mean = values.reduce((s, v) => s + v, 0) / values.length;
  if (values.length === 1) return { mean, stddev: 0, n: 1 };
  const variance = values.reduce((s, v) => s + (v - mean) ** 2, 0) / values.length;
  return { mean, stddev: Math.sqrt(variance), n: values.length };
}

export function computeBaseline(repoRoot: string, vendor: string): Baseline | null {
  const cfg = getConfig(repoRoot);
  const all = listProbes(repoRoot, vendor);
  if (all.length === 0) return null;
  // Sort by ts ascending.
  all.sort((a, b) => a.ts.localeCompare(b.ts));
  // Drop the freshest baselineExcludeFresh; use the rest up to baselineWindow.
  const eligible = all.slice(0, Math.max(0, all.length - cfg.baselineExcludeFresh));
  const baseline = eligible.slice(-cfg.baselineWindow);
  const stats = {} as BaselineStats;
  for (const dim of FINGERPRINT_DIMS) {
    const vals = baseline.map((p) => p.fp[dim]);
    stats[dim] = computeStats(vals);
  }
  return {
    vendor,
    totalProbes: all.length,
    baselineProbes: baseline.length,
    stats,
    baselineProbeIds: baseline.map((p) => p.id),
    generatedAt: new Date().toISOString(),
  };
}

// ─── 5. DRIFT DETECTION ───────────────────────────────────────────────

export type DriftVerdict = "STABLE" | "DRIFTING" | "BROKEN" | "INSUFFICIENT_DATA";

export interface DriftReport {
  vendor: string;
  verdict: DriftVerdict;
  /** Aggregated max |z|-score across all dimensions. */
  maxZ: number;
  /** Per-dimension z-scores against baseline. */
  zScores: Partial<Record<keyof Fingerprint, number>>;
  /** Dimensions exceeding the DRIFTING threshold. */
  driftingDims: (keyof Fingerprint)[];
  /** Dimensions exceeding the BROKEN threshold. */
  brokenDims: (keyof Fingerprint)[];
  /** Number of recent probes used as "live". */
  liveProbes: number;
  /** Number of baseline probes. */
  baselineProbes: number;
  generatedAt: string;
  /** Plain-English explanation. */
  rationale: string;
}

/** The headline verb: compute drift verdict for a vendor. */
export async function detectDrift(repoRoot: string, vendor: string): Promise<DriftReport> {
  return withSuperNova(
    { verb: "mneme.earthquake.detect_drift", surface: "lib", repoRoot, vendor },
    async () => {
      const cfg = getConfig(repoRoot);
      const baseline = computeBaseline(repoRoot, vendor);
      if (!baseline || baseline.baselineProbes < 5) {
        return {
          vendor,
          verdict: "INSUFFICIENT_DATA",
          maxZ: 0, zScores: {}, driftingDims: [], brokenDims: [],
          liveProbes: 0,
          baselineProbes: baseline?.baselineProbes ?? 0,
          generatedAt: new Date().toISOString(),
          rationale: `INSUFFICIENT_DATA: need ≥ 5 baseline probes (have ${baseline?.baselineProbes ?? 0}). Run more \`mneme earthquake probe ...\` calls for this vendor.`,
        } as DriftReport;
      }
      // Live = the freshest baselineExcludeFresh probes.
      const all = listProbes(repoRoot, vendor);
      all.sort((a, b) => a.ts.localeCompare(b.ts));
      const live = all.slice(-cfg.baselineExcludeFresh);
      if (live.length === 0) {
        return {
          vendor, verdict: "INSUFFICIENT_DATA",
          maxZ: 0, zScores: {}, driftingDims: [], brokenDims: [],
          liveProbes: 0, baselineProbes: baseline.baselineProbes,
          generatedAt: new Date().toISOString(),
          rationale: "INSUFFICIENT_DATA: no live probes recorded yet.",
        } as DriftReport;
      }
      // For each dim: compute live mean → z-score against baseline.
      const zScores: Partial<Record<keyof Fingerprint, number>> = {};
      const driftingDims: (keyof Fingerprint)[] = [];
      const brokenDims: (keyof Fingerprint)[] = [];
      let maxZ = 0;
      for (const dim of FINGERPRINT_DIMS) {
        const liveVals = live.map((p) => p.fp[dim]);
        const liveMean = liveVals.reduce((s, v) => s + v, 0) / liveVals.length;
        const bMean = baseline.stats[dim].mean;
        const bStd = baseline.stats[dim].stddev;
        // Stddev floor: when baseline is identical across N probes (stddev=0),
        // a perfectly-constant vendor that suddenly differs IS extreme drift.
        // Use 5% of |mean| (or 0.05 absolute) as a noise floor so we never
        // divide by zero AND a real deviation registers as a large z-score.
        const bStdEff = Math.max(bStd, 0.05 * Math.abs(bMean), 0.05);
        if (bStdEff === 0 && liveMean === bMean) continue;
        const z = Math.abs((liveMean - bMean) / bStdEff);
        zScores[dim] = Number(z.toFixed(3));
        if (z > maxZ) maxZ = z;
        if (z > cfg.brokenZ) brokenDims.push(dim);
        else if (z > cfg.driftingZ) driftingDims.push(dim);
      }
      let verdict: DriftVerdict = "STABLE";
      if (brokenDims.length > 0) verdict = "BROKEN";
      else if (driftingDims.length > 0) verdict = "DRIFTING";
      const rationale = verdict === "BROKEN"
        ? `BROKEN: ${brokenDims.length} dim(s) over z=${cfg.brokenZ} threshold (${brokenDims.join(", ")}). The vendor's behavioural envelope has measurably shifted.`
        : verdict === "DRIFTING"
        ? `DRIFTING: ${driftingDims.length} dim(s) over z=${cfg.driftingZ} (${driftingDims.join(", ")}); none past BROKEN threshold yet. Watch.`
        : `STABLE: all dimensions within z=${cfg.driftingZ} of baseline.`;
      return {
        vendor, verdict,
        maxZ: Number(maxZ.toFixed(3)),
        zScores, driftingDims, brokenDims,
        liveProbes: live.length,
        baselineProbes: baseline.baselineProbes,
        generatedAt: new Date().toISOString(),
        rationale,
      } as DriftReport;
    },
    { tags: ["earthquake", "detect-drift"] },
  );
}

// ─── 6. ORCHESTRATED PROBE (with vendor-agnostic askFn) ────────────────

export interface RunProbeOptions {
  vendor: string;
  prompt: string;
  /** Caller-supplied function that produces a response. Vendor-agnostic. */
  ask: (prompt: string) => Promise<string>;
}

export async function runProbe(repoRoot: string, opts: RunProbeOptions): Promise<{ record: ProbeRecord; report: DriftReport }> {
  return withSuperNova(
    { verb: "mneme.earthquake.run_probe", surface: "lib", repoRoot, vendor: opts.vendor },
    async () => {
      const response = await opts.ask(opts.prompt);
      const record = recordProbe(repoRoot, { vendor: opts.vendor, prompt: opts.prompt, response });
      const report = await detectDrift(repoRoot, opts.vendor);
      // Emit an alert if BROKEN or DRIFTING.
      if (report.verdict === "BROKEN" || report.verdict === "DRIFTING") {
        try {
          appendFileSync(join(dir(repoRoot), ALERTS), JSON.stringify({
            ts: new Date().toISOString(),
            vendor: opts.vendor,
            verdict: report.verdict,
            maxZ: report.maxZ,
            brokenDims: report.brokenDims,
            driftingDims: report.driftingDims,
          }) + "\n", "utf8");
        } catch { /* */ }
      }
      return { record, report };
    },
    { tags: ["earthquake", "run-probe"] },
  );
}

export function listAlerts(repoRoot: string, vendor?: string): Array<Record<string, unknown>> {
  const p = join(dir(repoRoot), ALERTS);
  if (!existsSync(p)) return [];
  try {
    const all = readFileSync(p, "utf8").trim().split("\n").map((l) => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean) as Array<Record<string, unknown>>;
    return vendor ? all.filter((a) => a.vendor === vendor) : all;
  } catch { return []; }
}

// ─── FORMATTERS ────────────────────────────────────────────────────────

export function formatFingerprint(fp: Fingerprint): string {
  const lines: string[] = ["🚨 FINGERPRINT", ""];
  for (const dim of FINGERPRINT_DIMS) {
    lines.push(`  ${dim.padEnd(20)} ${fp[dim].toFixed(4)}`);
  }
  return lines.join("\n");
}

export function formatBaseline(b: Baseline): string {
  const lines: string[] = [`🚨 BASELINE for ${b.vendor}`, ``];
  lines.push(`  Total probes:    ${b.totalProbes}`);
  lines.push(`  Baseline probes: ${b.baselineProbes}`);
  lines.push(`  Generated:       ${b.generatedAt}`);
  lines.push(``);
  lines.push(`  ${"dimension".padEnd(20)} ${"mean".padStart(12)} ${"stddev".padStart(12)}`);
  for (const dim of FINGERPRINT_DIMS) {
    const s = b.stats[dim];
    lines.push(`  ${dim.padEnd(20)} ${s.mean.toFixed(4).padStart(12)} ${s.stddev.toFixed(4).padStart(12)}`);
  }
  return lines.join("\n");
}

export function formatReport(r: DriftReport): string {
  const badge = r.verdict === "BROKEN" ? "💥"
              : r.verdict === "DRIFTING" ? "⚡"
              : r.verdict === "STABLE" ? "✓"
              : "·";
  const lines: string[] = [
    `🚨 EARTHQUAKE DRIFT REPORT — ${badge} ${r.verdict}`,
    ``,
    `  Vendor:           ${r.vendor}`,
    `  Verdict:          ${r.verdict}`,
    `  Max |z|:          ${r.maxZ}`,
    `  Live probes:      ${r.liveProbes}`,
    `  Baseline probes:  ${r.baselineProbes}`,
    `  Rationale:        ${r.rationale}`,
    ``,
  ];
  if (Object.keys(r.zScores).length > 0) {
    lines.push(`  Per-dimension z-scores:`);
    for (const dim of FINGERPRINT_DIMS) {
      const z = r.zScores[dim];
      if (z === undefined) continue;
      const flag = r.brokenDims.includes(dim) ? "💥" : r.driftingDims.includes(dim) ? "⚡" : " ";
      lines.push(`    ${flag} ${dim.padEnd(20)} z=${z.toFixed(2)}`);
    }
  }
  return lines.join("\n");
}
