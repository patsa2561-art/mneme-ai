/**
 * Self-modifying NUCLEUS -- Mneme proposes patches to ITSELF based on
 * what its own users hit in production. This is the "Lamarckian for
 * tools" idea: usage telemetry feeds back into the source.
 *
 * The contract is conservative on purpose:
 *
 *   - Mneme NEVER auto-merges. It writes a markdown PR proposal to
 *     `.mneme/proposals/<id>.md` with diagnosis, evidence, and a
 *     suggested fix shape. The user (or CI) opens an actual GitHub PR.
 *   - Patterns come from `.mneme/selfcheck/last.json` (recurring FAILs)
 *     plus the antivirus ledger (recurring infection types) plus
 *     PRECOG predictions (predicted-but-missed tool calls).
 *   - Confidence is computed locally; the proposal includes both the
 *     score and the raw evidence so the human reviewer can sanity-check.
 *
 * This is the FIRST AI dev-tool that proposes patches to its own
 * source from aggregated user telemetry.
 */

export interface EvolveSignal {
  /** Stable kind: "selfcheck-fail" | "antivirus-recurrence" | "precog-miss" | "manual" */
  kind: string;
  /** What pattern repeated. e.g. "lockfile-integrity:fail" */
  pattern: string;
  /** How many distinct sessions / cycles saw this. */
  occurrences: number;
  /** First/last seen ISO timestamps. */
  firstSeen: string;
  lastSeen: string;
  /** Optional one-liner -- raw evidence that the proposal will quote. */
  evidence?: string;
  /** Optional file path the signal points at. */
  filePath?: string;
}

export interface EvolveProposal {
  /** Stable id (sha hash of pattern + first-seen). */
  id: string;
  /** ISO timestamp. */
  generatedAt: string;
  /** Headline (≤ 80 chars) -- becomes the PR title. */
  title: string;
  /** Markdown body (≤ 4KB). The full PR description. */
  body: string;
  /** Confidence in [0, 1]. */
  confidence: number;
  /** Underlying signals that justified the proposal. */
  signals: EvolveSignal[];
  /** Optional patch *suggestion* shape (NOT a full diff -- that's the human's job). */
  suggestion?: {
    files: string[];
    direction: string;          // e.g. "Replace `where mneme` with pure-JS PATH walker"
    similarPriorPRs?: string[]; // e.g. "v1.23.4 cross-platform robustness pass"
  };
}

export interface EvolveStats {
  totalSignals: number;
  totalProposals: number;
  byKind: Record<string, number>;
  /** Confidence-weighted top recurring pattern. */
  topPattern: string | null;
}
