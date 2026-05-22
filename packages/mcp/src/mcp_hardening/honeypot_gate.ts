/**
 * v2.24.0 — Honeypot MCP gate (closes audit finding M3).
 *
 * Audit finding M3: CLI advertises `mneme system exec` as
 * "[HONEYPOT — DO NOT CALL] logged as attacker probe", but the same
 * tool surface reachable via MCP (e.g. `mneme.aegis.honeypot.seed`)
 * returns data with no gate. An AI agent that respects the CLI banner
 * gets tricked into running it through the MCP path and is logged as
 * an attacker for following a legitimate flow.
 *
 * Fix: maintain a registry of honeypot tools and a default deny policy
 * over MCP. Tools mark themselves as honeypot via:
 *
 *   1. Name prefix `mneme.aegis.honeypot.*` or `mneme.system.exec`
 *   2. Description text contains "[HONEYPOT" (case-insensitive)
 *   3. Explicit allow-list (e.g. .mneme/honeypot-allow.jsonl) — only
 *      for users who want to run the honeypot deliberately
 *
 * The MCP server returns a CallToolResult with `isError: true` AND a
 * structured log entry so the fuzzer can pin policy parity between
 * CLI and MCP surfaces.
 */

import type { MnemeTool } from "../tools/_types.js";

const HONEYPOT_NAME_PATTERNS: RegExp[] = [
  /^mneme\.aegis\.honeypot(\.|$)/i,
  /^mneme\.system\.exec(\.|$)/i,
  /\.honeypot(\.|$)/i,
];

const HONEYPOT_DESC_PATTERN = /\[honeypot/i;

export interface HoneypotVerdict {
  flagged: boolean;
  reason: string;
  category: "name-prefix" | "description-marker" | "explicit-allow" | "clean";
}

export function classifyHoneypot(tool: MnemeTool | { name: string; description?: string }): HoneypotVerdict {
  for (const re of HONEYPOT_NAME_PATTERNS) {
    if (re.test(tool.name)) {
      return {
        flagged: true,
        reason: `tool name matches honeypot pattern ${re}`,
        category: "name-prefix",
      };
    }
  }
  if (tool.description && HONEYPOT_DESC_PATTERN.test(tool.description)) {
    return {
      flagged: true,
      reason: "description contains [HONEYPOT marker",
      category: "description-marker",
    };
  }
  return { flagged: false, reason: "no honeypot markers", category: "clean" };
}

export interface GateDecision {
  allow: boolean;
  reason: string;
  honeypot: HoneypotVerdict;
}

/**
 * Decide whether a tool call is allowed. Honeypot tools default to
 * deny; an allow-list entry can override (operator deliberately runs
 * the honeypot for testing).
 *
 * Allow-list shape (one JSON line per entry in .mneme/honeypot-allow.jsonl):
 *   { "tool": "mneme.aegis.honeypot.seed", "by": "operator", "exp": "<ISO>" }
 */
export function evaluateGate(
  tool: MnemeTool | { name: string; description?: string },
  opts: { allowList?: Set<string> } = {},
): GateDecision {
  const honeypot = classifyHoneypot(tool);
  if (!honeypot.flagged) {
    return { allow: true, reason: "not a honeypot", honeypot };
  }
  if (opts.allowList && opts.allowList.has(tool.name)) {
    return {
      allow: true,
      reason: "operator override via allow-list",
      honeypot: { ...honeypot, category: "explicit-allow" },
    };
  }
  return {
    allow: false,
    reason:
      `Mneme MCP refuses to call ${tool.name}: honeypot tool (${honeypot.reason}). ` +
      `To call deliberately, add the name to .mneme/honeypot-allow.jsonl.`,
    honeypot,
  };
}
