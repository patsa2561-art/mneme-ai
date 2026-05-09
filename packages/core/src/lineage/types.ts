/**
 * Shared lineage types — single source of truth for chromosome shape +
 * tree structure + spore / pedigree records. Imported by every lineage
 * module so any rename propagates type-safely.
 */

/** Atom-level karma delta accumulated during a session. */
export interface AtomKarmaDelta {
  /** Net karma change for this tool over the session. */
  karma: number;
  /** Number of times the tool was invoked. */
  invocations: number;
  /** Verified outcomes (from confess). */
  verified: number;
  /** Hallucination outcomes. */
  hallucinations: number;
}

/** Molecule = a named atom combination that fired together (Hebbian). */
export interface MoleculeRecord {
  name: string;
  /** Atom names involved (sorted, deterministic). */
  atoms: string[];
  /** Number of times this exact combination co-fired in the session. */
  fireCount: number;
  /** Aggregate karma of constituent atoms — drives selection pressure. */
  karma: number;
}

/** Court verdict captured during the session (from cross_examine). */
export interface CourtVerdictRecord {
  claim: string;
  verdict: "verdict_for_plaintiff" | "hung_jury" | "motion_to_dismiss";
  evidenceBalance: number;
  /** Top witness commit hashes (for provenance — verifiable via git). */
  topWitnesses: string[];
}

/** Voice fingerprint — language style + topical markers. Used for
 *  vendor identification + drift detection. Intentionally compact. */
export interface VoiceFingerprint {
  /** Approximate average sentence length in tokens. */
  avgSentenceLen: number;
  /** Top 5 phrases the AI used (already PII-scrubbed). */
  topPhrases: string[];
  /** Topical mass — top 3 topics this session covered. */
  topTopics: string[];
}

/** A constitution rule the session implies but didn't explicitly state. */
export interface ConstitutionCandidate {
  /** Rule sentence in plain English. */
  rule: string;
  /** Confidence 0-1 derived from frequency + karma. */
  confidence: number;
  /** Atoms / molecules that gave rise to this candidate. */
  evidence: string[];
}

/** Compressed snapshot of an entire AI session. Persistent, signed,
 *  hashable, parent-aware. The Mneme Lineage atomic unit. */
export interface Chromosome {
  schemaVersion: 1;
  /** Canonical ID — `${ISO timestamp without colons}-${vendor}-${shortHash}`. */
  id: string;
  createdAt: string;
  /** AI vendor / model identifier (e.g. "claude-opus-4-7", "cursor-cmd-k"). */
  vendor: string;
  /** Stable hash of {hostname + cwd hash} — distinguishes machines without leaking PII. */
  machineId: string;
  /** Parent chromosome IDs (0-2, meiotic). Empty = first session ever. */
  parents: string[];
  /** Vector clock for cross-machine merge — `{ machineId: counter }`. */
  vectorClock: Record<string, number>;
  /** Topic of this session (best-effort summary). */
  topic: string;
  /** Per-atom karma deltas + invocation counts. */
  atomKarmaDeltas: Record<string, AtomKarmaDelta>;
  /** Molecules that formed during the session. */
  molecules: MoleculeRecord[];
  /** Court verdicts captured. */
  courtVerdicts: CourtVerdictRecord[];
  /** Confess outcomes aggregated. */
  confessOutcomes: {
    verified: number;
    partiallyVerified: number;
    hallucination: number;
    unverifiable: number;
    /** Average self-confidence across confessions. */
    avgSelfConfidence: number;
  };
  /** Voice + topical fingerprint. */
  voiceFingerprint: VoiceFingerprint;
  /** Constitution rules this session implies. */
  constitutionCandidates: ConstitutionCandidate[];
  /** Atoms that confess marked as hallucination — culled from inheritance. */
  lethalRecessives: string[];
  /** Session metadata. */
  session: {
    startedAt: string;
    endedAt: string;
    totalCalls: number;
    /** Why the session ended — informational only, drives nothing. */
    endReason: "exit-signal" | "idle-timeout" | "context-pressure" | "manual" | "incremental";
  };
  /** Public key (PEM) of the signer — verification works without out-of-band exchange. */
  signedBy: string;
  /** Ed25519 signature (hex) over the canonical JSON of all fields above. */
  signature: string;
  /** SHA-256 hex of the canonical JSON of all fields above (sans signature). Used as the chromosome's content-address. */
  contentHash: string;
}

/** Lineage tree — DAG of parent → children links. Persisted as JSON.
 *  Storing both directions lets us walk in O(1) without re-deriving. */
export interface LineageTree {
  schemaVersion: 1;
  /** Map of chromosome ID → its node record. */
  nodes: Record<string, LineageNode>;
  /** Most recently crystallized chromosome (the lineage's "head"). */
  head: string | null;
  /** Map of speciesId → list of member chromosome IDs (clusters). */
  species: Record<string, string[]>;
}

export interface LineageNode {
  id: string;
  parents: string[];
  children: string[];
  /** Optional species assignment (after speciation detection). */
  species?: string;
}

/** Pointer to which chromosome is the active session. */
export interface CurrentSession {
  /** ID of the in-progress chromosome (may not yet be persisted). */
  chromosomeId: string;
  startedAt: string;
  vendor: string;
  machineId: string;
  /** Parent IDs at session start (selected via fertilize). */
  parents: string[];
}

/** Spore (cross-machine sync) state. */
export interface SporeRemote {
  /** Backend type — only "git" in v1.19. */
  kind: "git";
  /** Git remote URL. */
  url: string;
  /** Branch where chromosomes live (default: "mneme-lineage"). */
  branch: string;
  /** Whether this remote was auto-detected from the repo's origin. */
  autoDetected: boolean;
}

/** Lineage settings — TOFU answers, opt-out flags. */
export interface LineageSettings {
  /** Was the user prompted via TOFU? (Even if AI-driven non-TTY install, false.) */
  tofuAnswered: boolean;
  /** User explicitly opted out of lineage (no chromosomes get written). */
  optedOut: boolean;
  /** Encryption-at-rest enabled for chromosome files. */
  encryptionEnabled: boolean;
  /** PII scrubbing enabled before crystallize. */
  piiScrubEnabled: boolean;
  /** Last welcome contract version surfaced to the agent. */
  lastWelcomeShown: string | null;
}
