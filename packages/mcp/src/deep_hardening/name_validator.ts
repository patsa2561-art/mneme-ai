/**
 * v2.26.0 — Tool name validator (closes N3 deep-finding).
 *
 * Audit (v2.24.0): tool-name fuzzing 10 vectors — 9/10 NO ERROR
 * including empty string, path-traversal (`../../../etc/passwd`),
 * proto-pollution (`__proto__.constructor`), 10K-char names, emoji.
 * The MCP server silently accepted every malicious name and either
 * dispatched (potentially to the wrong tool via lookup) or returned
 * a confusing "unknown tool" message that buried the real issue.
 *
 * Fix: a strict regex gate at the START of CallToolRequestHandler.
 *   - Valid:    `mneme.<lowercase>(\.<lowercase>)*`
 *   - Rejected: empty, control chars, path-traversal, prototype keys,
 *               very long, non-ASCII (emoji / unicode), uppercase
 *
 * Rejection returns CallToolResult.isError=true with a structured
 * reason field so AI agents can distinguish "name format invalid"
 * from "name not in catalog".
 *
 * The validator is PURE and runs in microseconds — no dispatch cost.
 */

const NAME_RE = /^mneme\.[a-z_][a-z0-9_]*(\.[a-z_][a-z0-9_]*)*$/;
const MAX_LEN = 128;

export type NameClassification =
  | "valid"
  | "empty"
  | "too-long"
  | "non-ascii"
  | "uppercase"
  | "control-char"
  | "prototype-key"
  | "path-traversal"
  | "wrong-namespace"
  | "shape-violation";

export interface NameVerdict {
  ok: boolean;
  classification: NameClassification;
  reason: string;
}

/** Classify a tool name. Returns ok=true iff it passes every gate. */
export function classifyToolName(name: unknown): NameVerdict {
  if (typeof name !== "string" || name.length === 0) {
    return { ok: false, classification: "empty", reason: "tool name is empty or non-string" };
  }
  if (name.length > MAX_LEN) {
    return { ok: false, classification: "too-long", reason: `tool name length ${name.length} exceeds ${MAX_LEN}` };
  }
  // eslint-disable-next-line no-control-regex
  if (/[\x00-\x1F\x7F]/.test(name)) {
    return { ok: false, classification: "control-char", reason: "tool name contains control characters" };
  }
  // ASCII-only: reject homoglyphs / RTL injection / emoji
  if (/[^\x20-\x7E]/.test(name)) {
    return { ok: false, classification: "non-ascii", reason: "tool name contains non-ASCII characters" };
  }
  // Path-traversal patterns
  if (/(?:^|[/\\.])\.\.(?:$|[/\\.])|\/|\\/.test(name)) {
    return { ok: false, classification: "path-traversal", reason: "tool name contains path-traversal sequences" };
  }
  // Prototype-pollution keys
  if (/__proto__|prototype\.|constructor\./.test(name)) {
    return { ok: false, classification: "prototype-key", reason: "tool name contains a prototype-poisoning sequence" };
  }
  if (/[A-Z]/.test(name)) {
    return { ok: false, classification: "uppercase", reason: "tool name must be lowercase" };
  }
  if (!name.startsWith("mneme.")) {
    return { ok: false, classification: "wrong-namespace", reason: "tool name must start with 'mneme.'" };
  }
  if (!NAME_RE.test(name)) {
    return { ok: false, classification: "shape-violation", reason: "tool name does not match ^mneme\\.[a-z_][a-z0-9_.]*$" };
  }
  return { ok: true, classification: "valid", reason: "ok" };
}
