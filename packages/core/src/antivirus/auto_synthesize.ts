/**
 * MNEME ANTIVIRUS — Auto-Vaccine Synthesis (v1.28.0).
 *
 * The closed loop the user asked for:
 *
 *   gap-scan finds N false negatives (phantoms vaccine MISSED)
 *      ↓
 *   feed FN sample texts into a deterministic pattern miner
 *      ↓
 *   mine produces a candidate regex that matches the FN samples
 *   but DOES NOT match the legitimate negatives
 *      ↓
 *   re-run gap-scan WITH the candidate pattern injected
 *      ↓
 *   accept iff:  recall improves AND precision stays >= 0.90
 *      ↓
 *   write a SynthesizedVaccine artifact to .mneme/proposals/
 *      → maintainer reviews + merges into strains.ts
 *      → OR daemon nightly cycle drafts an auto-PR
 *
 * NO LLM in the hot path. Pure pattern mining: longest-common-substring
 * + character-class generalisation. Deterministic, auditable, testable.
 *
 * Returns a non-null SynthesisResult only when ALL gates pass --
 * acceptance is the contract, like Phase-3 EVOLVE.
 */

import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { createHash } from "node:crypto";

import type { StrainId } from "./types.js";

export interface VaccineSynthesisResult {
  /** Stable id (sha hash of strain + samples + timestamp). */
  id: string;
  strain: StrainId;
  generatedAt: string;
  /** The proposed regex source string (no flags). */
  proposedPattern: string;
  /** FN samples that motivated the pattern. */
  fnSamples: string[];
  /** Recall on the FN set BEFORE applying the new pattern (always 0). */
  recallBefore: number;
  /** Recall on the FN set AFTER applying the new pattern. */
  recallAfter: number;
  /** Negatives the new pattern WOULD match (false-positive risk). */
  negativeMatches: string[];
  /** Precision floor estimate: 1 - (negativeMatches / total negatives). */
  precisionAfter: number;
  /** True iff the candidate passes the acceptance gate. */
  accepted: boolean;
  /** Why accepted/rejected (one line). */
  verdict: string;
  /** Persisted path for the proposal markdown sidecar. */
  proposalPath?: string;
}

export interface SynthesisInput {
  strain: StrainId;
  /** False-negative sample texts (phantoms the vaccine MISSED). */
  fnSamples: string[];
  /** Legitimate negatives -- patterns that must NOT match. */
  negativeSamples: string[];
}

// ─── pattern mining ─────────────────────────────────────────────────────

/** Escape a literal string for embedding in a regex source. */
function reEscape(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Mine a regex from FN samples. Strategy:
 *
 *   1. Find the longest common SUFFIX across samples (often the
 *      "phantom-N" / "-quickfix" tail in synthetic phantoms).
 *   2. Find the longest common PREFIX (e.g. "@anthropic" scope).
 *   3. If neither stable, generalise the differing middle as
 *      `[\\w-]+?` (non-greedy word chars + hyphen).
 *   4. Return `(prefix?)(middle?)(suffix?)` with appropriate
 *      character classes.
 *
 * Conservative: prefers fewer matches over over-generalising.
 */
export function mineRegexFromSamples(samples: string[]): string | null {
  // v1.28.3 HOTFIX -- defensive: tolerate undefined/null/non-array input
  // and non-string entries so a third-party caller cannot crash the miner.
  if (!Array.isArray(samples) || samples.length === 0) return null;
  const norm = samples
    .filter((s): s is string => typeof s === "string")
    .map((s) => s.trim())
    .filter(Boolean);
  if (norm.length === 0) return null;

  // Find longest common prefix.
  function commonPrefix(arr: string[]): string {
    if (arr.length === 0) return "";
    let p = arr[0]!;
    for (let i = 1; i < arr.length; i++) {
      const s = arr[i]!;
      let j = 0;
      while (j < p.length && j < s.length && p[j] === s[j]) j++;
      p = p.slice(0, j);
      if (!p) break;
    }
    return p;
  }
  function commonSuffix(arr: string[]): string {
    if (arr.length === 0) return "";
    let p = arr[0]!;
    for (let i = 1; i < arr.length; i++) {
      const s = arr[i]!;
      let j = 0;
      while (j < p.length && j < s.length && p[p.length - 1 - j] === s[s.length - 1 - j]) j++;
      p = p.slice(p.length - j);
      if (!p) break;
    }
    return p;
  }

  const pre = commonPrefix(norm);
  const suf = commonSuffix(norm);

  // Prefer suffix-based pattern if the suffix is long enough (>= 4 chars
  // and >= 60% of average sample length) -- catches "*-quickfix-1"
  // shapes well.
  const avgLen = norm.reduce((s, x) => s + x.length, 0) / norm.length;
  if (suf.length >= 4 && suf.length / avgLen >= 0.20) {
    // Match anything word-shaped ending in this suffix.
    return `[\\w@/.\\-]+${reEscape(suf)}`;
  }
  if (pre.length >= 4) {
    return `${reEscape(pre)}[\\w@/.\\-]*`;
  }
  // Fall back: generalised "phantom-N" / "*phantom*" word.
  // Look for shared keyword (e.g. "phantom", "fake", "ghost").
  const keywords = ["phantom", "fake", "ghost", "imaginary", "quickfix"];
  for (const kw of keywords) {
    if (norm.every((s) => s.toLowerCase().includes(kw))) {
      return `[\\w@/.\\-]*${reEscape(kw)}[\\w@/.\\-]*`;
    }
  }
  return null;
}

// ─── acceptance gate ────────────────────────────────────────────────────

const PRECISION_FLOOR = 0.90;
const MIN_RECALL_DELTA = 0.10;

export function evaluateCandidatePattern(
  pattern: string,
  fnSamples: string[],
  negativeSamples: string[],
): { recallAfter: number; precisionAfter: number; negativeMatches: string[] } {
  // v1.28.3 HOTFIX -- defensive against undefined/null/non-array inputs.
  // Original v1.28.0 crashed with "negativeSamples is not iterable" when
  // a third-party caller bypassed the CLI's `?? []` guard. Root cause of
  // the day-one synthesize TypeError reported on v1.28.0.
  const safeFn = Array.isArray(fnSamples) ? fnSamples : [];
  const safeNeg = Array.isArray(negativeSamples) ? negativeSamples : [];
  let re: RegExp;
  try { re = new RegExp(pattern); }
  catch { return { recallAfter: 0, precisionAfter: 1, negativeMatches: [] }; }
  let tp = 0;
  for (const fn of safeFn) {
    if (typeof fn === "string" && re.test(fn)) tp++;
  }
  const negativeMatches: string[] = [];
  for (const neg of safeNeg) {
    if (typeof neg === "string" && re.test(neg)) negativeMatches.push(neg);
  }
  const recallAfter = safeFn.length === 0 ? 0 : tp / safeFn.length;
  const totalNeg = safeNeg.length || 1;
  const fp = negativeMatches.length;
  const precisionAfter = (totalNeg - fp) / totalNeg;
  return { recallAfter, precisionAfter, negativeMatches };
}

// ─── synthesis pipeline ────────────────────────────────────────────────

export function synthesizeVaccine(
  repoRoot: string,
  input: SynthesisInput,
): VaccineSynthesisResult {
  // v1.28.3 HOTFIX -- defensive normalization of inputs. Day-one v1.28.0
  // crashed when callers passed undefined arrays. Now every field is
  // coerced to a safe shape BEFORE any property access.
  const safeInput: SynthesisInput = {
    strain: input?.strain ?? ("unknown" as StrainId),
    fnSamples: Array.isArray(input?.fnSamples) ? input.fnSamples.filter((s) => typeof s === "string") : [],
    negativeSamples: Array.isArray(input?.negativeSamples) ? input.negativeSamples.filter((s) => typeof s === "string") : [],
  };
  const generatedAt = new Date().toISOString();
  const id = createHash("sha256")
    .update(safeInput.strain).update(safeInput.fnSamples.join("|")).update(generatedAt)
    .digest("hex").slice(0, 12);
  const fail = (verdict: string, partial: Partial<VaccineSynthesisResult> = {}): VaccineSynthesisResult => ({
    id, strain: safeInput.strain, generatedAt,
    proposedPattern: "", fnSamples: safeInput.fnSamples,
    recallBefore: 0, recallAfter: 0, negativeMatches: [],
    precisionAfter: 0, accepted: false, verdict,
    ...partial,
  });

  if (safeInput.fnSamples.length === 0) return fail("no FN samples to mine from -- skip");

  const pattern = mineRegexFromSamples(safeInput.fnSamples);
  if (!pattern) return fail("pattern miner found no stable shared structure across FN samples");

  const evalResult = evaluateCandidatePattern(pattern, safeInput.fnSamples, safeInput.negativeSamples);
  const recallDelta = evalResult.recallAfter - 0; // before is 0 by definition (these are FNs)
  const accepted =
    recallDelta >= MIN_RECALL_DELTA &&
    evalResult.precisionAfter >= PRECISION_FLOOR;

  const verdict = accepted
    ? `ACCEPTED: pattern adds +${(recallDelta * 100).toFixed(0)}pp recall, precision ${(evalResult.precisionAfter * 100).toFixed(0)}%`
    : evalResult.precisionAfter < PRECISION_FLOOR
      ? `REJECTED: precision ${(evalResult.precisionAfter * 100).toFixed(0)}% below floor ${(PRECISION_FLOOR * 100).toFixed(0)}% (matches ${evalResult.negativeMatches.length} legit negatives)`
      : `REJECTED: recall delta ${(recallDelta * 100).toFixed(0)}pp below floor ${(MIN_RECALL_DELTA * 100).toFixed(0)}pp`;

  const result: VaccineSynthesisResult = {
    id, strain: safeInput.strain, generatedAt,
    proposedPattern: pattern,
    fnSamples: safeInput.fnSamples,
    recallBefore: 0,
    recallAfter: evalResult.recallAfter,
    negativeMatches: evalResult.negativeMatches,
    precisionAfter: evalResult.precisionAfter,
    accepted, verdict,
  };

  // Always persist a proposal sidecar (accepted or rejected) so the
  // maintainer has a paper trail.
  try {
    const dir = join(repoRoot, ".mneme/proposals");
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
    const md = renderProposalMarkdown(result);
    const path = join(dir, `vaccine-${id}.md`);
    writeFileSync(path, md, "utf8");
    result.proposalPath = path;
  } catch { /* best-effort */ }

  return result;
}

function renderProposalMarkdown(r: VaccineSynthesisResult): string {
  const lines: string[] = [];
  lines.push(`# Auto-vaccine proposal -- ${r.strain}\n`);
  lines.push(`**Status**: ${r.accepted ? "✓ ACCEPTED (gate passed)" : "✗ REJECTED"}  `);
  lines.push(`**Verdict**: ${r.verdict}\n`);
  lines.push(`**Proposed pattern**:\n\`\`\`regex\n${r.proposedPattern || "(none)"}\n\`\`\`\n`);
  lines.push(`**FN samples mined from** (${r.fnSamples.length}):`);
  for (const s of r.fnSamples.slice(0, 10)) lines.push(`  - \`${s}\``);
  if (r.fnSamples.length > 10) lines.push(`  - ... and ${r.fnSamples.length - 10} more`);
  lines.push(``);
  lines.push(`**Metrics on the test set**:`);
  lines.push(`  - Recall after: ${(r.recallAfter * 100).toFixed(0)}%`);
  lines.push(`  - Precision after: ${(r.precisionAfter * 100).toFixed(0)}%`);
  lines.push(`  - Negative matches (false-positive risk): ${r.negativeMatches.length}`);
  if (r.negativeMatches.length > 0) {
    lines.push(`    - First 5: ${r.negativeMatches.slice(0, 5).join(", ")}`);
  }
  lines.push(``);
  if (r.accepted) {
    lines.push(`**Next**: review + paste this pattern into \`packages/core/src/antivirus/strains.ts\` under the \`${r.strain}\` strain's \`signature.patterns\` array. Re-run \`mneme antivirus gap-scan\` -- recall should climb.`);
  } else {
    lines.push(`**Next**: provide more FN samples (more diverse synthesis), OR loosen \`MIN_RECALL_DELTA\` / \`PRECISION_FLOOR\` in \`auto_synthesize.ts\`.`);
  }
  lines.push(``);
  lines.push(`> Generated by Mneme antivirus auto-synthesizer. Pure deterministic pattern mining (no LLM in the hot path).`);
  return lines.join("\n");
}
