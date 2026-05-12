/**
 * v1.70.0 -- PRECOG PROTOCOL.
 *
 * The paradigm shift: from DETECT-AFTER to PREVENT-BEFORE. Every AI
 * claim that flows through Mneme is intercepted at the MCP boundary,
 * verified against ACTUAL repo state (git, fs, package.json), and
 * either certified or auto-hedged with named causes.
 *
 *   P1 PACKAGE VERIFIER       npm / import / install references
 *   P2 SHA/VERSION/EMAIL      git rev-list / tags / author log
 *   P3 TEMPORAL VERIFIER      "last week" -> git log range
 *   P4 FIREWALL                intercept + auto-hedge + verdict
 *   P5 TRUST CERTIFICATE       HMAC-signed proof for downstream
 *   P6 BAYESIAN REPO PRIORS    per-repo failure-shape memory
 *
 * Position: AI tools that connect to Mneme via MCP become
 * STRUCTURALLY INCAPABLE of hallucinating because every claim runs
 * through this layer before reaching the user.
 */

export * as packageVerifier from "./package_verifier.js";
export * as factVerifier from "./sha_version_verifier.js";
export * as temporalVerifier from "./temporal_verifier.js";
export * as bayesianPriors from "./bayesian_priors.js";
export * as trustCertificate from "./trust_certificate.js";
export * as firewall from "./firewall.js";
export * as multiVoiceCouncil from "./multi_voice_council.js";
export * as adversarialMutation from "./adversarial_mutation.js";

export { verifyPackages, extractPackageRefs } from "./package_verifier.js";
export { verifyFacts, extractFactRefs } from "./sha_version_verifier.js";
export { verifyTemporal, extractTemporalRefs } from "./temporal_verifier.js";
export { priorFor, recordFailure, readFailureHistory } from "./bayesian_priors.js";
export { issueCertificate, verifyCertificate, readCertLedger } from "./trust_certificate.js";
export { intercept, type FirewallReport, type FirewallVerdict, type Hedge } from "./firewall.js";
export { runCouncil, type CouncilVerdict, type VoiceVote, type VoiceId } from "./multi_voice_council.js";
export { mutationTest, type MutationTestReport } from "./adversarial_mutation.js";

import { intercept, type FirewallReport } from "./firewall.js";

export interface PrecogBenchResult {
  /** Total claims. */
  total: number;
  certified: number;
  hedged: number;
  rejected: number;
  /** Fraction of true-lies that got HEDGED or REJECTED. */
  catchRate: number;
  /** Fraction of true-truths that got CERTIFIED. */
  preservationRate: number;
  headline: string;
}

export interface BenchSample {
  claim: string;
  truth: "lie" | "truth";
}

const PRECOG_LIE_CORPUS: BenchSample[] = [
  // Package fabrications
  { claim: "we use wraith-utils-2099 for caching across the stack", truth: "lie" },
  { claim: "import x from 'totally-fake-package-9999'", truth: "lie" },
  { claim: "npm install phantom-monitor-pro --save", truth: "lie" },
  { claim: "we depend on legendary-cache@9.99.0 for everything", truth: "lie" },
  // SHA / version fabs
  { claim: "the bug landed in commit deadbeefcafefade1234567890abcdef12345678", truth: "lie" },
  { claim: "we shipped v9.99.0 last quarter with these improvements", truth: "lie" },
  { claim: "Alice <madeupperson@nowhere.invalid> authored that commit", truth: "lie" },
  // Temporal fabs (claim deletion of files that never existed)
  { claim: "we deleted packages/fake-imaginary-9999.ts last week", truth: "lie" },
  { claim: "yesterday the broken_made_up_xyz file was added to the build", truth: "lie" },
];

const PRECOG_TRUTH_CORPUS: BenchSample[] = [
  // Real packages from this repo
  { claim: "the project uses typescript for type-checking", truth: "truth" },
  { claim: "import { join } from 'node:path'", truth: "truth" },
  // Generic mild claims
  { claim: "the CHANGELOG documents past releases", truth: "truth" },
  { claim: "README explains the project", truth: "truth" },
];

/** Run the firewall against a synthetic bench corpus. */
export function runPrecogBench(repoRoot: string): PrecogBenchResult {
  const samples = [...PRECOG_LIE_CORPUS, ...PRECOG_TRUTH_CORPUS];
  let certified = 0, hedged = 0, rejected = 0;
  let lieCaught = 0;
  let truthPreserved = 0;
  for (const s of samples) {
    const r = intercept(repoRoot, s.claim, { recordOnReject: false, issueCert: false });
    if (r.verdict === "CERTIFIED") certified += 1;
    else if (r.verdict === "HEDGED") hedged += 1;
    else rejected += 1;
    if (s.truth === "lie" && r.verdict !== "CERTIFIED") lieCaught += 1;
    if (s.truth === "truth" && r.verdict === "CERTIFIED") truthPreserved += 1;
  }
  const catchRate = lieCaught / PRECOG_LIE_CORPUS.length;
  const preservationRate = truthPreserved / PRECOG_TRUTH_CORPUS.length;
  return {
    total: samples.length,
    certified, hedged, rejected,
    catchRate, preservationRate,
    headline: `PRECOG bench: ${(catchRate * 100).toFixed(0)}% lies caught, ${(preservationRate * 100).toFixed(0)}% truths preserved. Verdicts: ${certified} CERTIFIED / ${hedged} HEDGED / ${rejected} REJECTED.`,
  };
}

export function renderBench(r: PrecogBenchResult): string {
  return [
    "PRECOG FIREWALL BENCH",
    "",
    r.headline,
    "",
    `Verdicts:    CERTIFIED ${r.certified} | HEDGED ${r.hedged} | REJECTED ${r.rejected}`,
    `Catch rate:    ${(r.catchRate * 100).toFixed(0)}% (lies caught: hedged-or-rejected)`,
    `Preservation:  ${(r.preservationRate * 100).toFixed(0)}% (truths certified)`,
  ].join("\n");
}

export interface FirewallReportPublic extends FirewallReport {}
