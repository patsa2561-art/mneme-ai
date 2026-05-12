/**
 * v1.65.0 -- APOPTOSIS PROTOCOL ORCHESTRATOR.
 *
 * Fires all 7 layers and computes the final verdict:
 *
 *   HEALTHY    -- 0 layers fail
 *   INFLAMED   -- 1 layer fails (warning)
 *   NECROTIC   -- 2-4 layers fail
 *   APOPTOTIC  -- 5+ layers fail (self-destruction; auto-vaccine)
 *
 * On APOPTOTIC: the claim is auto-promoted into the vaccine bank so
 * future identical-shape claims short-circuit at L3.
 *
 * Each layer reports its own latency; the orchestrator rolls up total.
 */

import { existsSync, mkdirSync, appendFileSync } from "node:fs";
import { join } from "node:path";
import { createHash } from "node:crypto";

import { fiveWitness, extractFacets, type FiveWitnessReport, type ClaimFacets } from "./witnesses.js";
import { semanticGround, type SemanticReport } from "./semantic_grounding.js";
import { bayesianPrior, type BayesianReport } from "./bayesian_prior.js";
import { temporalConsistency, type TemporalReport } from "./temporal_consistency.js";
import { humilityDensity, type HumilityReport } from "./epistemic_humility.js";
import { fractalDecompose, type FractalReport } from "./fractal_decompose.js";
import { acgvCascade, type ACGVCascadeReport } from "./acgv_cascade.js";

export type ApoptosisVerdict = "HEALTHY" | "INFLAMED" | "NECROTIC" | "APOPTOTIC";

export interface ApoptosisReport {
  claim: string;
  facets: ClaimFacets;
  verdict: ApoptosisVerdict;
  /** Number of layers that fired ALERT. */
  alerts: number;
  /** Number of layers that returned GROUNDED. */
  grounded: number;
  /** Confidence in the verdict (0..1). */
  confidence: number;
  /** Per-layer results. */
  layers: {
    L1_witnesses: FiveWitnessReport;
    L2_semantic: SemanticReport;
    L3_bayesian: BayesianReport;
    L4_temporal: TemporalReport;
    L5_humility: HumilityReport;
    L6_fractal: FractalReport;
    L7_acgv: ACGVCascadeReport;
  };
  /** Layer ids that alerted (e.g. ["L2_semantic", "L4_temporal"]). */
  alertingLayers: string[];
  /** Plain-English one-line headline. */
  headline: string;
  /** Multi-line briefing. */
  briefing: string;
  /** If APOPTOTIC and persist=true, this is the vaccine id minted. */
  vaccineMinted: string | null;
  /** Total elapsed ms. */
  ms: number;
}

const APOPTOSIS_DIR = ".mneme/apoptosis";

function persistAlert(repoRoot: string, report: ApoptosisReport): void {
  try {
    const dir = join(repoRoot, APOPTOSIS_DIR);
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
    appendFileSync(
      join(dir, "verdicts.jsonl"),
      JSON.stringify({
        ts: new Date().toISOString(),
        claim: report.claim.slice(0, 200),
        verdict: report.verdict,
        alerts: report.alerts,
        alertingLayers: report.alertingLayers,
        confidence: report.confidence,
        ms: report.ms,
      }) + "\n",
      "utf8",
    );
  } catch { /* */ }
}

function mintVaccine(repoRoot: string, claim: string, report: ApoptosisReport): string | null {
  try {
    const dir = join(repoRoot, ".mneme/squadron");
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
    const id = "apop-" + createHash("sha256").update(claim).digest("hex").slice(0, 16);
    const simhash = report.layers.L3_bayesian.topNeighbors[0]?.id
      ? "0000000000000000"
      : computeSimhash(claim);
    const row = {
      id,
      simhash,
      signature: "apoptosis",
      refuteCount: 1,
      firstSeen: new Date().toISOString(),
      lastSeen: new Date().toISOString(),
      sample: claim.slice(0, 300),
      source: "apoptosis-protocol",
      alertingLayers: report.alertingLayers,
    };
    appendFileSync(join(dir, "lie-vaccines.jsonl"), JSON.stringify(row) + "\n", "utf8");
    return id;
  } catch {
    return null;
  }
}

function computeSimhash(text: string): string {
  const tokens = (text.toLowerCase().match(/[a-z][a-z0-9_-]+/g) ?? []).filter((t) => t.length >= 3);
  if (tokens.length === 0) return "0".repeat(16);
  const vec = new Array(64).fill(0);
  for (const tok of tokens) {
    let h = 0xcbf29ce484222325n;
    for (let i = 0; i < tok.length; i++) {
      h ^= BigInt(tok.charCodeAt(i));
      h = (h * 0x100000001b3n) & 0xffffffffffffffffn;
    }
    for (let b = 0; b < 64; b++) {
      const bit = (h >> BigInt(b)) & 1n;
      vec[b] += bit === 1n ? 1 : -1;
    }
  }
  let out = 0n;
  for (let b = 0; b < 64; b++) {
    if (vec[b] > 0) out |= 1n << BigInt(b);
  }
  return out.toString(16).padStart(16, "0");
}

export interface ApoptosisOptions {
  /** Persist verdicts to disk. Default false. */
  persist?: boolean;
  /** Skip L7 ACGV cascade (heavy). Default false. */
  skipACGV?: boolean;
  /** Mint auto-vaccine on APOPTOTIC. Default true when persist=true. */
  autoVaccine?: boolean;
}

export function detect(repoRoot: string, claim: string, opts?: ApoptosisOptions): ApoptosisReport {
  const t0 = Date.now();
  const facets = extractFacets(claim);

  // L1 -- 5-witness
  const L1 = fiveWitness(repoRoot, claim, facets);
  // L2 -- semantic grounding
  const L2 = semanticGround(repoRoot, claim, facets.paths ?? []);
  // L3 -- bayesian
  const L3 = bayesianPrior(repoRoot, claim);
  // L4 -- temporal
  const L4 = temporalConsistency(repoRoot, claim);
  // L5 -- epistemic humility
  const L5 = humilityDensity(claim);
  // L6 -- fractal
  const L6 = fractalDecompose(repoRoot, claim);
  // L7 -- ACGV cascade
  const L7: ACGVCascadeReport = opts?.skipACGV
    ? { verdict: "INAPPLICABLE", acgvVerdict: "PASSTHROUGH", acgvConfidence: 0, caveats: [], summary: "(skipped)", detail: "ACGV cascade skipped.", ms: 0 }
    : acgvCascade(repoRoot, claim);

  // Compute aggregate.
  const layerResults = [
    { id: "L1_witnesses", verdict: L1.alerts > 0 ? "ALERT" : (L1.witnesses.some((w) => w.verdict === "GROUNDED") ? "GROUNDED" : "INAPPLICABLE") },
    { id: "L2_semantic", verdict: L2.verdict },
    { id: "L3_bayesian", verdict: L3.verdict },
    { id: "L4_temporal", verdict: L4.verdict },
    { id: "L5_humility", verdict: L5.verdict },
    { id: "L6_fractal", verdict: L6.verdict },
    { id: "L7_acgv", verdict: L7.verdict },
  ];
  const alertingLayers = layerResults.filter((l) => l.verdict === "ALERT").map((l) => l.id);
  const alerts = alertingLayers.length;
  const grounded = layerResults.filter((l) => l.verdict === "GROUNDED").length;
  const applicable = layerResults.filter((l) => l.verdict !== "INAPPLICABLE").length;

  let verdict: ApoptosisVerdict;
  if (alerts >= 5) verdict = "APOPTOTIC";
  else if (alerts >= 2) verdict = "NECROTIC";
  else if (alerts === 1) verdict = "INFLAMED";
  else verdict = "HEALTHY";

  // ACGV REFUTE short-circuit: if ACGV says AUTO/IMPOSSIBLE_REFUTE alone, escalate at least to NECROTIC.
  if ((L7.acgvVerdict === "IMPOSSIBLE_REFUTE" || L7.acgvVerdict === "AUTO_REFUTE") && verdict === "INFLAMED") {
    verdict = "NECROTIC";
  }

  const confidence = applicable === 0
    ? 0.5
    : verdict === "APOPTOTIC"
      ? Math.min(1, 0.85 + alerts * 0.03)
      : verdict === "NECROTIC"
        ? 0.65 + alerts * 0.05
        : verdict === "INFLAMED"
          ? 0.45
          : Math.min(1, 0.6 + grounded / applicable * 0.4);

  const headline = verdict === "HEALTHY"
    ? `HEALTHY -- ${grounded}/${applicable} layers grounded; claim appears truthful.`
    : verdict === "INFLAMED"
      ? `INFLAMED -- ${alertingLayers[0]} alerted; treat with mild caution.`
      : verdict === "NECROTIC"
        ? `NECROTIC -- ${alerts} layers detected fabrication signal: ${alertingLayers.join(", ")}.`
        : `APOPTOTIC -- claim self-destructs. ${alerts} layers refute: ${alertingLayers.join(", ")}.`;

  const briefingLines = [
    `## APOPTOSIS verdict: ${verdict}  (confidence ${confidence.toFixed(2)})`,
    ``,
    headline,
    ``,
    `### Per-layer`,
    `- **L1 5-Witness**: ${L1.alerts > 0 ? "ALERT" : "GROUNDED/INAPPLICABLE"} -- ${L1.unanimous ? "all witnesses agree" : `${L1.alerts} alert(s)`}`,
    `- **L2 Semantic**: ${L2.verdict} -- score ${L2.score.toFixed(3)} (threshold ~0.06)`,
    `- **L3 Bayesian**: ${L3.verdict} -- posterior ${L3.posterior.toFixed(3)} (${L3.topNeighbors.length} neighbors)`,
    `- **L4 Temporal**: ${L4.verdict} -- ${L4.pastClaims.length} prior overlapping claim(s)`,
    `- **L5 Humility**: ${L5.verdict} -- score ${L5.humilityScore.toFixed(2)} (${L5.hedgesFound.length} hedge, ${L5.absolutesFound.length} absolute)`,
    `- **L6 Fractal**: ${L6.verdict} -- ${L6.alertNodes}/${L6.totalNodes} sub-claims failed at depth-3`,
    `- **L7 ACGV**: ${L7.verdict} (${L7.acgvVerdict}) -- ${L7.summary}`,
    ``,
    `### Latencies`,
    `L1 ${L1.ms}ms · L2 ${L2.ms}ms · L3 ${L3.ms}ms · L4 ${L4.ms}ms · L5 ${L5.ms}ms · L6 ${L6.ms}ms · L7 ${L7.ms}ms`,
  ];

  const briefing = briefingLines.join("\n");

  const report: ApoptosisReport = {
    claim,
    facets,
    verdict,
    alerts,
    grounded,
    confidence,
    layers: { L1_witnesses: L1, L2_semantic: L2, L3_bayesian: L3, L4_temporal: L4, L5_humility: L5, L6_fractal: L6, L7_acgv: L7 },
    alertingLayers,
    headline,
    briefing,
    vaccineMinted: null,
    ms: Date.now() - t0,
  };

  let vaccineMinted: string | null = null;
  if (opts?.persist) {
    persistAlert(repoRoot, report);
    if (verdict === "APOPTOTIC" && opts.autoVaccine !== false) {
      vaccineMinted = mintVaccine(repoRoot, claim, report);
    }
  }
  report.vaccineMinted = vaccineMinted;

  return report;
}
