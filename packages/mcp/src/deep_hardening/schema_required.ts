/**
 * v2.26.0 — Schema-required validator (closes N2 deep-finding).
 *
 * Audit (v2.24.0): family-coverage of 20 random tools with empty args
 * showed 19/20 dispatched successfully even though 15 had `required`
 * fields in their inputSchema. The MCP server treated `required` as
 * advisory documentation. Tools silently received `{}` and either
 * crashed (caught as runtime error) or returned junk results.
 *
 * Fix: PRE-DISPATCH validator that reads the tool's inputSchema +
 *   1. confirms every name in `required` is present in args
 *   2. confirms the type matches (string/number/boolean/array/object)
 *      where the schema specifies a type
 *
 * Returns CallToolResult.isError=true with a structured `missing` /
 * `wrongType` list so AI agents can self-correct on the next call.
 *
 * The validator is intentionally permissive on UNKNOWN fields — extra
 * args are forward-compatible per JSON-Schema standard.
 */

export interface SchemaProperty {
  type?: "string" | "number" | "integer" | "boolean" | "array" | "object";
  description?: string;
}

export interface ToolInputSchema {
  type?: "object";
  properties?: Record<string, SchemaProperty>;
  required?: string[];
}

export type ArgViolationKind = "missing" | "wrong-type" | "null-required";

export interface ArgViolation {
  field: string;
  kind: ArgViolationKind;
  expected?: string;
  got?: string;
}

export interface SchemaVerdict {
  ok: boolean;
  violations: ArgViolation[];
  /** Single-line summary suitable for CallToolResult.content. */
  reason: string;
}

function typeOfValue(v: unknown): string {
  if (v === null) return "null";
  if (Array.isArray(v)) return "array";
  return typeof v;
}

function matches(expected: string, actual: string): boolean {
  if (expected === actual) return true;
  if (expected === "integer" && actual === "number") return true;
  return false;
}

/**
 * Validate args against a tool's inputSchema. Returns ok=true iff
 * every required field is present + every declared property has the
 * right type (or is omitted).
 */
export function validateArgs(args: Record<string, unknown>, schema: ToolInputSchema | undefined): SchemaVerdict {
  if (!schema || typeof schema !== "object") {
    return { ok: true, violations: [], reason: "no schema" };
  }
  const violations: ArgViolation[] = [];
  const required = Array.isArray(schema.required) ? schema.required : [];
  const properties = schema.properties ?? {};

  for (const name of required) {
    if (!(name in args)) {
      violations.push({ field: name, kind: "missing", expected: properties[name]?.type });
      continue;
    }
    if (args[name] === null) {
      violations.push({ field: name, kind: "null-required", expected: properties[name]?.type, got: "null" });
    }
  }
  for (const [name, value] of Object.entries(args)) {
    const prop = properties[name];
    if (!prop || !prop.type) continue;
    const actual = typeOfValue(value);
    if (actual === "undefined" || actual === "null") continue;
    if (!matches(prop.type, actual)) {
      violations.push({ field: name, kind: "wrong-type", expected: prop.type, got: actual });
    }
  }
  if (violations.length === 0) return { ok: true, violations: [], reason: "ok" };
  const reason = violations
    .map((v) => v.kind === "missing" ? `missing '${v.field}'` : v.kind === "null-required" ? `required '${v.field}' is null` : `'${v.field}' expected ${v.expected}, got ${v.got}`)
    .join("; ");
  return { ok: false, violations, reason };
}
