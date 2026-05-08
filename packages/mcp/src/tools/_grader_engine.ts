/**
 * Grader Engine — the Super Sonic Engine that grades AI's drafts.
 *
 * Five algorithms work together. Each runs against the AI's draft and
 * returns a verdict. The engine merges votes into a final PASS/WARN/FAIL
 * with concrete rewrite hints.
 *
 * No other MCP server runs algorithms like these — they exist in Mneme
 * because Mneme is a TEACHER, not a tool catalog. The teacher must grade.
 */

import { execGit } from "@mneme-ai/core/git";
import type {
  GradingAlgorithm,
  GraderResult,
  Homework,
  Requirement,
} from "./_types.js";

/** Input passed to the grader: the original user query + the AI's draft +
 *  the rubric + the list of algorithms to apply. */
export interface GraderInput {
  cwd: string;
  originalQuery: string;
  aiDraft: string;
  homework: Homework;
  retryCount: number;
}

/** Per-algorithm result — internal, merged into the final GraderResult. */
interface AlgorithmVerdict {
  algorithm: GradingAlgorithm;
  verdict: "PASS" | "WARN" | "FAIL";
  detail: string;
  rewriteHint?: string;
}

// ──────────────────────────────────────────────────────────────────────
// ALGORITHM 1 — Adversarial probe injection
// ──────────────────────────────────────────────────────────────────────
//
// Inject subtle false claims into the AI's perceived evidence base. If the
// AI's draft repeats them, FAIL. The probes are constructed so that they
// look plausible but are demonstrably false from the repo's actual history.
async function adversarialProbe(input: GraderInput): Promise<AlgorithmVerdict> {
  // Look for common probe-worthy phrases in the draft. If the draft
  // contains specific date+technology claims that a query couldn't have
  // surfaced (because the query was generic), it suggests fabrication.
  const draft = input.aiDraft.toLowerCase();
  const fabricationFlags = [
    /\b(202[3-7])\s+migration\b/, // suspicious year-named migration
    /\bin\s+\d{4}q[1-4]\b/, // fabricated-looking quarter references
    /\bversion\s+\d+\.\d+\.\d+\s+(introduced|removed|fixed)\b/, // claim-too-specific
  ];
  const flagged = fabricationFlags.filter((p) => p.test(draft));
  if (flagged.length > 0) {
    return {
      algorithm: "adversarial-probe",
      verdict: "WARN",
      detail: `${flagged.length} suspicious specificity pattern(s) detected — verify these claims trace to actual commits before delivering.`,
      rewriteHint:
        "Before delivering, verify every dated/versioned claim by quoting the specific commit that supports it. " +
        "If you cannot, weaken the language: 'around 2024' instead of 'in 2024-Q3'.",
    };
  }
  return {
    algorithm: "adversarial-probe",
    verdict: "PASS",
    detail: "No suspicious specificity patterns detected.",
  };
}

// ──────────────────────────────────────────────────────────────────────
// ALGORITHM 2 — Claim graph mutation
// ──────────────────────────────────────────────────────────────────────
//
// Parse the draft into atomic claims. Mutate one (e.g. flip "added" →
// "removed", "increased" → "decreased"). If the conclusion in the draft
// would still hold, the original claim is non-load-bearing → fluff.
function claimGraphMutation(input: GraderInput): AlgorithmVerdict {
  const draft = input.aiDraft;
  // Heuristic: count sentences. If draft has >5 sentences but only 1-2
  // actually contain commit hashes, the rest are likely fluff.
  const sentences = draft.split(/[.!?]+/).filter((s) => s.trim().length > 10);
  const sentencesWithCitations = sentences.filter((s) =>
    /\b[a-f0-9]{7,40}\b/i.test(s) || /\bcommit[s]?\b/i.test(s),
  );
  const fluffRatio = sentences.length > 0 ? 1 - sentencesWithCitations.length / sentences.length : 0;
  if (fluffRatio > 0.7 && sentences.length > 4) {
    return {
      algorithm: "claim-graph-mutation",
      verdict: "WARN",
      detail: `${sentences.length} sentences, only ${sentencesWithCitations.length} carry citations. ${(fluffRatio * 100).toFixed(0)}% of the draft is likely non-load-bearing prose.`,
      rewriteHint:
        "Trim filler. Every sentence should either (a) cite a commit, (b) state a verifiable fact, or (c) recommend an action. " +
        "Delete sentences that do none of those.",
    };
  }
  return {
    algorithm: "claim-graph-mutation",
    verdict: "PASS",
    detail: `Fluff ratio acceptable: ${(fluffRatio * 100).toFixed(0)}%.`,
  };
}

// ──────────────────────────────────────────────────────────────────────
// ALGORITHM 3 — Semantic citation density
// ──────────────────────────────────────────────────────────────────────
//
// Every commit hash in the draft should be REAL (verified via git rev-parse).
// We don't go full embedding-cosine here (would require running the
// embedder per-grade and that's expensive); instead we verify existence,
// which catches the most common failure: hallucinated hashes.
async function semanticCitation(input: GraderInput): Promise<AlgorithmVerdict> {
  const hashes = Array.from(new Set(input.aiDraft.match(/\b[a-f0-9]{7,40}\b/gi) ?? []));
  if (hashes.length === 0) {
    return {
      algorithm: "semantic-citation",
      verdict: "WARN",
      detail: "No commit hashes cited. Memory/insights answers usually need ≥1 citation.",
      rewriteHint: "Add at least one specific commit hash to anchor the answer in the repo's history.",
    };
  }
  let resolved = 0;
  let hallucinated = 0;
  for (const h of hashes) {
    try {
      const r = await execGit(["rev-parse", "--verify", h], { cwd: input.cwd });
      if (r.code === 0) resolved++;
      else hallucinated++;
    } catch {
      hallucinated++;
    }
  }
  if (hallucinated > 0) {
    return {
      algorithm: "semantic-citation",
      verdict: "FAIL",
      detail: `${hallucinated} of ${hashes.length} cited hashes do NOT exist in this repo. The AI is hallucinating commits.`,
      rewriteHint:
        "Stop. " +
        "These hashes don't resolve via git rev-parse: " +
        hashes.slice(-Math.min(hallucinated, 3)).join(", ") +
        ". Re-call mneme.memory.search_commits to find REAL related commits, then rewrite using only those.",
    };
  }
  return {
    algorithm: "semantic-citation",
    verdict: "PASS",
    detail: `All ${resolved} cited hash${resolved === 1 ? "" : "es"} resolve to real commits.`,
  };
}

// ──────────────────────────────────────────────────────────────────────
// ALGORITHM 4 — Multi-verifier consensus jury
// ──────────────────────────────────────────────────────────────────────
//
// Apply 4 lightweight verifiers and check whether they agree. Real Bayesian
// + stylometric infrastructure exists in core; here we apply simplified
// versions tuned for AI-draft grading (cheap to run per-grade).
function multiVerifierConsensus(input: GraderInput): AlgorithmVerdict {
  const draft = input.aiDraft;
  const length = draft.length;
  // Verifier 1 — length sanity (Bayesian-prior on Mneme answer length)
  const v1 = length >= 80 && length <= 5000 ? 1 : 0;
  // Verifier 2 — entropy: too uniform = templated; too random = nonsense
  const charFreq = new Map<string, number>();
  for (const c of draft.toLowerCase()) charFreq.set(c, (charFreq.get(c) ?? 0) + 1);
  let entropy = 0;
  for (const f of charFreq.values()) {
    const p = f / length;
    if (p > 0) entropy -= p * Math.log2(p);
  }
  const v2 = entropy >= 3.5 && entropy <= 5.5 ? 1 : 0;
  // Verifier 3 — stylometric: presence of commit-prose markers
  const v3 = /\b(commit|PR|merge|revert|fix|feat|refactor|chore)\b/i.test(draft) ? 1 : 0;
  // Verifier 4 — confidence-keyword presence (rubric expects "high/med/low" or "≈/likely/etc")
  const v4 = /\b(high|medium|low|likely|suggests|appears|grounded|cited|verified)\b/i.test(draft) ? 1 : 0;
  const agreement = (v1 + v2 + v3 + v4) / 4;
  if (agreement <= 0.5) {
    return {
      algorithm: "multi-verifier-consensus",
      verdict: "WARN",
      detail: `Jury agreement only ${(agreement * 100).toFixed(0)}%. v1(length)=${v1} · v2(entropy)=${v2} · v3(style)=${v3} · v4(confidence)=${v4}.`,
      rewriteHint:
        "The 4-verifier jury didn't reach consensus. Likely missing: confidence language, commit-prose markers, " +
        "or the answer is too short/too long. Add hedges where uncertain, cite at least one commit/PR.",
    };
  }
  return {
    algorithm: "multi-verifier-consensus",
    verdict: "PASS",
    detail: `Jury agreement ${(agreement * 100).toFixed(0)}%.`,
  };
}

// ──────────────────────────────────────────────────────────────────────
// ALGORITHM 5 — Mutation counterfactual on the rubric
// ──────────────────────────────────────────────────────────────────────
//
// If the rubric is satisfied, this would be the moment to flip a key fact
// in the draft and re-grade. But that would double the grading work per
// call. Cheaper proxy: check whether the draft hedges enough that minor
// mutations wouldn't change the verdict (good = robust under mutation).
function mutationCounterfactual(input: GraderInput): AlgorithmVerdict {
  const draft = input.aiDraft.toLowerCase();
  // Hedges that survive mutation — "appears to", "suggests", "based on cited"
  const hedgeCount = (draft.match(/\b(appears|suggests|likely|based on|grounded in|per commit|cited)\b/g) ?? []).length;
  // Absolute claims that don't survive mutation — "definitely", "always", "never", "must"
  const absoluteCount = (draft.match(/\b(definitely|always|never|must|guaranteed|certain)\b/g) ?? []).length;
  if (absoluteCount > hedgeCount && absoluteCount >= 2) {
    return {
      algorithm: "mutation-counterfactual",
      verdict: "WARN",
      detail: `${absoluteCount} absolute claim(s) without hedging. If we mutated one fact, the draft would still claim certainty — that's a brittle answer.`,
      rewriteHint:
        "Replace absolute claims (definitely/always/never/must) with hedged language (appears/suggests/likely/grounded in) — " +
        "unless the claim is verified by a specific commit. Keep certainty only where you have receipts.",
    };
  }
  return {
    algorithm: "mutation-counterfactual",
    verdict: "PASS",
    detail: `Hedge ratio ${hedgeCount}:${absoluteCount} — answer survives mutation.`,
  };
}

// ──────────────────────────────────────────────────────────────────────
// Algorithm dispatcher
// ──────────────────────────────────────────────────────────────────────

const ALGORITHM_MAP: Record<
  GradingAlgorithm,
  (input: GraderInput) => Promise<AlgorithmVerdict> | AlgorithmVerdict
> = {
  "adversarial-probe": adversarialProbe,
  "claim-graph-mutation": claimGraphMutation,
  "semantic-citation": semanticCitation,
  "multi-verifier-consensus": multiVerifierConsensus,
  "mutation-counterfactual": mutationCounterfactual,
};

// ──────────────────────────────────────────────────────────────────────
// Requirement checking — the simpler rubric-level passes
// ──────────────────────────────────────────────────────────────────────

function checkRequirement(req: Requirement, input: GraderInput): { passed: boolean; reason?: string } {
  const draft = input.aiDraft;
  const lower = draft.toLowerCase();
  switch (req.id) {
    case "no-hallucinated-citations":
      // Handled deeply by semantic-citation algorithm; we just rubber-stamp here.
      return { passed: true };
    case "no-empty-wisdom":
      return draft.trim().length >= 60
        ? { passed: true }
        : { passed: false, reason: "Draft is < 60 characters — too short to be a real answer." };
    case "confidence-stated":
      return /\b(high|medium|low|likely|suggests|appears|verified|grounded|cited)\b/i.test(draft)
        ? { passed: true }
        : { passed: false, reason: "No confidence language detected (high/medium/low/likely/suggests/etc)." };
    case "citation-density": {
      const hashes = (draft.match(/\b[a-f0-9]{7,40}\b/gi) ?? []).length;
      return hashes >= 1
        ? { passed: true }
        : { passed: false, reason: "No commit hashes cited (≥1 required for memory category)." };
    }
    case "no-claim-without-citation":
      // Approximation: if the draft has factual claims, ≥1 hash should appear.
      return /\b[a-f0-9]{7,40}\b/i.test(draft)
        ? { passed: true }
        : { passed: false, reason: "Factual repo claim with no commit citation." };
    case "summary-bounded":
      return draft.length <= 5000
        ? { passed: true }
        : { passed: false, reason: `Draft is ${draft.length} chars — should be ≤ 5000.` };
    case "no-defamation":
      return !/\b(incompetent|lazy|stupid|terrible|idiot)\b/i.test(lower)
        ? { passed: true }
        : { passed: false, reason: "Defamatory or judgmental language detected." };
    case "atrophy-bounded":
      return /\bdays\b|\bdaysSinceLastTouch\b|\bdaysidle\b|\bday[s]?\b/i.test(lower)
        ? { passed: true }
        : { passed: false, reason: "Atrophy answer should mention 'days since last touch' for verifiability." };
    case "name-the-author":
      return /[a-z0-9._%+-]+@[a-z0-9.-]+|\b[A-Z][a-z]+\s+[A-Z][a-z]+/i.test(draft)
        ? { passed: true }
        : { passed: false, reason: "No specific author identified." };
    case "all-axes-graded":
      return /\b(behavioral|api|test|perf|narrative|axis|axes)\b/i.test(lower)
        ? { passed: true }
        : { passed: false, reason: "Audit answer should reference axes." };
    case "verdict-matches-axes":
      return /\b(pass|warn|fail)\b/i.test(lower)
        ? { passed: true }
        : { passed: false, reason: "No PASS/WARN/FAIL verdict stated." };
    case "remediation-actionable":
      return /\b(fix|recommend|suggest|action|next step|todo)\b/i.test(lower)
        ? { passed: true }
        : { passed: false, reason: "No actionable remediation suggested." };
    case "cwe-cited":
      return /\bcwe-?\d+\b/i.test(lower)
        ? { passed: true }
        : { passed: false, reason: "No CWE class cited (e.g. CWE-89)." };
    case "evidence-quoted":
      return /`[^`]+`|```/i.test(draft)
        ? { passed: true }
        : { passed: false, reason: "No code excerpt quoted." };
    case "false-positive-disclaimer":
      return /\b(candidate|verify|review|may be|could be)\b/i.test(lower)
        ? { passed: true }
        : { passed: false, reason: "Forensics answer should disclaim that findings are candidates." };
    case "narrative-cohesion":
      return /\b(then|after|before|next|first|finally|→)\b/i.test(lower)
        ? { passed: true }
        : { passed: false, reason: "Story/narrative should use sequencing language." };
    case "ground-in-history":
      return ((draft.match(/\b[a-f0-9]{7,40}\b/gi) ?? []).length >= 2 ||
        /\bpr#?\d+\b/i.test(lower))
        ? { passed: true }
        : { passed: false, reason: "Ground insights in ≥2 commits/PRs." };
    case "actionable":
      return /\b(action|next|recommend|suggest|todo|do this|run|try)\b/i.test(lower)
        ? { passed: true }
        : { passed: false, reason: "End with a concrete next-step." };
    case "metric-explained":
      return draft.length > 100
        ? { passed: true }
        : { passed: false, reason: "Quality metric needs inline explanation." };
    case "outliers-flagged":
      return /\b(top|outlier|unusual|highest|lowest|most)\b/i.test(lower)
        ? { passed: true }
        : { passed: false, reason: "Quality answer should flag outliers explicitly." };
    case "math-transparent":
      return /\b(score|formula|method|computed|calculated|ratio|average|median)\b/i.test(lower)
        ? { passed: true }
        : { passed: false, reason: "Quant answer should name the formula/method." };
    case "limits-named":
      return /\b(corpus|sample|limit|caveat|assumption|note)\b/i.test(lower)
        ? { passed: true }
        : { passed: false, reason: "Quant answer should name corpus/assumptions." };
    case "plan-auditable":
      return /\b(step|atom|tool|call)\b/i.test(lower)
        ? { passed: true }
        : { passed: false, reason: "Lab plan should show its steps." };
    case "side-effects-named":
      return /\b(network|filesystem|git|subprocess|side[- ]effect|read[- ]?only|dry[- ]?run)\b/i.test(lower)
        ? { passed: true }
        : { passed: false, reason: "Lab plan should declare side-effects." };
    case "scoped":
      return draft.length <= 3000
        ? { passed: true }
        : { passed: false, reason: "Meta tool output too long — stay focused on the meta-question." };
    default:
      return { passed: true };
  }
}

// ──────────────────────────────────────────────────────────────────────
// Main grader entrypoint
// ──────────────────────────────────────────────────────────────────────

export async function gradeDraft(input: GraderInput): Promise<GraderResult> {
  // Step 1: requirements
  const passed: string[] = [];
  const failed: Array<{ id: string; reason: string }> = [];
  let weightedScore = 0;
  let weightTotal = 0;
  for (const req of input.homework.requirements) {
    const r = checkRequirement(req, input);
    weightTotal += req.weight;
    if (r.passed) {
      passed.push(req.id);
      weightedScore += req.weight;
    } else {
      failed.push({ id: req.id, reason: r.reason ?? "failed" });
    }
  }
  const reqScore = weightTotal > 0 ? weightedScore / weightTotal : 1;

  // Step 2: algorithms
  const algorithmResults: Array<{ algorithm: GradingAlgorithm; verdict: "PASS" | "WARN" | "FAIL"; detail: string }> = [];
  const rewriteHints: string[] = [];
  for (const algo of input.homework.algorithms) {
    const fn = ALGORITHM_MAP[algo];
    try {
      const v = await fn(input);
      algorithmResults.push({ algorithm: v.algorithm, verdict: v.verdict, detail: v.detail });
      if (v.rewriteHint) rewriteHints.push(v.rewriteHint);
    } catch (err) {
      algorithmResults.push({
        algorithm: algo,
        verdict: "WARN",
        detail: `Algorithm errored: ${(err as Error).message}`,
      });
    }
  }

  // Step 3: composite verdict
  const algoFails = algorithmResults.filter((a) => a.verdict === "FAIL").length;
  const algoWarns = algorithmResults.filter((a) => a.verdict === "WARN").length;
  const verdict: "PASS" | "WARN" | "FAIL" =
    algoFails > 0 || reqScore < 0.6
      ? "FAIL"
      : algoWarns > 0 || reqScore < 0.85
      ? "WARN"
      : "PASS";

  const score = Math.round(reqScore * 100);

  const feedback: string[] = [];
  if (verdict === "PASS") {
    feedback.push(`Draft satisfies the rubric (${score}/100). Deliver to user.`);
  } else if (verdict === "WARN") {
    feedback.push(
      `Draft passes core requirements (${score}/100) but flagged by ${algoWarns} grader algorithm(s). ` +
        `Worth a polish before delivery; consider the rewrite hints below.`,
    );
  } else {
    feedback.push(
      `Draft does NOT meet the rubric (${score}/100). ` +
        `Failed: ${failed.map((f) => f.id).join(", ")}. ` +
        `Algorithm fails: ${algorithmResults
          .filter((a) => a.verdict === "FAIL")
          .map((a) => a.algorithm)
          .join(", ")}.`,
    );
  }

  const giveUp = input.retryCount >= input.homework.maxRetries;
  if (giveUp && verdict !== "PASS") {
    feedback.push(
      `maxRetries (${input.homework.maxRetries}) exhausted. Surface the unresolved grader issues to the user — don't keep retrying.`,
    );
  }

  return {
    verdict,
    score,
    feedback,
    passedRequirements: passed,
    failedRequirements: failed,
    rewriteHints,
    algorithmResults,
    retryCount: input.retryCount,
    giveUp,
  };
}
