/**
 * v2.31.0 — HGP (Hallucination Genome Project) types.
 *
 * Every time ACGV refutes a claim, HGP records the hallucination as a
 * deterministic genome entry (HGP-YYYY-NNNNN — CVE-style ID). Same
 * hallucination shape from different users hashes to the SAME
 * HGP-ID, so the federated corpus (opt-in) builds a public catalog
 * of vendor-attributed lies.
 */

export interface HallucinationRecord {
  /** HGP-YYYY-NNNNN — CVE-style deterministic ID. */
  hgpId: string;
  /** 64-bit simhash hex (16 chars) — used to bucket near-duplicates. */
  simhash: string;
  /** When we first observed this lie shape. */
  firstSeen: string;
  /** Most recent observation. */
  lastSeen: string;
  /** How many times observed locally. */
  observeCount: number;
  /** Vendor attribution histogram (vendor → count). */
  vendorCounts: Record<string, number>;
  /** Short signature: which proof layer refuted ("chandrasekhar" / "godel" / "hyperbole" / "vaccine"). */
  signature: string;
  /** Original claim sample (truncated, scrubbed of obvious secrets). */
  sample: string;
  /** Severity 0..1 — combines observeCount + spread across vendors. */
  severity: number;
}

export interface FederationConsent {
  /** User opt-in flag. Default = false (private-by-default per CONSENT FABRIC). */
  optIn: boolean;
  /** When the user toggled. */
  at: string;
  /** Endpoint to federate to (default hgp.ai placeholder). */
  endpoint?: string;
}

export interface FederationStatus {
  consent: FederationConsent;
  localCount: number;
  /** Last successful federate push (or null). */
  lastPushedAt: string | null;
  /** Last error (if any). */
  lastError: string | null;
}

export interface SeverityWindow {
  vendor: string;
  windowDays: number;
  /** Count of hallucinations attributed to this vendor in the window. */
  count: number;
  /** Mean severity. */
  meanSeverity: number;
  /** Top-3 HGP-IDs in window for this vendor. */
  topIds: Array<{ hgpId: string; observeCount: number; severity: number }>;
}
