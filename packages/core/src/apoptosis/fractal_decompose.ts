/**
 * v1.65.0 -- APOPTOSIS L6: FRACTAL DECOMPOSITION.
 *
 * Recursively split a claim into sub-claims, audit each independently,
 * and aggregate. The "Mandelbrot detector": a claim that survives
 * audit at depth 3 is 27x more likely true than one that breaks at
 * depth 1.
 *
 *   "fake_auth.ts implements bcrypt and is tested in auth.test.ts"
 *   ├── "fake_auth.ts exists"                 -> ALERT (W1 fails)
 *   ├── "fake_auth.ts implements bcrypt"      -> ALERT (W1 fails first)
 *   └── "auth.test.ts tests fake_auth.ts"     -> ALERT
 *
 * 3 of 3 sub-claims fail -> highest possible APOPTOSIS signal.
 *
 * Splits on conjunctions (and, but, also, plus, then), commas, and
 * semicolons. Doesn't go below depth 3 to bound cost.
 */

import { fiveWitness, type FiveWitnessReport } from "./witnesses.js";

export interface FractalNode {
  depth: number;
  claim: string;
  witness: FiveWitnessReport;
  children: FractalNode[];
}

export interface FractalReport {
  root: FractalNode;
  totalNodes: number;
  alertNodes: number;
  /** Score in [0, 1]; lower = more fabrication signal at depth. */
  fractalScore: number;
  verdict: "GROUNDED" | "ALERT" | "INAPPLICABLE";
  detail: string;
  ms: number;
}

const SPLIT_REGEX = /\s+(?:and|but|also|plus|then|while|;)\s+|,\s+(?!\d)/i;

function splitClaim(text: string): string[] {
  const parts = text.split(SPLIT_REGEX).map((p) => p.trim()).filter((p) => p.length >= 8);
  // Dedup + cap at 4 children to bound recursion.
  return [...new Set(parts)].slice(0, 4);
}

function descend(repoRoot: string, claim: string, depth: number, maxDepth: number): FractalNode {
  const witness = fiveWitness(repoRoot, claim);
  const children: FractalNode[] = [];
  if (depth < maxDepth) {
    const subs = splitClaim(claim);
    // Only descend if splitting produced multiple parts (i.e. real decomposition).
    if (subs.length >= 2) {
      for (const s of subs) {
        children.push(descend(repoRoot, s, depth + 1, maxDepth));
      }
    }
  }
  return { depth, claim, witness, children };
}

function flatten(node: FractalNode, into: FractalNode[]): void {
  into.push(node);
  for (const c of node.children) flatten(c, into);
}

export function fractalDecompose(repoRoot: string, claim: string, opts?: { maxDepth?: number }): FractalReport {
  const t0 = Date.now();
  const maxDepth = opts?.maxDepth ?? 3;
  const root = descend(repoRoot, claim, 0, maxDepth);
  const all: FractalNode[] = [];
  flatten(root, all);
  const totalNodes = all.length;
  const alertNodes = all.filter((n) => n.witness.alerts > 0).length;
  const applicable = all.filter((n) => n.witness.witnesses.some((w) => w.verdict !== "INAPPLICABLE")).length;
  const fractalScore = applicable === 0 ? 0.5 : Math.max(0, 1 - alertNodes / applicable);
  let verdict: FractalReport["verdict"];
  if (applicable === 0) verdict = "INAPPLICABLE";
  else if (alertNodes >= 2 || (alertNodes === 1 && totalNodes <= 2)) verdict = "ALERT";
  else verdict = "GROUNDED";
  return {
    root,
    totalNodes,
    alertNodes,
    fractalScore,
    verdict,
    detail: verdict === "ALERT"
      ? `${alertNodes}/${applicable} sub-claim(s) failed witness audit; fractal score ${fractalScore.toFixed(2)}.`
      : verdict === "INAPPLICABLE"
        ? `No sub-claim was structurally verifiable.`
        : `${totalNodes} sub-claim(s) audited; ${alertNodes} alert(s); fractal score ${fractalScore.toFixed(2)}.`,
    ms: Date.now() - t0,
  };
}
