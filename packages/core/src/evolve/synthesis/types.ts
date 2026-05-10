/**
 * MNEME EVOLVE Phase 3 -- Code Synthesis (v1.27.0)
 *
 * Phase 2 (shipped v1.26.4) wrote markdown PR proposals. Phase 3
 * writes ACTUAL .patch files that compile and pass tests. The contract
 * is deliberately strict:
 *
 *   - Templates are deterministic. Given the same signal + same source,
 *     the same patch falls out every time. No LLM in the hot path
 *     (LLM augmentation is a v1.28+ option, not a v1.27 dependency).
 *
 *   - Every synthesized patch is GATED by:
 *       1. `git diff --quiet HEAD -- <file>` -- target file must be
 *          clean in the working tree (no surprise collisions with
 *          unstaged user edits).
 *       2. `tsc --noEmit` on the target package -- patch must compile.
 *       3. Targeted `vitest run <related>` -- tests must stay green.
 *     If any gate fails, the patch is REJECTED and the original file
 *     is restored. Confidence is recorded but the .patch file is NOT
 *     persisted as "verified".
 *
 *   - Every saved patch carries an HMAC-SHA256 signature over its
 *     content + verification artifact (compile_ok, tests_passed,
 *     timestamp). Anyone can recompute the HMAC from the .mneme key
 *     and confirm the patch was actually verified at synthesis time.
 *
 *   - Phase 3 NEVER auto-applies. The .patch file sits in
 *     `.mneme/proposals/<id>.patch` until the user runs
 *     `mneme evolve apply <id>` (which itself prompts).
 *
 *   - Phase 4 wraps `gh pr create` to lift verified patches into a
 *     real GitHub PR (opt-in via `mneme evolve auto-pr <id>`).
 *
 *   - Phase 5 lets the daemon scan + synthesize + verify on a 6-hour
 *     tick. New verified patches trigger a notifier broadcast (so the
 *     user sees "3 patches verified overnight, ready for review").
 *
 * The throughline: 100% verifiable, 0% auto-merged.
 */

export type TemplateId =
  | "selfcheck-warn-to-skip-on-missing-file"
  /* future templates -- each one a deterministic, named pattern */
  | "future-template-placeholder";

export interface TemplateMatch {
  templateId: TemplateId;
  /** Path of file to patch (relative to repoRoot). */
  filePath: string;
  /** Human description of the change. */
  description: string;
  /** The before/after pair the template will splice. */
  before: string;
  after: string;
}

export interface SynthesisGateResult {
  /** Was the working tree clean for the target file? */
  workingTreeClean: boolean;
  /** Did the patched file pass `tsc --noEmit`? null = not run. */
  compileOk: boolean | null;
  /** Did targeted tests pass? null = not run. */
  testsOk: boolean | null;
  /** Stderr / errors collected from the gates. Useful for debugging. */
  errors: string[];
}

export interface SynthesisResult {
  /** Stable id (sha hash of proposalId + templateId + filePath). */
  id: string;
  /** The Phase-2 proposal this came from. */
  proposalId: string;
  /** Template that produced the patch. */
  templateId: TemplateId;
  /** ISO timestamp of synthesis. */
  synthesizedAt: string;
  /** Path of file the patch targets (relative to repoRoot). */
  filePath: string;
  /** Unified-diff text of the patch (`git apply` compatible). */
  patchText: string;
  /** Gate verdict. */
  gates: SynthesisGateResult;
  /** True iff every gate passed. .patch file is only written when verified=true. */
  verified: boolean;
  /** HMAC-SHA256 signature over (id, patchText, gates, synthesizedAt) keyed by .mneme/.evolve-secret. */
  signature: string;
  /** Confidence in [0, 1] -- bumped from the Phase-2 proposal confidence when verified. */
  confidence: number;
  /**
   * v1.27.5: per-patch RISK metrics. Lets the user see WHY the
   * confidence number is what it is (file age, churn, fan-in,
   * test density). High riskScore = lower confidence.
   */
  risk?: {
    fileAgeDays: number | null;
    churn30d: number | null;
    loc: number;
    testDensity: number;
    fanIn: number;
    riskScore: number;
    safetyScore: number;
  };
}

export interface ApplyResult {
  ok: boolean;
  appliedAt: string;
  /** Reason on failure. */
  reason?: string;
}

export interface AutoPrResult {
  ok: boolean;
  prUrl?: string;
  /** Reason on failure (gh missing, no remote, etc.). */
  reason?: string;
}
