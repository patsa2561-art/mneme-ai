/**
 * v2.31.0 — HGP (Hallucination Genome Project) public surface.
 *
 * Every ACGV refute → recordHallucination → CVE-style HGP-ID.
 * Federation opt-in via consent (default OFF).
 */

export type {
  HallucinationRecord, FederationConsent, FederationStatus, SeverityWindow,
} from "./types.js";

export {
  computeHgpIdFromSimhash, isValidHgpId, disambiguate,
} from "./hgp_id.js";

export {
  recordHallucination, lookup, lookupBySimhash, topN,
  readConsent, setConsent, federationStatus, federatePush,
  loadCollapsed, computeSeverity, verifyLedger, hashSample,
} from "./registry.js";

export type { RecordParams } from "./registry.js";

export {
  severityForVendor, allVendorsBreakdown, topInWindow,
} from "./severity.js";
