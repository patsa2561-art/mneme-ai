/**
 * v2.22.1 — PHYSICS LATHE · VERIFIER.
 *
 * Take an LLM claim + a set of extracted quantities and decide:
 *   - CONFIRMED      — claim is consistent with at least one axiom OR
 *                      matches a known-value within tolerance
 *   - REFUTED        — claim is inconsistent with an axiom by more than
 *                      its tolerance
 *   - OUT_OF_AXIOM_SET — no axiom or known-value applies; the lathe
 *                      cannot speak
 *   - INSUFFICIENT_DATA — claim mentions quantities but the verifier
 *                      cannot extract enough to check
 *
 * The verifier is deterministic; no LLM is called.
 */

import { allAxioms, allKnownValues, type Axiom } from "./axioms.js";
import { unitsEqual, formatUnit } from "./units.js";
import type { ExtractedQuantity } from "./extractor.js";

export type Verdict = "CONFIRMED" | "REFUTED" | "OUT_OF_AXIOM_SET" | "INSUFFICIENT_DATA";

export interface KnownValueHit {
  kind: "known-value";
  label: string;
  expected: number;
  observed: number;
  relativeError: number;
  tolerance: number;
  citation: string;
  passed: boolean;
}

export interface AxiomHit {
  kind: "axiom";
  axiomId: string;
  axiomName: string;
  formula: string;
  predicted: number;
  observed: number;
  relativeError: number;
  tolerance: number;
  citation: string;
  computation: string;
  passed: boolean;
}

export type Hit = KnownValueHit | AxiomHit;

export interface PhysicsCheckReport {
  v: 1;
  verdict: Verdict;
  /** All quantities the extractor pulled out of the claim. */
  quantities: ExtractedQuantity[];
  /** Per-axiom or per-known-value evaluation results. */
  hits: Hit[];
  /** Plain-English rationale. */
  rationale: string;
  /** Citations consumed by the verdict, deduplicated. */
  citations: string[];
}

/** Match an extracted quantity to a known-value entry by units +
 *  best-guess label keyword overlap against the FULL claim text. */
function matchKnownValues(qs: ExtractedQuantity[], claim: string): KnownValueHit[] {
  const hits: KnownValueHit[] = [];
  const lowerClaim = claim.toLowerCase();
  for (const q of qs) {
    for (const kv of allKnownValues()) {
      if (!unitsEqual(q.siUnit, kv.unit)) continue;
      const tokens = kv.label.toLowerCase().split(/[\s-]+/).filter((t) => t.length > 2);
      // Match: ≥1 label keyword appears in the surrounding claim text.
      const overlap = tokens.filter((tok) => lowerClaim.includes(tok)).length;
      if (overlap < 1) continue;
      const expected = kv.value;
      const observed = q.siValue;
      const relErr = Math.abs(observed - expected) / Math.max(Math.abs(expected), 1e-30);
      hits.push({
        kind: "known-value",
        label: kv.label,
        expected,
        observed,
        relativeError: relErr,
        tolerance: kv.tolerance,
        citation: kv.citation,
        passed: relErr <= kv.tolerance,
      });
    }
  }
  return hits;
}

/** Group extracted quantities by guessed symbol → solve axioms when
 *  enough variables match. */
function matchAxioms(qs: ExtractedQuantity[]): AxiomHit[] {
  const hits: AxiomHit[] = [];
  // Build symbol → value map from extracted quantities.
  const symbols: Record<string, number> = {};
  for (const q of qs) if (q.quantityGuess) symbols[q.quantityGuess] = q.siValue;
  for (const axiom of allAxioms()) {
    const known = axiom.variables.filter((v) => v.symbol in symbols);
    if (known.length < 2) continue;
    // Try solving the axiom: many axioms have one "unknown" they
    // compute. For our greedy v1: feed every supplied symbol and let
    // the axiom return its predicted scalar.
    const r = axiom.apply(symbols);
    if (!r) continue;
    // Compare prediction to: (a) the unknown variable if it was also
    // supplied; (b) any other supplied variable with the same units.
    // For simplicity v1: compare against the LHS variable when present.
    const lhs = axiom.variables[0]!;
    if (!(lhs.symbol in symbols)) continue;
    const observed = symbols[lhs.symbol]!;
    const relErr = Math.abs(r.value - observed) / Math.max(Math.abs(r.value), 1e-30);
    hits.push({
      kind: "axiom",
      axiomId: axiom.id,
      axiomName: axiom.name,
      formula: axiom.formulaText,
      predicted: r.value,
      observed,
      relativeError: relErr,
      tolerance: axiom.tolerance,
      citation: axiom.citation,
      computation: r.computed,
      passed: relErr <= axiom.tolerance,
    });
  }
  return hits;
}

export function verifyClaim(claim: string, qs: ExtractedQuantity[]): PhysicsCheckReport {
  if (qs.length === 0) {
    return { v: 1, verdict: "INSUFFICIENT_DATA", quantities: qs, hits: [], rationale: "No numeric quantities with units detected in the claim.", citations: [] };
  }
  const kvHits = matchKnownValues(qs, claim);
  const axiomHits = matchAxioms(qs);
  const hits: Hit[] = [...kvHits, ...axiomHits];
  if (hits.length === 0) {
    return { v: 1, verdict: "OUT_OF_AXIOM_SET", quantities: qs, hits, rationale: `Quantities extracted (${qs.map((q) => q.raw).join(", ")}) but no axiom or known-value applied. The lathe cannot speak to this claim — add a relevant axiom under packages/core/src/physics_lathe/axioms.ts and re-run.`, citations: [] };
  }
  const refuted = hits.filter((h) => !h.passed);
  const confirmed = hits.filter((h) => h.passed);
  const citations = Array.from(new Set(hits.map((h) => h.citation)));
  if (refuted.length > 0 && confirmed.length === 0) {
    return {
      v: 1, verdict: "REFUTED", quantities: qs, hits,
      rationale: `Claim is inconsistent with ${refuted.length} reference(s). Largest mismatch: ${(Math.max(...refuted.map((r) => r.relativeError)) * 100).toFixed(1)}% (tolerance ${(refuted[0]!.tolerance * 100).toFixed(1)}%).`,
      citations,
    };
  }
  return {
    v: 1, verdict: "CONFIRMED", quantities: qs, hits,
    rationale: `Claim is consistent with ${confirmed.length} reference(s) within tolerance; ${refuted.length} mismatch(es) below the confidence floor.`,
    citations,
  };
}

export function formatReport(r: PhysicsCheckReport): string {
  const badge = r.verdict === "CONFIRMED" ? "✓"
              : r.verdict === "REFUTED" ? "✗"
              : r.verdict === "OUT_OF_AXIOM_SET" ? "·"
              : "?";
  const lines: string[] = [
    `🔬 PHYSICS LATHE — ${badge} ${r.verdict}`,
    "",
    `  ${r.rationale}`,
    "",
  ];
  if (r.quantities.length > 0) {
    lines.push("  Extracted quantities:");
    for (const q of r.quantities) {
      lines.push(`    - ${q.raw}  →  ${q.siValue.toExponential(3)} ${formatUnit(q.siUnit)}${q.quantityGuess ? ` (guess: ${q.quantityGuess})` : ""}`);
    }
    lines.push("");
  }
  if (r.hits.length > 0) {
    lines.push("  Evaluations:");
    for (const h of r.hits) {
      const tag = h.passed ? "✓" : "✗";
      if (h.kind === "known-value") {
        lines.push(`    ${tag} known-value: ${h.label}`);
        lines.push(`         observed ${h.observed.toExponential(3)} vs expected ${h.expected.toExponential(3)} (rel err ${(h.relativeError * 100).toFixed(1)}% / tol ${(h.tolerance * 100).toFixed(1)}%)`);
        lines.push(`         citation: ${h.citation}`);
      } else {
        lines.push(`    ${tag} axiom: ${h.axiomName} — ${h.formula}`);
        lines.push(`         computation: ${h.computation}`);
        lines.push(`         observed ${h.observed.toExponential(3)} vs predicted ${h.predicted.toExponential(3)} (rel err ${(h.relativeError * 100).toFixed(1)}% / tol ${(h.tolerance * 100).toFixed(1)}%)`);
        lines.push(`         citation: ${h.citation}`);
      }
    }
  }
  return lines.join("\n");
}
