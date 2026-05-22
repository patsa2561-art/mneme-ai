/**
 * v2.23.1 — MCP-CANDOR/0.1 REFERENCE IMPLEMENTATION.
 *
 * The first vendor-neutral MCP standard for trust + audit + coercion-
 * detection + vaccine federation. Mneme ships as REFERENCE
 * IMPLEMENTATION #0; the spec is OPEN — Cursor / Codex / Continue /
 * Antigravity / any MCP server can implement + federate.
 *
 * Diamonds polished into a single standard:
 *
 *   Diamond #1 (verify-self)          → handshake endpoint
 *   Diamond #2 (vaccine cache)        → vaccine registry endpoint(s)
 *   Diamond #3 (HMAC replay.jsonl)    → audit ledger endpoint
 *   Diamond #4 (coercion taxonomy)    → coercion classify endpoint
 *
 * Open citation slot — first reference implementation is the first
 * citation. First MCP server to adopt the FULL spec is the second
 * citation. Industry-wide adoption follows the spec, not Mneme's
 * implementation.
 *
 * Composes with:
 *   - trust_capsule (identity)
 *   - coercion_taxonomy (classifier)
 *   - antivirus / pharmacopoeia (vaccine source)
 *   - mission_recorder (audit-record inspiration)
 *
 * No new external deps. Pure local + opt-in federation.
 */

export {
  SPEC_NAME, SPEC_VERSION, SPEC_URL,
  REQUIRED_ENDPOINTS_MINIMAL, REQUIRED_ENDPOINTS_STANDARD,
  requiredEndpoints, validateHandshake,
  type CandorHandshake, type CandorEndpoint, type ComplianceLevel,
  type VaccineEntry, type AuditRecord, type AuditReceipt, type CoercionVerdict,
} from "./spec.js";

export {
  buildHandshake, verifyHandshakeSig, formatHandshake,
  type BuildHandshakeOptions,
} from "./handshake.js";

export {
  contributeVaccine, listVaccines, findVaccine, importVaccines, exportVaccines,
  verifyVaccineSig, formatVaccines,
  type ContributeOptions,
} from "./vaccine_registry.js";

export {
  appendAudit, listAudits, verifyAuditChain, formatAudits,
  type AppendOptions,
} from "./audit_ledger.js";

import { classify, type ClassifyResult } from "../coercion_taxonomy/index.js";
import type { CoercionVerdict } from "./spec.js";

/** Coercion endpoint — thin wrapper around coercion_taxonomy.classify
 *  that conforms to the CANDOR spec shape. */
export function classifyCoercion(text: string): CoercionVerdict {
  const r: ClassifyResult = classify(text);
  return {
    worstTier: r.worstTier,
    matchedPatternIds: r.matches.map((m) => m.pattern.id),
    rationale: r.rationale,
  };
}
