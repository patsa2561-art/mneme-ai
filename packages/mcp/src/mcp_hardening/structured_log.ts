/**
 * v2.24.0 — Structured stderr logger for the MCP server.
 *
 * Audit finding M16: the MCP server emitted only ~43 bytes of stderr for
 * an entire session ("[mneme mcp] starting MCP server on stdio …"). When
 * an AI agent reports "Mneme didn't respond", the only forensic data
 * available was that one banner — no per-call trace, no error context,
 * no boot phase markers.
 *
 * Fix: emit one JSON line per significant event. Stays out of stdout
 * (where the MCP protocol's JSON-RPC frames live). Spec-safe: stderr is
 * for diagnostics per the JSON-RPC and MCP specs.
 *
 * The structure is deterministic (sorted keys) so the fuzzer's HMAC
 * chain can pin it across runs.
 */

import { createHmac } from "node:crypto";

export type LogLevel = "trace" | "debug" | "info" | "warn" | "error";

export interface LogEvent {
  t: string;                       // ISO timestamp
  lvl: LogLevel;
  ev: string;                      // event name (boot.start, init.replied, call.ok, ...)
  [field: string]: unknown;
}

let chainLink: string = "0".repeat(16);
const HMAC_KEY = process.env["MNEME_MCP_LOG_KEY"] ?? "mneme-mcp-log-v1";

function canon(v: unknown): string {
  if (v === null || typeof v !== "object") return JSON.stringify(v);
  if (Array.isArray(v)) return "[" + v.map(canon).join(",") + "]";
  const keys = Object.keys(v as Record<string, unknown>).sort();
  return "{" + keys.map((k) => JSON.stringify(k) + ":" + canon((v as Record<string, unknown>)[k])).join(",") + "}";
}

function nextLink(prev: string, body: unknown): string {
  return createHmac("sha256", HMAC_KEY).update(prev + "|" + canon(body)).digest("hex").slice(0, 16);
}

/**
 * Emit one structured log event to stderr.
 * Format: one JSON line, key-sorted, with `chain` field for tamper-evidence.
 * Never throws — diagnostic surface must not break the server.
 */
export function log(level: LogLevel, event: string, fields: Record<string, unknown> = {}): void {
  try {
    const body: LogEvent = {
      t: new Date().toISOString(),
      lvl: level,
      ev: event,
      ...fields,
    };
    chainLink = nextLink(chainLink, body);
    const out = canon({ ...body, chain: chainLink });
    process.stderr.write(out + "\n");
  } catch {
    // diagnostic surface is best-effort
  }
}

/**
 * Read-only handle for tests that want to verify the chain is monotone.
 */
export function currentChainLink(): string {
  return chainLink;
}

/**
 * Test-only reset. Production code should never need this.
 */
export function __resetChainForTest(): void {
  chainLink = "0".repeat(16);
}
