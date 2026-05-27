/**
 * 🌀 GROK BRIDGE — types
 *
 * The "Truth-Provider-as-a-Service" interface layer between Grok / xAI and
 * Mneme primitives. Designed so xAI can ship "Grok with built-in auditor"
 * via 1 import + 1 init call.
 */

export type TruthVerdict =
  | "VERIFIED"     // ACGV passed; ship with optional citations
  | "HEDGED"       // partial uncertainty; suggest soft language
  | "REFUSED"      // ACGV REFUTED; refuse + cite contradictions
  | "PASSTHROUGH"; // not a verifiable claim (opinion / creative)

export interface DraftInput {
  text: string;
  /** Optional metadata about the originating Grok call. */
  meta?: {
    modelVersion?: string;       // e.g. "grok-4.1-2026-05"
    promptHash?: string;
    sessionId?: string;
    userId?: string;             // hashed
    ragSources?: string[];       // doc ids
    reasoningTrace?: string;     // chain-of-thought (optional, redacted)
  };
}

export interface TruthOracleVerdict {
  verdict: TruthVerdict;
  /** Per-claim breakdown (one entry per sentence detected). */
  claims: Array<{
    text: string;
    acgv: "TRUSTWORTHY" | "REFUTED" | "IMPOSSIBLE" | "UNKNOWN" | "PASSTHROUGH";
    confidence: number;
    contradictions?: string[];
  }>;
  suggestedEdit?: string;       // for HEDGED / REFUSED
  citations?: string[];          // for VERIFIED
  blackBoxHmac: string;          // chain entry for this verdict
  blackBoxPrev: string;
  latencyMs: number;
}

export interface BlackBoxStampInput {
  modelVersion: string;
  promptHash: string;
  outputTokens: string[];        // single token or batch
  sessionId?: string;
  ragSources?: string[];
}

export interface BlackBoxStamp {
  ts: string;
  modelVersion: string;
  promptHash: string;
  tokenChunkHash: string;        // sha256 of joined token chunk
  tokenCount: number;
  sessionId?: string;
  ragSources?: string[];
  prev: string;
  hmac: string;
}

export interface ContraRagCandidate {
  docId: string;
  excerpt: string;
  similarity: number;            // semantic distance metric
  contradictionScore: number;   // 0..1 — how strongly it contradicts
  source?: string;
}

export interface ContraRagResult {
  query: string;
  candidates: ContraRagCandidate[];
  totalContradictions: number;
  threshold: number;
  hmac: string;
}

export interface ElonChronostasisClaim {
  id: string;
  source: "twitter" | "interview" | "earnings_call" | "blog" | "manual";
  utteranceUrl?: string;
  text: string;
  asserted: { metric: string; value: number; op: ">" | "<" | "=" | "≥" | "≤"; unit?: string };
  deadlineIso: string;            // when to grade
  status: "pending" | "confirmed" | "refuted" | "expired";
  evidence?: string;
  hmac: string;
}

export interface ColossusInferenceMeta {
  fnId: string;                   // e.g. "grok.inference.completion"
  modelVersion: string;
  durationMs: number;
  tokenCount: number;
  acceptedByUser?: boolean;       // post-hoc signal for HONEST_MIRROR
}

export interface ConstitutionalCheck {
  contradictsPrior: boolean;
  manipulationDetected: boolean;
  alibiVerdict: "CONFIRMED" | "DENIED" | "INCONCLUSIVE";
  recommendation: "ship" | "hedge" | "refuse";
  reasons: string[];
  hmac: string;
}

export interface ComplianceEditionReport {
  article50Stamp?: string;
  socAuditChainOk: boolean;
  fcraAttributionOk: boolean;
  hipaaPiiCount: number;
  gdprForgetReceiptHash?: string;
  overallOk: boolean;
  reasons: string[];
}

export interface GrokBridgeConfig {
  hmacKey: string;
  blackBoxLedger?: string;        // default .mneme/grok_bridge/blackbox.jsonl
  contraRagIndex?: () => Promise<ContraRagCandidate[]>;  // pluggable
  enableSuperQuanProbe?: boolean; // PROTOPLASM probe wrap
  modelVersion?: string;
}
