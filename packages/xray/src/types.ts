/**
 * Mneme Repo X-Ray — report types.
 *
 * DESIGN INVARIANT (the privacy moat, gauntlet-proven by `xrayLeaksRaw`):
 * a report carries ONLY aggregate metrics, counts, line numbers, symbol
 * names/signatures, and sha256 hashes. It NEVER carries a line of source,
 * a secret value, a file's content, or a full diff. The whole report is
 * raw-free by construction so it is safe to ship to a cloud surface.
 *
 * ACCURACY INVARIANT: every number originates from a deterministic
 * @mneme-ai/core function (git history, AST outline, npm metadata, regex
 * secret scan). No LLM is consulted anywhere in the battery, so the same
 * repo at the same commit always produces the same report.
 */

export type Grade = "A" | "B" | "C" | "D" | "F";

export interface XRaySubject {
  kind: "git-url" | "local-path";
  /** The public git URL, or "local" for a path (the path itself is never stored). */
  ref: string;
  repoName: string;
  /** HEAD commit the report was computed at (provenance). */
  commitHash: string;
}

/** Dependency mortality — "which of your dependencies are dying". */
export interface DepsBlock {
  total: number;
  byBand: Record<"thriving" | "healthy" | "watch" | "moribund" | "dead", number>;
  /** Worst offenders first — name + band + 18-month abandonment probability + a known successor. */
  atRisk: Array<{ name: string; band: string; probability18mo: number; successor: string | null }>;
  /** True when npm metadata could not be fetched for some deps (honest degradation). */
  partial: boolean;
  note: string;
}

/** Secret / credential leak scan (values are NEVER stored — only kind + count + location). */
export interface SecretsBlock {
  filesScanned: number;
  /** Credential-pattern matches in PRODUCTION code (drives the grade). */
  totalFindings: number;
  /** Matches in test/fixture/doc files — intentional sample data, not leaks. */
  excludedTestHits: number;
  byKind: Record<string, number>;
  /** Redacted hits: kind + file + line. The secret value is never present. */
  hits: Array<{ kind: string; file: string; line: number }>;
  worstVerdict: "ALLOW" | "REDACT" | "BLOCK";
  note: string;
}

/** Bus factor — knowledge concentration from git authorship. */
export interface BusFactorBlock {
  /** Distinct authors in the analysed window. */
  authors: number;
  /** % of files whose history is dominated (>= dominanceThreshold) by a single author. */
  singleOwnerFilePct: number;
  /** Files most at risk if their sole expert leaves. */
  fragileFiles: Array<{ file: string; topAuthorShare: number; commits: number }>;
  /** Share of all commits by the single top contributor. */
  topContributorShare: number;
  busFactor: number;
  note: string;
}

/** Repo age, vitality, abandonment. */
export interface AgeBlock {
  bornAt: string;
  lastCommitAt: string;
  lifespan: string;
  lifespanDays: number;
  totalCommits: number;
  totalAuthors: number;
  dormant: boolean;
  vitality: "active" | "slowing" | "dormant" | "archived";
  note: string;
}

/** Structural complexity from the AST outline. */
export interface ComplexityBlock {
  filesAnalysed: number;
  totalSymbols: number;
  /** Longest functions/methods by body length — the refactor hotspots. */
  hotspots: Array<{ file: string; symbol: string; bodyLines: number; startLine: number }>;
  maxDepth: number;
  note: string;
}

/** Behavioral hotspots — change-frequency × size (refactor-ROI targets). */
export interface HotspotsBlock {
  windowDays: number;
  filesConsidered: number;
  hotspots: Array<{ file: string; changes: number; loc: number; score: number }>;
  note: string;
}

export interface XRaySummary {
  headline: string;
  grade: Grade;
  /** Number of deterministic signals that ran successfully. */
  signalsRun: number;
  /** One-line takeaway per signal — what a CEO reads first. */
  bullets: string[];
}

export interface XRayReport {
  v: 1;
  subject: XRaySubject;
  generatedAt: string;
  summary: XRaySummary;
  deps: DepsBlock;
  secrets: SecretsBlock;
  busFactor: BusFactorBlock;
  age: AgeBlock;
  complexity: ComplexityBlock;
  hotspots: HotspotsBlock;
  /** sha256 over the canonicalised metric blocks — a tamper-evident content id. */
  fingerprint: string;
}

/** A report plus its offline-verifiable Ed25519 NOTARY receipt. */
export interface SignedXRay {
  report: XRayReport;
  receipt: unknown;
}

export interface XRayInput {
  /** Local repo path. The path is analysed in place and never transmitted/stored. */
  repoPath?: string;
  /** Public git URL — shallow-cloned to a temp dir, analysed, then deleted. */
  gitUrl?: string;
  /** Override "now" for deterministic tests. */
  now?: number;
  /** Max files to scan for secrets/complexity (perf bound; logged when hit). */
  maxFiles?: number;
}
