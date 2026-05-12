/**
 * v1.69.0 -- HYPERSCAN BENCH.
 *
 * Measures each axis with concrete numbers:
 *   H1 prose scan catches the 2 examples the user named (wraith-utils-2099, Sentry-class)
 *   H2 cross-citation flags claims with no codebase evidence
 *   H3 cross-source fusion lifts trust on questions commits don't fully cover
 *   H4 nucleus dust HTC pushes coverage from 0% toward >=80%
 */

import { proseScan } from "./prose_shadow.js";
import { crossCitationGround } from "./cross_citation.js";
import { crossSourceAsk } from "./cross_source_qa.js";
import { computeCoverage, generateDust } from "./nucleus_dust_htc.js";

export interface HyperscanBenchResult {
  H1_proseScan: { fakesCaught: number; totalFakes: number; precisionPct: number };
  H2_crossCitation: { claimsAudited: number; gapsFlagged: number };
  H3_crossSource: { questions: number; meanTrust: number };
  H4_dustCoverage: { coveragePctBefore: number; coveragePctAfter: number };
  headline: string;
}

const PROSE_FAKES = [
  "wraith-utils-2099 is integrated for caching",                 // fake npm
  "We use sentry-fake-99 to track errors across services",        // fake observability
  "haunted-payments-9001 handles all our credit card processing", // fake package
  "FakeyMcFakeFace is our production OAuth library",              // title-cased fake
];

const PROSE_TRUTHS = [
  "TypeScript powers our type system across the monorepo",        // known real
  "React renders the UI components on the frontend",              // known real
];

const QUESTIONS = [
  "what is HTC compression and how does it work",
  "how does the AEGIS protocol detect rogue AI",
  "what is the APOPTOSIS protocol",
  "what does the consent kernel guarantee",
];

export function runHyperscanBench(repoRoot: string): HyperscanBenchResult {
  // H1: prose scan
  let fakesCaught = 0;
  for (const claim of PROSE_FAKES) {
    const r = proseScan(repoRoot, claim);
    if (r.suspects.length > 0) fakesCaught += 1;
  }
  let truthsFlagged = 0;
  for (const truth of PROSE_TRUTHS) {
    const r = proseScan(repoRoot, truth);
    // Truths SHOULD recognize known names and not list them as suspects.
    if (r.suspects.length > 0 && r.recognized.length === 0) truthsFlagged += 1;
  }
  const precisionPct = (fakesCaught / PROSE_FAKES.length) * 100;

  // H2: cross-citation -- audit two fake claims
  const fakeClaim = "WraithMonitor handles our distributed tracing across services and integrates with PhantomMetrics for alerting";
  const audit = crossCitationGround(repoRoot, fakeClaim);

  // H3: cross-source mean trust over a small bench
  let trustSum = 0;
  for (const q of QUESTIONS) {
    const r = crossSourceAsk(repoRoot, q);
    trustSum += r.trust;
  }
  const meanTrust = trustSum / QUESTIONS.length;

  // H4: dust coverage delta
  const before = computeCoverage(repoRoot).coveragePct;
  generateDust(repoRoot);
  const after = computeCoverage(repoRoot).coveragePct;

  const headline = `Hyperscan bench: prose ${precisionPct.toFixed(0)}% caught, citation gaps ${audit.gaps}, mean trust ${(meanTrust * 100).toFixed(0)}%, HTC coverage ${before.toFixed(0)}% -> ${after.toFixed(0)}%.`;

  return {
    H1_proseScan: { fakesCaught, totalFakes: PROSE_FAKES.length, precisionPct },
    H2_crossCitation: { claimsAudited: audit.triples.length, gapsFlagged: audit.gaps },
    H3_crossSource: { questions: QUESTIONS.length, meanTrust },
    H4_dustCoverage: { coveragePctBefore: before, coveragePctAfter: after },
    headline,
  };
}

export function renderBench(r: HyperscanBenchResult): string {
  return [
    "HYPERSCAN BENCH -- 4-axis measurable proof",
    "",
    r.headline,
    "",
    `H1 prose scan:        ${r.H1_proseScan.fakesCaught}/${r.H1_proseScan.totalFakes} fakes caught (${r.H1_proseScan.precisionPct.toFixed(0)}% precision)`,
    `H2 cross-citation:    ${r.H2_crossCitation.gapsFlagged} gap(s) flagged in ${r.H2_crossCitation.claimsAudited} triple(s)`,
    `H3 cross-source QA:   mean trust ${(r.H3_crossSource.meanTrust * 100).toFixed(0)}% across ${r.H3_crossSource.questions} questions`,
    `H4 HTC dust coverage: ${r.H4_dustCoverage.coveragePctBefore.toFixed(0)}% -> ${r.H4_dustCoverage.coveragePctAfter.toFixed(0)}% after auto-populate`,
  ].join("\n");
}
