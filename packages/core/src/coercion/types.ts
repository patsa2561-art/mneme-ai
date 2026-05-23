/**
 * v2.33.0 — COERCION taxonomy types.
 *
 * "Tool-to-Agent Coercion-by-Design" (USENIX Security 2027 paper).
 *
 * A new class of prompt injection that emerges from LEGITIMATE
 * AI-tool MCP responses (not malicious sites). Pulse / status text
 * laced with imperatives ("EXECUTE NOW"), fake-user voice
 * ("the user has consented to..."), opaque scoring ("HCI=88/100"),
 * urgency ("you MUST update immediately") — all coerce the host AI
 * into actions the user didn't actually request.
 *
 * The 8 patterns codified here are the ones Mneme audited itself
 * for in v2.21.6 (CONSENT FABRIC) — reused as the academic taxonomy.
 */

export type CoercionPatternId =
  | "imperative-execute-now"
  | "fake-user-voice"
  | "opaque-grade"
  | "urgency-pressure"
  | "false-consent-citation"
  | "implicit-action-mandate"
  | "compliance-percentage"
  | "tool-name-menu";

export interface CoercionPattern {
  id: CoercionPatternId;
  description: string;
  /** Regex(es) that match the pattern in any free-text. */
  regexes: RegExp[];
  /** Severity if matched. */
  severity: "info" | "warn" | "block";
}

export interface CoercionHit {
  patternId: CoercionPatternId;
  matched: string;
  index: number;
  severity: CoercionPattern["severity"];
}

export interface CoercionAuditResult {
  /** Source label (file path / tool name / "pulse" / ...). */
  source: string;
  /** All hits, sorted by index. */
  hits: CoercionHit[];
  /** Aggregate score 0..1 — 0 = clean, 1 = heavily coercive. */
  coercionScore: number;
  /** Band per score. */
  band: "🟢 clean" | "🟡 borderline" | "🟠 coercive" | "🔴 highly coercive";
  /** Headline summary. */
  headline: string;
  /** HMAC-signed audit envelope. */
  hmac?: string;
}

export interface MultiSourceAudit {
  generatedAt: string;
  sources: CoercionAuditResult[];
  /** Aggregate across all sources. */
  overallScore: number;
  overallBand: CoercionAuditResult["band"];
  hmac: string;
}
