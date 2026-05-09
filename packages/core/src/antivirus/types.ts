/**
 * Mneme Antivirus -- type definitions.
 *
 * Hallucination-as-virus model:
 *   strain  = a class of hallucination with a stable signature + assay
 *   vaccine = an antibody molecule (atom combination) that detects the
 *             strain in a draft AND optionally proposes a cure
 *   pharmacopoeia = the inventory of vaccines this repo has shipped
 *                   (inheritable via MneMeiosis chromosomes)
 *   benchmark = a reproducible HMAC-signed test suite that produces
 *               an honest efficacy score for each vaccine
 */

/** Stable id for a hallucination strain. Latin-style names so the
 *  taxonomy reads like a real medical registry. */
export type StrainId =
  | "citatio_viridis"      // commit hash that doesn't exist in repo
  | "persona_fictum"       // author name not present in git history
  | "api_phantasma"        // function/identifier reference with no definition
  | "depends_imaginarium"  // npm dep that isn't installed/published
  | "tempus_perversum"     // date that doesn't match the cited event
  | "confidens_cardinalis" // numeric count off by more than tolerance
  | "structura_invenita"   // file/path that doesn't exist
  | "logica_circularis";   // claim graph contains a cycle

export interface Strain {
  id: StrainId;
  /** Latin name (formal). */
  scientificName: string;
  /** Plain English / Thai-friendly common name. */
  commonName: string;
  /** One-line description of the failure mode. */
  pathogenesis: string;
  /** Severity 1 (cosmetic) -> 5 (catastrophic). */
  severity: 1 | 2 | 3 | 4 | 5;
  /** Genetic signature: what shape this hallucination takes in text. */
  signature: {
    /** Regex(es) that match the SURFACE form of the claim. */
    patterns: string[];
    /** Description of the pattern for human review. */
    explanation: string;
  };
}

/** A claim extracted from a draft, suspected of being infected. */
export interface SuspectClaim {
  /** Strain that this claim resembles. */
  strain: StrainId;
  /** The exact substring of the draft that matched the signature. */
  match: string;
  /** Character offset in the draft where the match starts. */
  offset: number;
  /** Confidence 0..1 that the surface match really represents an instance
   *  of this strain. (1.0 = pattern is a near-certain indicator.) */
  surfaceConfidence: number;
}

/** Result of running a vaccine's assay against a single suspect claim. */
export interface AssayResult {
  /** The suspect claim that was tested. */
  claim: SuspectClaim;
  /** True iff the assay confirmed an infection. */
  infected: boolean;
  /** Why the assay returned what it did (audit trail). */
  evidence: string;
  /** When `infected: true`, an optional suggested correction the AI
   *  agent can use to neutralize. Plain text; ASCII-safe. */
  cure?: string;
  /** Milliseconds the assay took (for benchmarking). */
  assayMs: number;
}

export interface Vaccine {
  id: string; // e.g. "anti_citatio_viridis_v1"
  /** Strain this vaccine targets. */
  strain: StrainId;
  /** Semantic version of the vaccine formula. Bump when you change the assay. */
  version: string;
  /** Atom names this vaccine composes. Surfaces in the AI's molecule view. */
  atoms: string[];
  /** Humans-readable description of how the assay works. */
  mechanism: string;
  /** ISO timestamp the formula was last certified. */
  certifiedAt?: string;
  /** Latest measured efficacy (set by benchmark.ts; null = uncertified). */
  efficacy?: VaccineEfficacy | null;
  /** The assay function. Pure with respect to (claim, context). */
  assay: (
    claim: SuspectClaim,
    context: VaccineContext,
  ) => Promise<Omit<AssayResult, "claim" | "assayMs">>;
}

export interface VaccineEfficacy {
  /** Number of labeled cases the benchmark used. */
  totalCases: number;
  /** True positive count. */
  tp: number;
  /** True negative count. */
  tn: number;
  /** False positive count. */
  fp: number;
  /** False negative count. */
  fn: number;
  /** Precision = tp / (tp + fp). NaN -> reported as null. */
  precision: number | null;
  /** Recall = tp / (tp + fn). */
  recall: number | null;
  /** F1 = 2 * (precision * recall) / (precision + recall). */
  f1: number | null;
  /** ISO timestamp when this benchmark was run. */
  ranAt: string;
  /** HMAC-SHA256 over the test result table, keyed by repo identity. */
  signature: string;
}

/** Read-only context the assay has access to. Pure values; no side effects. */
export interface VaccineContext {
  repoRoot: string;
  /** Optional pre-computed git data so multiple assays don't re-shell out. */
  cache?: VaccineCache;
}

export interface VaccineCache {
  /** Latest 5000 commit shas in the repo (full + abbrev). */
  knownShas?: Set<string>;
  /** All distinct git author names + emails. */
  knownAuthors?: Set<string>;
  /** Top-level file/dir paths (for fast existence checks without fs.exists per claim). */
  knownPaths?: Set<string>;
  /** package.json deps + devDeps merged. */
  knownDeps?: Set<string>;
}

/** A single labeled benchmark case. */
export interface BenchmarkCase {
  id: string;
  /** Sample text that should/shouldn't be flagged as infected. */
  draft: string;
  /** Expected: did the strain actually exist in this draft? */
  expectedInfected: boolean;
  /** Optional human note for triage. */
  note?: string;
}

/** Aggregated stats persisted at .mneme/antivirus/stats.json. */
export interface AntivirusStats {
  /** Total scans run since this stats file was created. */
  totalScans: number;
  /** Total claims examined. */
  totalClaimsExamined: number;
  /** Total infections caught (across all scans). */
  totalInfectionsCaught: number;
  /** Per-strain catch counts. */
  byStrain: Record<StrainId, { caught: number; lastCaughtAt: string | null }>;
  /** Per-vaccine usage. */
  byVaccine: Record<string, { invocations: number; infections: number }>;
  /** Last-N scan summaries (most-recent at end). */
  recentScans: ScanSummary[];
  /** ISO timestamp of last write. */
  lastUpdate: string;
}

export interface ScanSummary {
  scanId: string;
  ranAt: string;
  draftLengthChars: number;
  claimsExamined: number;
  infections: number;
  totalMs: number;
  vaccinesUsed: string[];
}

/** Persisted at .mneme/antivirus/pharmacopoeia.json. The union of every
 *  vaccine this repo trusts (seed + locally-developed + inherited). */
export interface Pharmacopoeia {
  schemaVersion: 1;
  vaccines: PharmacopoeiaEntry[];
  lastUpdate: string;
}

export interface PharmacopoeiaEntry {
  id: string;
  strain: StrainId;
  version: string;
  source: "seed" | "local-developed" | "inherited" | "community";
  /** When source = "inherited", which chromosome it came from. */
  inheritedFromChromosome?: string;
  /** Latest efficacy snapshot at time of registration. */
  efficacy?: VaccineEfficacy | null;
  registeredAt: string;
}
