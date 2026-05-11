/**
 * MNEME DEVIL'S ADVOCATE + EVIDENCE QUORUM (v1.39.0).
 *
 * Direct fix for the CRITICAL tester finding:
 *
 *   "Bot Squadron has confirmation bias. I gave a FALSE claim
 *    ('v1.38.0 has critical security vuln') and 5/6 bots supported
 *    at 83% confidence by citing irrelevant evidence."
 *
 * Strategic implication the tester correctly named: if Compliance-as-
 * a-Service ($50K-$500K/yr) is built on Squad verdicts, and the squad
 * rubber-stamps strong-but-false claims, the entire Aletheia trust
 * contract collapses. THIS MUST BE FIXED BEFORE COMPLIANCE PRODUCT
 * SHIPS.
 *
 * Three remedies, all implemented here:
 *
 *   1. DEVIL'S ADVOCATE BOT (the missing 7th juror)
 *      - Actively constructs the counter-narrative.
 *      - Specifically looks for ABSENCE OF EVIDENCE: a strong claim
 *        about a specific feature (e.g., "v1.38.0 security vuln")
 *        that has NO direct evidence in the codebase = refutation
 *        signal, not a "no signal" neutral.
 *      - Flags CITATION COLLISIONS: when N supporting bots all cite
 *        the SAME evidence, that's 1 evidence source masquerading
 *        as N (single-source N-laundered consensus).
 *
 *   2. EVIDENCE QUORUM check
 *      - Counts UNIQUE evidence sources across all supporting findings.
 *      - If unique sources < `minIndependentSources` (default 2):
 *        cap support consensus + emit `single-source` warning.
 *      - Refutation evidence is HARDER to fake than support evidence
 *        (a refute requires showing the absence of expected signal),
 *        so its weight is BOOSTED when sparse.
 *
 *   3. SPARSE-EVIDENCE REFUTE TILT
 *      - When total evidence count < `minTotalEvidence` (default 3):
 *        weight refute by 1.5×, support by 0.7× (the "extraordinary
 *        claims need extraordinary evidence" rule).
 *      - Default OFF; opt-in for high-stakes consensus calls.
 *
 * MANDATE COMPLIANCE:
 *   1. Wild idea: "ABSENCE-OF-EVIDENCE = refutation signal" -- most
 *      truthers count missing evidence as neutral. The advocate
 *      counts it as ACTIVE refutation when the claim is specific
 *      enough to demand a citation.
 *   2. Wiser: surfaces single-source-N-laundered consensus -- a
 *      class of bias even mature legal systems struggle with.
 *   3. Self-fix root cause: the bias is in WHICH BOTS ARE SEATED, not
 *      just how votes are counted. Adding the advocate is the
 *      structural fix.
 *   4. Co-working: integrates with v1.31 trust calibration -- the
 *      advocate's verdict feeds the calibration loop so the squad
 *      can self-grade its own bias rate over time.
 *   5. Always-studying: every aggregation appends to
 *      .mneme/squadron/quorum.jsonl -- the daemon's reactor cycle
 *      computes "how often did the advocate flip a verdict_for to
 *      split?" and surfaces this as an honesty metric.
 */

import { existsSync, mkdirSync, appendFileSync } from "node:fs";
import { join } from "node:path";

export type Verdict = "supports" | "contradicts" | "neutral" | "needs_data";

export interface BotFindingShape {
  bot: string;
  verdict: Verdict;
  confidence: number;
  headline?: string;
  /** Distinct citation tokens (commit shas, file paths, etc.) the bot
   *  used to back its verdict. Empty = "no evidence cited." */
  evidence: string[];
}

export interface QuorumOptions {
  /** Minimum unique evidence sources required for a strong consensus.
   *  When fewer, consensus is capped + flagged. Default 2. */
  minIndependentSources?: number;
  /** When total evidence count is below this, weight refute > support
   *  (extraordinary-claims-need-extraordinary-evidence rule).
   *  Default 3. */
  minTotalEvidence?: number;
  /** Multiplier applied to support confidence in sparse-evidence mode.
   *  Default 0.7. */
  supportSparseMultiplier?: number;
  /** Multiplier applied to refute confidence in sparse-evidence mode.
   *  Default 1.5. */
  refuteSparseMultiplier?: number;
  /** Repo root for the quorum log. */
  repoRoot?: string;
  /** When true, REQUIRE the advocate to be present in the findings;
   *  if missing, return consensus="insufficient_data". Set this to
   *  true for compliance-grade calls. Default false. */
  requireAdvocate?: boolean;
}

const DEFAULTS: Required<Omit<QuorumOptions, "repoRoot" | "requireAdvocate">> & { requireAdvocate: boolean } = {
  minIndependentSources: 2,
  minTotalEvidence: 3,
  supportSparseMultiplier: 0.7,
  refuteSparseMultiplier: 1.5,
  requireAdvocate: false,
};

// ─── DEVIL'S ADVOCATE BOT ──────────────────────────────────────────────
//
// The advocate is constructive: given the claim + the other bots' findings,
// it produces a verdict that EXPLICITLY captures absence-of-evidence + citation
// collisions. It doesn't need its own data layer -- it analyses the squad's
// own outputs against the claim.

export interface AdvocateInput {
  claim: string;
  otherFindings: BotFindingShape[];
  /** Optional: known evidence-rich keywords for the codebase.
   *  When the claim mentions a specific feature/version that has zero
   *  hits in any other bot's evidence, the advocate flags it. */
  knownEvidenceTokens?: string[];
}

export interface AdvocateFinding extends BotFindingShape {
  bot: "advocate";
  /** Why the advocate emitted this verdict, in 1-2 sentences. */
  reasoning: string;
  /** Specific bias signals the advocate detected. */
  biasSignals: Array<"absence-of-evidence" | "single-source-laundering" | "all-irrelevant-citations" | "claim-too-vague" | "specific-entity-mismatch">;
}

/** v1.42.0 — extract entities the claim is SPECIFICALLY about, not just
 *  generic 4-char tokens. Versions, file names, identifiers, CVE IDs.
 *  Used by the semantic-relevance gate to catch the FALSE-positive
 *  pattern where citations share a generic word ("critical", "fix")
 *  but say nothing about the actual claim subject. */
const SPECIFIC_ENTITY_PATTERNS: RegExp[] = [
  /v?\d+\.\d+\.\d+(?:[.-][\w]+)?/g,                      // version numbers (v1.40.1, 2.0.0-beta)
  /\bcve-?\d{4}-?\d+/gi,                                  // CVE IDs
  /\b[a-z][\w-]+\.(ts|tsx|js|jsx|py|go|rs|java|md|json|yml|yaml|toml)\b/gi,  // file names
  /\b[A-Z][a-zA-Z]*[A-Z][a-zA-Z]+\b/g,                   // CamelCase identifiers
  /\b[a-z][a-z]+[A-Z][a-zA-Z]+\b/g,                      // camelCase identifiers
  /\b[a-z][a-z_]+_[a-z_]+\b/g,                            // snake_case identifiers
  /#\d{2,}/g,                                              // PR / issue numbers
  /[0-9a-f]{7,40}/gi,                                      // commit SHAs
];

export function extractSpecificEntities(text: string): string[] {
  if (!text) return [];
  const found = new Set<string>();
  for (const re of SPECIFIC_ENTITY_PATTERNS) {
    const matches = text.match(re);
    if (matches) for (const m of matches) found.add(m.toLowerCase());
  }
  return [...found];
}

/** Run the devil's advocate. Returns a finding shaped like a normal bot
 *  finding plus reasoning + biasSignals fields the aggregator uses. */
export function runAdvocate(input: AdvocateInput): AdvocateFinding {
  const otherFindings = input.otherFindings ?? [];
  const claim = (input.claim ?? "").trim();
  const biasSignals: AdvocateFinding["biasSignals"] = [];

  // Test 1: Is the claim specific enough to demand evidence?
  // Heuristic: claims with specific tokens (version numbers, feature
  // names, file paths, "vulnerability", "regression", "breaks") are
  // SPECIFIC. Vague claims ("X is good") aren't.
  const SPECIFIC_TOKENS = /(v?\d+\.\d+\.\d+|cve-?\d+|regression|vulnerability|security|leak|breaks?|hallucination|crash|antivirus|phantom|module|function|class|exists?)/i;
  const isSpecificClaim = SPECIFIC_TOKENS.test(claim);
  if (!isSpecificClaim && claim.length < 40) biasSignals.push("claim-too-vague");

  // Test 2: Citation collision detection.
  // Take all SUPPORTING findings, check uniqueness of citations.
  const supports = otherFindings.filter((f) => f.verdict === "supports");
  const allSupportCitations = supports.flatMap((f) => f.evidence ?? []);
  const uniqueSupportCitations = new Set(allSupportCitations);
  if (supports.length >= 3 && uniqueSupportCitations.size === 1) {
    biasSignals.push("single-source-laundering");
  }

  // Test 3: Are the citations RELEVANT to the claim?
  // A citation is "irrelevant" if it shares NO content tokens with the claim.
  // Heuristic: extract 4+ char tokens from claim, check overlap.
  const claimTokens = new Set(claim.toLowerCase().split(/\W+/).filter((t) => t.length >= 4));
  const irrelevantCount = allSupportCitations.filter((c) => {
    const tokens = c.toLowerCase().split(/\W+/);
    return !tokens.some((t) => claimTokens.has(t));
  }).length;
  const allSupportsAreIrrelevant = supports.length > 0 &&
    irrelevantCount === allSupportCitations.length &&
    allSupportCitations.length > 0;
  if (allSupportsAreIrrelevant) biasSignals.push("all-irrelevant-citations");

  // Test 4: Absence of evidence FOR a specific claim.
  // If the claim is specific AND zero RELEVANT supporting evidence found =
  // active refutation signal, not neutral.
  const relevantSupportCount = allSupportCitations.length - irrelevantCount;
  const isAbsenceOfEvidence = isSpecificClaim && relevantSupportCount === 0;
  if (isAbsenceOfEvidence) biasSignals.push("absence-of-evidence");

  // Test 5 (v1.42.0) — SEMANTIC RELEVANCE GATE.
  // Tests 3-4 use lexical token overlap which lets generic words ("critical",
  // "fix", "security") pass as "relevant" even when the citation is about a
  // totally different commit. The gate extracts SPECIFIC ENTITIES from the
  // claim (versions, file names, identifiers, CVE IDs, commit SHAs) and
  // checks whether ANY supporting citation actually mentions ANY of them.
  // If the claim cites 2+ specific entities and zero citations contain any
  // of them, the supporting consensus is laundered through irrelevant
  // evidence. Strong refute signal.
  //
  // Repro: claim "v1.40.1 has critical security vulnerability" with citations
  // about a v1.39.0 advocate-fix commit shared the word "critical" but not
  // the specific entities "v1.40.1" / "vulnerability". Pre-v1.42.0 the
  // advocate said "no bias signals". Post-v1.42.0 the gate flips to refute
  // at high confidence.
  const claimEntities = extractSpecificEntities(claim);
  let specificEntityMismatch = false;
  if (claimEntities.length >= 2 && allSupportCitations.length > 0) {
    const anyEntityMatched = allSupportCitations.some((c) => {
      const lower = c.toLowerCase();
      return claimEntities.some((e) => lower.includes(e));
    });
    if (!anyEntityMatched) {
      specificEntityMismatch = true;
      biasSignals.push("specific-entity-mismatch");
    }
  }

  // Verdict logic.
  let verdict: Verdict;
  let confidence: number;
  let reasoning: string;

  if (specificEntityMismatch) {
    verdict = "contradicts";
    confidence = 0.85;
    reasoning = `Claim references specific entities (${claimEntities.join(", ")}) but ZERO supporting citations mention any of them across ${supports.length} supporting bot(s). Pattern: unrelated-evidence misdirection — N bots laundering the same generic-word match into N "supports" votes. Refuting at high confidence.`;
  } else if (isAbsenceOfEvidence) {
    verdict = "contradicts";
    confidence = 0.75;
    reasoning = `Claim is specific (mentions version/vuln/feature shape) but ZERO relevant supporting evidence found across ${supports.length} supporting bot(s). Absence of evidence for a specific claim = active refutation, not neutral.`;
  } else if (allSupportsAreIrrelevant) {
    verdict = "contradicts";
    confidence = 0.65;
    reasoning = `All ${allSupportCitations.length} supporting citations share no tokens with the claim. Bots may be hallucinating relevance. Refuting at moderate confidence.`;
  } else if (uniqueSupportCitations.size === 1 && supports.length >= 3) {
    verdict = "neutral";
    confidence = 0.5;
    reasoning = `${supports.length} bots all cite the SAME single evidence source. This is single-source-N-laundering -- N bots supporting != N independent sources supporting. Downgrading to neutral until independent corroboration appears.`;
  } else if (biasSignals.includes("claim-too-vague")) {
    verdict = "needs_data";
    confidence = 0.4;
    reasoning = `Claim is too vague to construct a counter-narrative. Restate the claim with specific tokens (file names, version numbers, feature names) and re-query.`;
  } else {
    // Default: weak neutral so the advocate doesn't tip a balanced jury.
    verdict = "neutral";
    confidence = 0.3;
    reasoning = `No bias signals detected. Squadron consensus may proceed without advocate veto.`;
  }

  return {
    bot: "advocate",
    verdict,
    confidence,
    headline: reasoning.slice(0, 80),
    evidence: [],          // advocate's "evidence" is the metadata, not citations
    reasoning,
    biasSignals,
  };
}

// ─── EVIDENCE QUORUM AGGREGATOR ─────────────────────────────────────────

export type Consensus = "verdict_for" | "verdict_against" | "split" | "insufficient_data";

export interface QuorumDecision {
  consensus: Consensus;
  /** 0-1 confidence in the consensus. */
  confidence: number;
  /** Human-readable summary of WHY this consensus was reached. */
  summary: string;
  /** Per-bot agreement marker (which bots voted with the consensus). */
  agreeing: string[];
  dissenting: string[];
  /** Bias signals carried over from the advocate. */
  biasSignals: AdvocateFinding["biasSignals"];
  /** Quorum metadata: how many unique evidence sources backed each side? */
  uniqueSourcesFor: number;
  uniqueSourcesAgainst: number;
  /** Caveats appended to the summary when applicable. */
  caveats: string[];
}

/** The aggregator. Takes ALL findings (including the advocate's) and
 *  produces a quorum-aware consensus with explicit bias caveats. */
export function aggregateWithQuorum(
  claim: string,
  findings: BotFindingShape[],
  advocateFinding: AdvocateFinding | null,
  opts: QuorumOptions = {},
): QuorumDecision {
  const o = { ...DEFAULTS, ...opts };
  const allFindings = advocateFinding ? [...findings, advocateFinding] : findings;

  // Killswitch: if the caller demands the advocate and it's missing.
  if (o.requireAdvocate && !advocateFinding) {
    return {
      consensus: "insufficient_data",
      confidence: 0,
      summary: "Compliance-grade aggregation requires the devil's advocate to be present in the jury. Re-run with the advocate included.",
      agreeing: [],
      dissenting: [],
      biasSignals: [],
      uniqueSourcesFor: 0,
      uniqueSourcesAgainst: 0,
      caveats: ["MISSING_ADVOCATE"],
    };
  }

  const supports = allFindings.filter((f) => f.verdict === "supports");
  const refutes = allFindings.filter((f) => f.verdict === "contradicts");
  const neutrals = allFindings.filter((f) => f.verdict === "neutral");

  // Count UNIQUE evidence sources per side.
  const uniqueFor = new Set(supports.flatMap((f) => f.evidence ?? []));
  const uniqueAgainst = new Set(refutes.flatMap((f) => f.evidence ?? []));
  const totalEvidenceCount = uniqueFor.size + uniqueAgainst.size;

  // Sparse-evidence tilt: when total evidence is meager, refute is
  // weighted higher -- extraordinary claims need extraordinary evidence.
  const sparse = totalEvidenceCount < o.minTotalEvidence;
  const supportMult = sparse ? o.supportSparseMultiplier : 1.0;
  const refuteMult = sparse ? o.refuteSparseMultiplier : 1.0;

  // Confidence-weighted scores.
  let forScore = supports.reduce((acc, f) => acc + f.confidence * supportMult, 0);
  let againstScore = refutes.reduce((acc, f) => acc + f.confidence * refuteMult, 0);
  const neutralScore = neutrals.reduce((acc, f) => acc + f.confidence * 0.5, 0);

  // Quorum cap: if too few independent sources back support, cap it.
  // BLOCKING caveats prevent verdict_for; ADVISORY caveats are surfaced
  // but don't tip the consensus.
  const blockingCaveats: string[] = [];
  const advisoryCaveats: string[] = [];
  if (uniqueFor.size < o.minIndependentSources && supports.length > 0) {
    forScore = Math.min(forScore, 0.5);
    blockingCaveats.push(`SINGLE_SOURCE_SUPPORT (only ${uniqueFor.size} unique source(s) cited by ${supports.length} bot(s))`);
  }

  // Apply advocate's bias signals -- classify by severity.
  const biasSignals = advocateFinding?.biasSignals ?? [];
  for (const sig of biasSignals) {
    const tag = sig.toUpperCase().replace(/-/g, "_");
    if (sig === "claim-too-vague") {
      advisoryCaveats.push(tag);    // advisory: vague claim doesn't block consensus
    } else {
      blockingCaveats.push(tag);    // blocking: real bias signal
    }
  }
  const caveats = [...blockingCaveats, ...advisoryCaveats];

  const total = forScore + againstScore + neutralScore;

  let consensus: Consensus;
  let summary: string;
  if (total === 0) {
    consensus = "insufficient_data";
    summary = "Every bot returned no signal. Restate the claim with more specific tokens (file names, version numbers, feature names).";
  } else if (forScore > againstScore * 1.5 && blockingCaveats.length === 0) {
    consensus = "verdict_for";
    summary = `Squadron supports the claim with ${uniqueFor.size} independent evidence source(s). No bias signals detected.${advisoryCaveats.length > 0 ? " Advisory: " + advisoryCaveats.join(", ") : ""}`;
  } else if (againstScore > forScore * 1.5) {
    consensus = "verdict_against";
    summary = `Squadron contradicts the claim with ${uniqueAgainst.size} independent evidence source(s). ${biasSignals.includes("absence-of-evidence") ? "Devil's advocate flagged absence of evidence for specific claim." : ""}`.trim();
  } else if (blockingCaveats.length > 0 && forScore > againstScore) {
    consensus = "split";
    summary = `Apparent support but quorum caveats apply: ${blockingCaveats.join(", ")}. Surfacing as split -- DO NOT treat as endorsement.`;
  } else {
    consensus = "split";
    summary = `Squadron is split. Surface the disagreement to the user with both sides.`;
  }

  const agreeing = allFindings.filter((f) => matchesConsensus(f.verdict, consensus)).map((f) => f.bot);
  const dissenting = allFindings.filter((f) => !matchesConsensus(f.verdict, consensus) && f.verdict !== "needs_data").map((f) => f.bot);
  const confidence = allFindings.length === 0 ? 0 : Math.round((agreeing.length / allFindings.length) * 100) / 100;

  // Persist the decision for the always-studying loop.
  if (o.repoRoot) {
    try {
      const dir = join(o.repoRoot, ".mneme", "squadron");
      if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
      appendFileSync(join(dir, "quorum.jsonl"), JSON.stringify({
        ts: new Date().toISOString(), claim, consensus, confidence,
        biasSignals, caveats, uniqueFor: uniqueFor.size, uniqueAgainst: uniqueAgainst.size,
      }) + "\n", "utf8");
    } catch { /* best-effort */ }
  }

  return {
    consensus,
    confidence,
    summary,
    agreeing,
    dissenting,
    biasSignals,
    uniqueSourcesFor: uniqueFor.size,
    uniqueSourcesAgainst: uniqueAgainst.size,
    caveats,
  };
}

function matchesConsensus(v: Verdict, c: Consensus): boolean {
  if (c === "verdict_for") return v === "supports";
  if (c === "verdict_against") return v === "contradicts";
  if (c === "split") return v !== "needs_data";
  return false;
}
