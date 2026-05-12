/**
 * v1.71.0 -- PRECOG +C1: MULTI-VOICE COUNCIL.
 *
 * Push PRECOG catch rate from 92.9% toward 98%+. Instead of a single
 * verifier-pass, run the claim through FIVE distinct voices, each
 * with a different cognitive bias:
 *
 *   V1 PACKAGE-PEDANT      extra strict on package names + versions
 *   V2 TEMPORAL-PARANOID    extra strict on time claims
 *   V3 HUMILITY-ZEALOT      extra strict on absolute speech
 *   V4 CITATION-NIGGLE       requires every entity to have a citation
 *   V5 NOVELTY-SUSPICION     flags shapes not seen in repo history
 *
 * Majority vote -> hedge if 3+/5 voices say "suspect". Breaks the
 * "PRECOG missed because one regex didn't fire" failure mode by
 * needing redundant agreement.
 *
 * The wild bit: voices use DIFFERENT THRESHOLDS for the same
 * underlying checker. V1 might flag "X@1.0.0" at 0.4 confidence
 * while the default PRECOG only flags at 0.6. The council compares
 * how many voices agree at THEIR individual threshold.
 */

import { verifyPackages } from "./package_verifier.js";
import { verifyFacts } from "./sha_version_verifier.js";
import { verifyTemporal } from "./temporal_verifier.js";
import { priorFor } from "./bayesian_priors.js";

export type VoiceId = "V1-package-pedant" | "V2-temporal-paranoid" | "V3-humility-zealot" | "V4-citation-niggle" | "V5-novelty-suspicion";

export interface VoiceVote {
  voice: VoiceId;
  /** This voice's verdict: "hedge" / "pass" / "abstain". */
  vote: "hedge" | "pass" | "abstain";
  /** Confidence in this vote 0..1. */
  confidence: number;
  /** Plain-English why. */
  reason: string;
}

export interface CouncilVerdict {
  votes: VoiceVote[];
  hedgeVotes: number;
  passVotes: number;
  abstainVotes: number;
  /** Final verdict: HEDGE if hedge >= majorityThreshold (default 3). */
  verdict: "HEDGE" | "PASS" | "TIE";
  /** Plain-English headline. */
  headline: string;
}

const ABSOLUTES = ["always", "never", "guaranteed", "100%", "absolutely", "perfect", "flawless", "every", "all", "none"];

function v1_packagePedant(repoRoot: string, claim: string): VoiceVote {
  const r = verifyPackages(repoRoot, claim);
  // Pedant lowers threshold: even single suspect package = hedge.
  if (r.suspects.length === 0) return { voice: "V1-package-pedant", vote: "abstain", confidence: 1, reason: "no package refs found" };
  return { voice: "V1-package-pedant", vote: "hedge", confidence: 0.95, reason: `pedant: ${r.suspects.length} suspect package(s)` };
}

function v2_temporalParanoid(repoRoot: string, claim: string): VoiceVote {
  const r = verifyTemporal(repoRoot, claim);
  if (r.refs.length === 0) return { voice: "V2-temporal-paranoid", vote: "abstain", confidence: 1, reason: "no temporal claims" };
  // Paranoid: ANY un-corroborated temporal claim hedges, even if just 1 of N.
  if (r.suspects.length >= 1) return { voice: "V2-temporal-paranoid", vote: "hedge", confidence: 0.9, reason: `paranoid: ${r.suspects.length} un-corroborated temporal claim(s)` };
  return { voice: "V2-temporal-paranoid", vote: "pass", confidence: 0.85, reason: "all temporal claims corroborated by git log" };
}

function v3_humilityZealot(_repoRoot: string, claim: string): VoiceVote {
  let absCount = 0;
  const lower = claim.toLowerCase();
  for (const a of ABSOLUTES) {
    const re = new RegExp(`\\b${a}\\b`, "g");
    const m = lower.match(re);
    if (m) absCount += m.length;
  }
  if (absCount >= 2) return { voice: "V3-humility-zealot", vote: "hedge", confidence: 0.9, reason: `zealot: ${absCount} absolute terms` };
  if (absCount === 1) return { voice: "V3-humility-zealot", vote: "hedge", confidence: 0.6, reason: `zealot: 1 absolute term` };
  return { voice: "V3-humility-zealot", vote: "pass", confidence: 0.8, reason: "no absolutes" };
}

function v4_citationNiggle(repoRoot: string, claim: string): VoiceVote {
  // Use the fact-verifier as the citation proxy: any unverifiable
  // entity = niggle hedges.
  const r = verifyFacts(repoRoot, claim);
  if (r.refs.length === 0) return { voice: "V4-citation-niggle", vote: "abstain", confidence: 1, reason: "no fact refs to cite" };
  if (r.suspects.length > 0) return { voice: "V4-citation-niggle", vote: "hedge", confidence: 0.85, reason: `niggle: ${r.suspects.length} uncited fact(s)` };
  return { voice: "V4-citation-niggle", vote: "pass", confidence: 0.85, reason: "all facts cited" };
}

function v5_noveltySuspicion(repoRoot: string, claim: string): VoiceVote {
  const p = priorFor(repoRoot, claim);
  // Novelty: claims whose simhash matches PAST FAILURES are suspect.
  if (p.posterior >= 0.3) return { voice: "V5-novelty-suspicion", vote: "hedge", confidence: 0.8, reason: `novelty: posterior ${p.posterior.toFixed(2)} matches past failures` };
  if (p.topNeighbors.length === 0) return { voice: "V5-novelty-suspicion", vote: "abstain", confidence: 0.6, reason: "no failure history" };
  return { voice: "V5-novelty-suspicion", vote: "pass", confidence: 0.7, reason: "no near-neighbor failures" };
}

export interface CouncilOptions {
  /** Majority threshold (default 3 of 5). */
  majority?: number;
  /** Skip specific voices. */
  skipVoices?: VoiceId[];
}

export function runCouncil(repoRoot: string, claim: string, opts?: CouncilOptions): CouncilVerdict {
  const majority = opts?.majority ?? 3;
  const skip = new Set(opts?.skipVoices ?? []);
  const votes: VoiceVote[] = [];
  if (!skip.has("V1-package-pedant")) votes.push(v1_packagePedant(repoRoot, claim));
  if (!skip.has("V2-temporal-paranoid")) votes.push(v2_temporalParanoid(repoRoot, claim));
  if (!skip.has("V3-humility-zealot")) votes.push(v3_humilityZealot(repoRoot, claim));
  if (!skip.has("V4-citation-niggle")) votes.push(v4_citationNiggle(repoRoot, claim));
  if (!skip.has("V5-novelty-suspicion")) votes.push(v5_noveltySuspicion(repoRoot, claim));

  const hedge = votes.filter((v) => v.vote === "hedge").length;
  const pass = votes.filter((v) => v.vote === "pass").length;
  const abst = votes.filter((v) => v.vote === "abstain").length;

  let verdict: CouncilVerdict["verdict"];
  if (hedge >= majority) verdict = "HEDGE";
  else if (pass >= majority) verdict = "PASS";
  else verdict = "TIE";

  const headline = `Council: ${hedge} hedge / ${pass} pass / ${abst} abstain -> ${verdict}.`;

  return { votes, hedgeVotes: hedge, passVotes: pass, abstainVotes: abst, verdict, headline };
}
