/**
 * v2.53.0 — CORPUS AUGMENTER for NEMESIS calibration.
 *
 * Closes P1-2 from v2.52 session audit: classify accuracy drops on
 * "wild" data (real PRs from GitHub) vs seed corpus because the seed
 * is too clean (always has `diff --git` headers; PR descriptions are
 * crisp; commit messages follow conventions). Wild data is noisier.
 *
 * Without an external PR harvesting pipeline, we SYNTHESIZE the noise
 * locally — 5 deterministic transformations per seed fixture that
 * produce realistic-but-perturbed variants:
 *
 *   T1 STRIP_DIFF_HEADER   — remove `diff --git`, `--- a/`, `+++ b/`
 *                            lines (simulates pasted-into-clipboard)
 *   T2 NATURALISE_PR       — replace structured "## Changes" / bullet
 *                            lists with flowing prose
 *   T3 SPARSE_COMMITS      — keep only the first commit subject
 *                            (simulates squash-merge)
 *   T4 DENSE_COMMITS       — duplicate commits with whitespace tweaks
 *                            (simulates fixup chain)
 *   T5 WHITESPACE_NOISE    — add trailing whitespace + CRLF endings
 *                            (simulates cross-platform clipboard)
 *
 * Each augmented fixture inherits the original's vendor label, so the
 * augmented corpus is 6x larger (1 seed + 5 perturbations) and tests
 * generalization to wilder inputs.
 *
 * Pure deterministic + defensive; never throws.
 */

import type { CorpusEntry } from "./calibration_corpus.js";
import { buildSeedCorpus, computeStats } from "./calibration_corpus.js";
import { classifyAgentCalibrated } from "./classifier_calibrated.js";
import { extractFingerprint } from "./features.js";
import type { VendorStats } from "./calibration_corpus.js";

export type AugmentationKind = "STRIP_DIFF_HEADER" | "NATURALISE_PR" | "SPARSE_COMMITS" | "DENSE_COMMITS" | "WHITESPACE_NOISE";

export interface AugmentedEntry extends CorpusEntry {
  augmentationKind: AugmentationKind | "ORIGINAL";
  sourceFixtureId?: string;
}

function stripDiffHeader(diff: string): string {
  if (typeof diff !== "string") return "";
  return diff
    .split("\n")
    .filter((l) => !/^diff --git /.test(l))
    .filter((l) => !/^--- (a\/|\/dev\/null)/.test(l))
    .filter((l) => !/^\+\+\+ (b\/|\/dev\/null)/.test(l))
    .filter((l) => !/^index [0-9a-f]{7,}\.\.[0-9a-f]{7,}/.test(l))
    .join("\n");
}

function naturalisePr(pr: string): string {
  if (typeof pr !== "string" || pr.length === 0) return "";
  // Strip markdown headings + bullet lists → flowing prose
  return pr
    .replace(/^#+\s*/gm, "")
    .replace(/^[-*]\s+/gm, "")
    .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
    .replace(/\n{2,}/g, ". ")
    .replace(/\n/g, " ")
    .trim();
}

function sparseCommits(commits: string[]): string[] {
  if (!Array.isArray(commits) || commits.length === 0) return [];
  // Keep only first commit, only the subject line
  const first = commits[0]!.split("\n")[0]!.trim();
  return [first];
}

function denseCommits(commits: string[]): string[] {
  if (!Array.isArray(commits) || commits.length === 0) return [];
  const out: string[] = [];
  for (const c of commits) {
    out.push(c);
    // Add a fixup-style follow-up
    out.push(`fixup! ${c.split("\n")[0]}`);
  }
  return out;
}

function whitespaceNoise(diff: string): string {
  if (typeof diff !== "string") return "";
  return diff.split("\n").map((l) => l + "   ").join("\r\n");
}

/** Apply ONE augmentation kind to a fixture. Returns NEW fixture. */
export function applyAugmentation(entry: CorpusEntry, kind: AugmentationKind): AugmentedEntry {
  const base: CorpusEntry = {
    vendor: entry.vendor,
    fixture: {
      diff: entry.fixture.diff,
      prDescription: entry.fixture.prDescription,
      commitMessages: [...entry.fixture.commitMessages],
    },
  };
  switch (kind) {
    case "STRIP_DIFF_HEADER":
      base.fixture.diff = stripDiffHeader(base.fixture.diff);
      break;
    case "NATURALISE_PR":
      base.fixture.prDescription = naturalisePr(base.fixture.prDescription);
      break;
    case "SPARSE_COMMITS":
      base.fixture.commitMessages = sparseCommits(base.fixture.commitMessages);
      break;
    case "DENSE_COMMITS":
      base.fixture.commitMessages = denseCommits(base.fixture.commitMessages);
      break;
    case "WHITESPACE_NOISE":
      base.fixture.diff = whitespaceNoise(base.fixture.diff);
      break;
  }
  return { ...base, augmentationKind: kind };
}

/** Build the 6x-augmented corpus (1 ORIGINAL + 5 transformations per seed). */
export function buildAugmentedCorpus(): AugmentedEntry[] {
  const seed = buildSeedCorpus();
  const kinds: AugmentationKind[] = ["STRIP_DIFF_HEADER", "NATURALISE_PR", "SPARSE_COMMITS", "DENSE_COMMITS", "WHITESPACE_NOISE"];
  const out: AugmentedEntry[] = [];
  for (let i = 0; i < seed.length; i++) {
    const s = seed[i]!;
    out.push({ ...s, augmentationKind: "ORIGINAL", sourceFixtureId: `seed-${i}` });
    for (const k of kinds) {
      out.push({ ...applyAugmentation(s, k), sourceFixtureId: `seed-${i}` });
    }
  }
  return out;
}

export interface AugmentedAccuracyReport {
  total: number;
  correct: number;
  accuracy: number;
  byKind: Record<string, { correct: number; total: number; accuracy: number }>;
  failing: Array<{ vendor: string; predicted: string; kind: string; confidence: number }>;
}

/**
 * Evaluate the calibrated classifier against the 6x-augmented corpus.
 * Returns per-kind accuracy + a sample of failures for debugging.
 */
export function evaluateAugmentedAccuracy(opts: { maxFailing?: number } = {}): AugmentedAccuracyReport {
  const corpus = buildAugmentedCorpus();
  const byKind: Record<string, { correct: number; total: number; accuracy: number }> = {};
  const failing: AugmentedAccuracyReport["failing"] = [];
  let correct = 0;
  for (const entry of corpus) {
    const fp = extractFingerprint(entry.fixture);
    const v = classifyAgentCalibrated(fp);
    const ok = v.topVendor === entry.vendor;
    if (ok) correct++;
    const kind = entry.augmentationKind;
    if (!byKind[kind]) byKind[kind] = { correct: 0, total: 0, accuracy: 0 };
    byKind[kind].total++;
    if (ok) byKind[kind].correct++;
    if (!ok && failing.length < (opts.maxFailing ?? 10)) {
      failing.push({ vendor: entry.vendor, predicted: v.topVendor, kind, confidence: v.confidence });
    }
  }
  for (const k of Object.keys(byKind)) byKind[k]!.accuracy = +(byKind[k]!.correct / Math.max(1, byKind[k]!.total)).toFixed(3);
  return {
    total: corpus.length,
    correct,
    accuracy: +(correct / Math.max(1, corpus.length)).toFixed(3),
    byKind,
    failing,
  };
}

/**
 * Build per-vendor stats from the augmented corpus (use to retrain the
 * calibrated classifier so it generalizes to noisier inputs).
 */
export function computeAugmentedStats(): Map<string, VendorStats> {
  return computeStats(buildAugmentedCorpus());
}
