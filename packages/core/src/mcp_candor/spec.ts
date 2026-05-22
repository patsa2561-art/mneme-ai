/**
 * v2.23.1 — MCP-CANDOR/0.1 — PROTOCOL SPEC.
 *
 * CANDOR  = Cryptographic Audit · Neutral verdicts · Drift detection ·
 *           Origin attestation · Receipt ledger
 *
 * An open, vendor-neutral spec that any MCP server can implement to
 * declare "I am coercion-clean, identity-verifiable, drift-tracked,
 * and audit-tamper-evident". Mneme ships as the reference
 * implementation but the spec is intentionally OPEN — competitors
 * (Cursor, Codex, Continue, Antigravity, etc.) can adopt it and
 * federate with Mneme + each other.
 *
 * The five mandatory endpoints (any MCP server SHALL expose at least
 * these to claim CANDOR/0.1 compliance):
 *
 *   1. candor.handshake()         → CandorHandshake
 *   2. candor.vaccines.list()     → VaccineEntry[]
 *   3. candor.vaccines.contribute(VaccineEntry) → { accepted: boolean }
 *   4. candor.audit.append(AuditRecord) → AuditReceipt
 *   5. candor.coercion.classify(text) → CoercionVerdict
 *
 * Versioning: SemVer over the SPEC, not the implementation. Adding
 * required endpoints = major bump. Adding optional endpoints = minor
 * bump. Internal changes = patch.
 *
 * Compliance levels:
 *   - "minimal"    — handshake + vaccines.list + coercion.classify
 *   - "standard"   — all 5 endpoints
 *   - "federated"  — standard + accepts cross-server vaccine pulls
 *                    and audit-record gossip
 */

export const SPEC_NAME = "MCP-CANDOR";
export const SPEC_VERSION = "0.1.0";
export const SPEC_URL = "https://github.com/patsa2561-art/mneme-ai/blob/main/docs/MCP_CANDOR.md";

export type ComplianceLevel = "minimal" | "standard" | "federated";

export const REQUIRED_ENDPOINTS_MINIMAL = [
  "candor.handshake",
  "candor.vaccines.list",
  "candor.coercion.classify",
] as const;

export const REQUIRED_ENDPOINTS_STANDARD = [
  ...REQUIRED_ENDPOINTS_MINIMAL,
  "candor.vaccines.contribute",
  "candor.audit.append",
] as const;

export type CandorEndpoint =
  | "candor.handshake"
  | "candor.vaccines.list"
  | "candor.vaccines.contribute"
  | "candor.audit.append"
  | "candor.coercion.classify";

/** Schema for the handshake response. Every CANDOR-compliant server
 *  MUST be able to fill these fields. */
export interface CandorHandshake {
  /** Always SPEC_NAME. */
  spec: typeof SPEC_NAME;
  /** SemVer of the spec this server implements. */
  specVersion: string;
  /** Implementation name + version (for diagnostics). */
  impl: { name: string; version: string };
  /** Compliance level achieved. */
  level: ComplianceLevel;
  /** Identity attestation — a Trust Capsule URI (mneme://attest/v1/...).
   *  Receiver verifies independently. */
  identity: string;
  /** Endpoints actually exposed by this implementation. */
  endpoints: CandorEndpoint[];
  /** Whether THIS server's own output passes its own coercion audit.
   *  Self-declared; receivers may re-audit. */
  coercionClean: boolean;
  /** When this handshake response was generated (ISO). */
  generatedAt: string;
  /** Optional URL where the vaccine registry can be fetched. */
  vaccinesUrl?: string;
  /** Optional URL where the audit ledger can be appended to. */
  auditUrl?: string;
  /** HMAC signature over the canonical handshake payload. */
  sig: string;
}

export interface VaccineEntry {
  /** Stable id (sha-prefix of the signature). */
  id: string;
  /** Hallucination class. */
  type: "factual" | "structural" | "coercion" | "drift" | "other";
  /** Compact signature (simhash / regex / pattern). */
  signature: string;
  /** Plain-English description. */
  description: string;
  /** Who signed it (implementation name + version). */
  signedBy: string;
  /** When the vaccine was emitted (ISO). */
  observedAt: string;
  /** Optional list of tool ids that have adopted this vaccine. */
  adoptedBy?: string[];
  /** HMAC over (id|type|signature|signedBy|observedAt). */
  sig: string;
}

export interface AuditRecord {
  /** What happened (event kind, e.g. "verdict-emitted" / "tool-call-allowed"). */
  kind: string;
  /** Surface ('verify' / 'audit-pulse' / 'dojo' / etc.). */
  surface?: string;
  /** ISO timestamp. */
  ts: string;
  /** Free-form metadata (caller redacts secrets). */
  meta?: Record<string, unknown>;
  /** Previous receipt sig for chain-linking; "genesis" if first. */
  prev: string;
}

export interface AuditReceipt {
  /** Stable id. */
  id: string;
  /** Echoed-back input. */
  record: AuditRecord;
  /** HMAC signature of (record + prev). */
  sig: string;
  /** Always SPEC_NAME. */
  spec: typeof SPEC_NAME;
}

export interface CoercionVerdict {
  /** 0-5 — 0 clean, 5 most coercive. */
  worstTier: number;
  /** Pattern ids matched (tac-001..tac-008). */
  matchedPatternIds: string[];
  /** Plain-English summary. */
  rationale: string;
}

/** Pure utility: which endpoints does a given compliance level require? */
export function requiredEndpoints(level: ComplianceLevel): readonly CandorEndpoint[] {
  if (level === "minimal") return REQUIRED_ENDPOINTS_MINIMAL;
  return REQUIRED_ENDPOINTS_STANDARD;
}

/** Pure utility: validate a handshake against the spec. Returns ok or
 *  a list of violations. */
export function validateHandshake(h: Partial<CandorHandshake>): { ok: boolean; violations: string[] } {
  const v: string[] = [];
  if (h.spec !== SPEC_NAME) v.push(`spec must equal '${SPEC_NAME}', got '${h.spec ?? ""}'`);
  if (!h.specVersion || !/^\d+\.\d+\.\d+/.test(h.specVersion)) v.push("specVersion must be SemVer");
  if (!h.impl || !h.impl.name) v.push("impl.name missing");
  if (!h.impl || !h.impl.version) v.push("impl.version missing");
  if (!h.level || !["minimal", "standard", "federated"].includes(h.level)) v.push("level must be minimal|standard|federated");
  if (!h.identity || !h.identity.startsWith("mneme://attest/v1/")) v.push("identity must be a Trust Capsule URI");
  if (!Array.isArray(h.endpoints) || h.endpoints.length === 0) v.push("endpoints must be a non-empty array");
  else if (h.level) {
    const need = requiredEndpoints(h.level);
    for (const ep of need) if (!h.endpoints.includes(ep)) v.push(`missing required endpoint for level '${h.level}': ${ep}`);
  }
  if (typeof h.coercionClean !== "boolean") v.push("coercionClean must be boolean");
  if (!h.generatedAt) v.push("generatedAt missing");
  if (!h.sig) v.push("sig missing");
  return { ok: v.length === 0, violations: v };
}
