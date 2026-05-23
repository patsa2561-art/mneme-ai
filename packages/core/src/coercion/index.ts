/**
 * v2.33.0 — COERCION public surface.
 *
 * Tool-to-Agent coercion-by-design taxonomy. 8 patterns codified from
 * the v2.21.6 CONSENT FABRIC self-audit; HMAC-signed reports per
 * source + multi-source roll-up for cross-MCP-server surveys
 * (paper 2 reference data).
 */

export type {
  CoercionPatternId, CoercionPattern, CoercionHit,
  CoercionAuditResult, MultiSourceAudit,
} from "./types.js";

export { PATTERNS, auditText, auditMany, verifyAudit } from "./audit.js";
