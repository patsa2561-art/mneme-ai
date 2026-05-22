/**
 * v2.27.0 — MARKETING TRUTH GATE.
 *
 * Audit (2026-05-22, user-supplied matrix): 8 marketing claims that
 * don't match measured reality, e.g.
 *
 *   Marketing: "74.7% fewer tokens"            Measured: 80K tokens / call
 *   Marketing: "9 verification agents"         Measured: returns NEEDS-DATA
 *   Marketing: "SUPERNOVA self-heal"           Measured: kill 5x → 0 respawn
 *   Marketing: "Phoenix Resurrection"          Measured: not activated by default
 *   Marketing: "Ollama detected ★★★★"         Measured: bundled ★★★ picked
 *
 * The world has plenty of "release notes" pages. None of them PROVE the
 * claim every time the binary is built. The TRUTH GATE does:
 *
 *   1. SCAN — parse claim-shaped sentences out of README / CHANGELOG /
 *      docs (and from MCP tool descriptions).
 *   2. PROBE — each claim has a measurable probe (live function that
 *      returns a number / boolean / string).
 *   3. RECONCILE — compare claim's asserted value to probed value; emit
 *      verdict (pass / drift / refuted).
 *   4. ATTEST — HMAC-sign the reconciliation matrix so receivers can
 *      verify offline that the binary's claims have been measured.
 *
 * Composable with the PEAK GAUNTLET (v2.26.x): N1-N12 are spec
 * conformance; TRUTH GATE is marketing-vs-reality. Together they form
 * the world's first measurable-truth release pipeline.
 */

export type ClaimId = string;

export type ClaimKind =
  | "numeric"     // 80 tokens · 25 ms · 9 agents
  | "boolean"     // "enabled by default" · "auto-detected"
  | "string"      // "MCP-CANDOR/0.1" · "v2.26.1"
  | "shape";      // "HMAC-chained" · "spec-compliant"

export type ClaimVerdict = "pass" | "drift" | "refuted" | "unmeasured";

export interface Claim {
  /** Stable id, e.g. "claim.tokens.capabilities". */
  id: ClaimId;
  /** Where the claim appears (file:line, README section title). */
  source: string;
  /** The marketing text verbatim (≤ 240 chars). */
  text: string;
  kind: ClaimKind;
  /** For numeric claims: asserted value + comparison operator. */
  asserted?: { value: number; op: "<" | "<=" | ">" | ">=" | "=" | "~="; unit?: string; tolerance?: number };
  /** Probe id that measures the live value. */
  probeId: string;
  /** Severity if the claim drifts. */
  severity: "info" | "warn" | "block";
}

export interface ProbeResult {
  /** Measured value (kind-dependent). */
  value: number | boolean | string | null;
  /** Single-line summary of the measurement. */
  evidence: string;
  /** Wall-time of the probe. */
  dtMs?: number;
  /** Optional structured detail. */
  detail?: Record<string, unknown>;
}

export interface Probe {
  id: string;
  /** What kind of claim this probe can answer. */
  kind: ClaimKind;
  /** Short description. */
  description: string;
  /** Run the probe. NEVER throws — returns { value: null } on error. */
  run: (ctx: ProbeContext) => Promise<ProbeResult>;
}

export interface ProbeContext {
  cwd: string;
}

export interface ReconciliationEntry {
  claim: Claim;
  probe: ProbeResult;
  verdict: ClaimVerdict;
  reason: string;
}

export interface TruthMatrix {
  spec: { name: "MNEME-TRUTH-GATE"; version: string };
  scannedAt: string;
  cwd: string;
  totalClaims: number;
  entries: ReconciliationEntry[];
  summary: {
    pass: number;
    drift: number;
    refuted: number;
    unmeasured: number;
    truthScore: number; // 0..100 = pass/(pass+drift+refuted) * 100
  };
  headline: string;
  trafficLight: "green" | "yellow" | "red";
  hmac: string;
  seq: number;
  bodyDigest: string;
}
