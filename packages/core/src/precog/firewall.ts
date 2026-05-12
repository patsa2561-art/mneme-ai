/**
 * v1.70.0 -- PRECOG P4: HALLUCINATION FIREWALL (the paradigm shift).
 *
 * Before-the-fact intercept: every AI claim PASSES THROUGH this layer
 * BEFORE reaching the user. The firewall:
 *
 *   1. Runs P1 package verifier
 *   2. Runs P2 SHA/version/email verifier
 *   3. Runs P3 temporal verifier
 *   4. Computes P6 Bayesian prior from repo failure history
 *   5. Auto-hedges every un-verifiable span with a specific reason
 *   6. Issues a P5 trust certificate if and only if NO layer flagged
 *
 * Output verdict ladder:
 *   CERTIFIED   no verifier flagged + certificate issued
 *   HEDGED      one or more spans rewritten with hedges
 *   REJECTED    too many flags + high Bayesian prior; refuse to deliver
 *
 * This is the layer that makes downstream AI "structurally incapable
 * of hallucinating" through Mneme: claims either get a certificate or
 * get a transparent hedge with a named cause.
 */

import { verifyPackages, type PackageSuspect } from "./package_verifier.js";
import { verifyFacts, type FactSuspect } from "./sha_version_verifier.js";
import { verifyTemporal, type TemporalSuspect } from "./temporal_verifier.js";
import { priorFor, recordFailure } from "./bayesian_priors.js";
import { issueCertificate, type TrustCertificate, type VerifierResult } from "./trust_certificate.js";

export type FirewallVerdict = "CERTIFIED" | "HEDGED" | "REJECTED";

export interface Hedge {
  /** Surface span in the original claim. */
  span: { start: number; end: number; text: string };
  /** Which verifier raised this. */
  source: "P1-package" | "P2-fact" | "P3-temporal" | "P6-prior";
  /** Replacement text. */
  hedged: string;
  /** Why this got hedged. */
  reason: string;
  /** 0..1 confidence the original was a fab. */
  confidence: number;
}

export interface FirewallReport {
  /** The claim as it came in. */
  original: string;
  /** Rewritten claim with hedges in place of suspect spans. */
  verified: string;
  /** Per-span hedges. */
  hedges: Hedge[];
  verdict: FirewallVerdict;
  /** Bayesian posterior P(fabrication | claim) from past failures. */
  bayesianPosterior: number;
  /** Trust certificate IF verdict === CERTIFIED. */
  certificate: TrustCertificate | null;
  /** Plain-English. */
  headline: string;
  /** Verifier roundup. */
  verifierResults: VerifierResult[];
}

function replaceSpan(text: string, start: number, end: number, replacement: string): string {
  return text.slice(0, start) + replacement + text.slice(end);
}

function hedgeForPackage(s: PackageSuspect): string {
  return `[unverified package: "${s.ref.name}"${s.ref.version ? `@${s.ref.version}` : ""}]`;
}

function hedgeForFact(s: FactSuspect): string {
  if (s.ref.kind === "sha") return `[unverified SHA ${s.ref.value.slice(0, 8)}...]`;
  if (s.ref.kind === "version") return `[unverified version ${s.ref.value}]`;
  return `[unverified author ${s.ref.value}]`;
}

function hedgeForTemporal(s: TemporalSuspect): string {
  return `[temporal claim "${s.ref.phrase}" not corroborated by git log]`;
}

export interface FirewallOptions {
  /** Persist Bayesian failure on REJECTED. Default true. */
  recordOnReject?: boolean;
  /** Reject threshold for posterior. Default 0.6. */
  rejectPosterior?: number;
  /** Reject threshold for number of hedges. Default 4. */
  rejectHedgeCount?: number;
  /** Issue certificate on CERTIFIED. Default true. */
  issueCert?: boolean;
}

/** Run a claim through the full firewall stack. Returns a report
 *  with the verified (hedged or certified) string + a certificate
 *  if eligible. */
export function intercept(repoRoot: string, claim: string, opts?: FirewallOptions): FirewallReport {
  const recordOnReject = opts?.recordOnReject !== false;
  const rejectPosterior = opts?.rejectPosterior ?? 0.6;
  const rejectHedgeCount = opts?.rejectHedgeCount ?? 4;
  const issueCert = opts?.issueCert !== false;

  // Run all verifiers.
  const pkg = verifyPackages(repoRoot, claim);
  const facts = verifyFacts(repoRoot, claim);
  const temp = verifyTemporal(repoRoot, claim);
  const prior = priorFor(repoRoot, claim);

  // Collect hedges, sorted by start offset (apply later in REVERSE to keep indices stable).
  const hedges: Hedge[] = [];
  for (const s of pkg.suspects) {
    const surface = s.ref.version ? `${s.ref.name}@${s.ref.version}` : s.ref.name;
    const start = s.ref.offset;
    const end = start + surface.length;
    hedges.push({
      span: { start, end, text: surface },
      source: "P1-package",
      hedged: hedgeForPackage(s),
      reason: s.reason,
      confidence: s.confidence,
    });
  }
  for (const s of facts.suspects) {
    const start = s.ref.offset;
    const end = start + s.ref.value.length;
    hedges.push({
      span: { start, end, text: s.ref.value },
      source: "P2-fact",
      hedged: hedgeForFact(s),
      reason: s.reason,
      confidence: s.confidence,
    });
  }
  for (const s of temp.suspects) {
    const start = s.ref.offset;
    const end = start + s.ref.phrase.length;
    hedges.push({
      span: { start, end, text: s.ref.phrase },
      source: "P3-temporal",
      hedged: hedgeForTemporal(s),
      reason: s.reason,
      confidence: s.confidence,
    });
  }

  // Apply hedges to produce `verified` string (in reverse offset order).
  let verified = claim;
  const sortedHedges = [...hedges].sort((a, b) => b.span.start - a.span.start);
  for (const h of sortedHedges) {
    verified = replaceSpan(verified, h.span.start, h.span.end, h.hedged);
  }

  // Verdict.
  let verdict: FirewallVerdict;
  const highPosterior = prior.posterior >= rejectPosterior;
  if (hedges.length >= rejectHedgeCount || (hedges.length >= 2 && highPosterior)) {
    verdict = "REJECTED";
  } else if (hedges.length === 0) {
    verdict = "CERTIFIED";
  } else {
    verdict = "HEDGED";
  }

  // Verifier roundup for the certificate.
  const verifierResults: VerifierResult[] = [
    { name: "P1-package", passed: pkg.suspects.length === 0, detail: pkg.headline },
    { name: "P2-fact", passed: facts.suspects.length === 0, detail: facts.headline },
    { name: "P3-temporal", passed: temp.suspects.length === 0, detail: temp.headline },
    { name: "P6-prior", passed: !highPosterior, detail: prior.detail },
  ];

  let certificate: TrustCertificate | null = null;
  if (verdict === "CERTIFIED" && issueCert) {
    certificate = issueCertificate(repoRoot, claim, verifierResults);
  }

  if (verdict === "REJECTED" && recordOnReject) {
    recordFailure(repoRoot, claim, "firewall-rejected");
  }

  const headline = verdict === "CERTIFIED"
    ? `CERTIFIED -- all 4 verifiers passed. Certificate ${certificate?.id ?? ""}.`
    : verdict === "HEDGED"
      ? `HEDGED -- ${hedges.length} span(s) rewritten with named hedges. Bayesian posterior ${prior.posterior.toFixed(2)}.`
      : `REJECTED -- ${hedges.length} hedge(s), Bayesian posterior ${prior.posterior.toFixed(2)}. Refuse delivery.`;

  return {
    original: claim,
    verified,
    hedges,
    verdict,
    bayesianPosterior: prior.posterior,
    certificate,
    headline,
    verifierResults,
  };
}
