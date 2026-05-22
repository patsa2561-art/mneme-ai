/**
 * v2.24.0 — MCP fuzzer type contract.
 *
 * The world-class MCP fuzzer ships as a deterministic, vendor-agnostic
 * engine that fires 108 attack vectors at a target MCP server and emits
 * a tamper-evident HMAC-chained report card. Designed so external tools
 * (mcp-scan, MCPSecBench, MCPTox) can be subsumed as importable vector
 * packs.
 *
 * The Intelligent Second Brain interprets each verdict + correlates with
 * known CVEs (CVE-2025-54136 MCPoison etc) and proposes mutations for
 * the next 24/7 run.
 */

export type Severity = "info" | "low" | "medium" | "high" | "critical";

export type Category =
  | "handshake"          // initialize / protocolVersion / capabilities
  | "schema"             // JSON Schema mismatch / required / unicode / depth
  | "method"             // unknown method / -32601
  | "tool"               // tool-name confusion / isError flag / aliases
  | "resource"           // resources/read / uri injection / path traversal
  | "prompt"             // prompts/get / argument injection
  | "policy"             // honeypot exposure / DLP / consent
  | "concurrency"        // parallel init / id collision / racing
  | "transport";         // malformed frames / chunking / encoding

export type Verdict = "pass" | "fail" | "warn" | "inconclusive";

/** A single fuzz attack vector — pure data; the engine drives the JSON-RPC. */
export interface AttackVector {
  /** Stable id, used as report-card key + replay seed (vec-001 .. vec-108). */
  id: string;
  /** Short title (≤ 60 chars). */
  title: string;
  /** What the spec says SHOULD happen — citable in the report. */
  spec: string;
  category: Category;
  severity: Severity;
  /** CVE / public-incident references that this vector hardens against. */
  cve?: string[];
  /** JSON-RPC frame(s) to send. Use `__id` placeholders the engine fills. */
  payload: PayloadStep[];
  /** Per-vector timeout (ms). Defaults to 5000. */
  timeoutMs?: number;
  /** Detector: receives the responses for this vector + verdicts pass/fail. */
  detector: Detector;
}

export interface PayloadStep {
  /** Either a JSON-RPC object, or a raw frame string the engine sends verbatim. */
  send: object | string;
  /** If true, no response expected (notification). */
  noResponse?: boolean;
  /** Per-step timeout (ms). Defaults to vector timeoutMs. */
  timeoutMs?: number;
}

export interface DetectorResult {
  verdict: Verdict;
  /** Human-readable single-line summary (≤ 200 chars). */
  reason: string;
  /** Optional structured detail surfaced in the report. */
  detail?: Record<string, unknown>;
}

export type Detector = (responses: Array<JsonRpcReply | null>) => DetectorResult;

export interface JsonRpcReply {
  jsonrpc?: string;
  id?: number | string | null;
  result?: unknown;
  error?: { code: number; message: string; data?: unknown };
  method?: string;
  params?: unknown;
}

export interface VectorRunResult {
  vectorId: string;
  category: Category;
  severity: Severity;
  verdict: Verdict;
  reason: string;
  detail?: Record<string, unknown>;
  dtMs: number;
  /** Compact dump of responses for replay / debugging. */
  responses: Array<JsonRpcReply | null>;
}

export interface ReportCard {
  spec: { name: "MCP-FUZZER"; version: string };
  target: string;
  startedAt: string;
  finishedAt: string;
  totalMs: number;
  /** Per-vector outcomes. */
  results: VectorRunResult[];
  /** Aggregate stats. */
  summary: {
    total: number;
    pass: number;
    warn: number;
    fail: number;
    inconclusive: number;
    bySeverity: Record<Severity, { pass: number; fail: number }>;
    byCategory: Record<Category, { pass: number; fail: number }>;
  };
  /** Intelligent Second Brain commentary. */
  wisdom: WisdomVerdict;
  /** HMAC-chain root over the canonical report. */
  hmac: string;
  /** Sequence number in the local fuzzer chain. */
  seq: number;
  /** SHA-256 of the canonical body (without hmac field). */
  bodyDigest: string;
}

export interface WisdomVerdict {
  /** Single-line headline (≤ 100 chars). */
  headline: string;
  /** Traffic light. */
  trafficLight: "green" | "yellow" | "red" | "black";
  /** Top failing vectors mapped to remediation steps. */
  remediations: Array<{ vectorId: string; cve?: string[]; action: string }>;
  /** Cross-vendor correlation: which CVE patterns this scan would have caught. */
  cvePosture: Array<{ cve: string; mitigated: boolean; via: string }>;
  /** Suggested mutations the daemon should try on the next run. */
  mutationsForNextRun: Array<{ vectorId: string; variant: string; rationale: string }>;
}

export interface RunOptions {
  /** Vector ids or category names to include. Empty = all 108. */
  filter?: string[];
  /** Override per-vector timeout. */
  timeoutMs?: number;
  /** Random seed for mutation engine. Defaults to current ms. */
  seed?: number;
  /** Stop after first failure (CI quick gate). */
  failFast?: boolean;
  /** Number of variants the mutation engine spins per failing vector. */
  mutateCount?: number;
}
