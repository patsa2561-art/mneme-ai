/**
 * MCP `completion` primitive — tab-complete tool arguments.
 *
 * Currently we complete:
 *   • category arg of mneme.capabilities + mneme.tool.lint
 *   • name arg of mneme.tool.contract  → suggests every registered tool
 *   • tool arg of mneme.help / mneme.aletheia.* → same
 *
 * Extensible: when a tool's inputSchema declares an enum, we
 * suggest from the enum. Otherwise we fall back to the well-known
 * arg-name → completion map below.
 */

import { buildAllTools, groupByCategory } from "../tools/_registry.js";

const KNOWN_CATEGORIES = ["memory", "people", "audit", "forensics", "insights", "quality", "quant", "lab", "meta"];

/** Return up to N completion suggestions for `argName` of `toolName`. */
export function completeArgument(toolName: string, argName: string, partial: string): string[] {
  const lower = partial.toLowerCase();
  // Tool-name args.
  if (
    argName === "name" ||
    argName === "tool" ||
    argName === "target"
  ) {
    return buildAllTools()
      .map((t) => t.name)
      .filter((n) => n.toLowerCase().startsWith(lower) || n.toLowerCase().includes(lower))
      .slice(0, 25);
  }
  // Category args.
  if (argName === "category") {
    return KNOWN_CATEGORIES.filter((c) => c.startsWith(lower)).slice(0, 25);
  }
  // Tool-defined enum fallback.
  const tool = buildAllTools().find((t) => t.name === toolName);
  if (tool) {
    const props = (tool.inputSchema as { properties?: Record<string, { enum?: unknown[] }> })?.properties ?? {};
    const argDef = props[argName];
    if (argDef && Array.isArray(argDef.enum)) {
      return argDef.enum
        .filter((v): v is string => typeof v === "string")
        .filter((v) => v.toLowerCase().includes(lower))
        .slice(0, 25);
    }
  }
  // Fallback: empty completion.
  return [];
}

/** For tests + introspection — list every category we know about. */
export function knownCategories(): readonly string[] {
  return KNOWN_CATEGORIES;
}

/** For tests — count of completions available for a representative shape. */
export function _smokeCount(): number {
  void groupByCategory;
  return buildAllTools().length;
}
