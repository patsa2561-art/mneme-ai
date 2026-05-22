/**
 * v2.23.0 — DOJO · SPEC-DIFF SENSEI.
 *
 * Detects DOC/CODE DRIFT — when a command's help text advertises one
 * signature (positional args, option flags) but the action handler
 * rejects that signature. The v2.22.3 audit caught one of these
 * (`swarm` help showed `<claim...>` but action took 0 args); this
 * sensei makes the catch automatic for every release.
 *
 * Strategy: parse each manifest entry's `command` field, check for
 * positional + flag tokens, then introspect the running Commander
 * tree (when available) to compare. v1: rule-based static check of
 * the manifest itself for obvious mismatches; v2 (future): probe
 * the live CLI via spawn.
 */

import { MNEME_COMMAND_CATALOG, type ManifestCommand } from "../../agent_manifest.js";

export interface SpecDriftFinding {
  command: string;
  driftKind: "missing-positional" | "missing-option" | "shape-mismatch" | "type-mismatch";
  detail: string;
}

export interface SpecDiffResult {
  total: number;
  /** Commands with no detected drift. */
  clean: number;
  /** Commands that drift. */
  drifted: number;
  findings: SpecDriftFinding[];
}

const POSITIONAL_RE = /<[^>]+>|\[[^\]]+\]/g;
const FLAG_RE = /--[a-z][a-z0-9-]*/g;

/** Detect drift via static analysis of the manifest command field +
 *  the `what` description. This catches the most common bug class:
 *  `what` mentions a flag that the `command` signature doesn't declare,
 *  or vice versa. */
export function detectSpecDrift(catalog: ManifestCommand[] = MNEME_COMMAND_CATALOG): SpecDiffResult {
  const findings: SpecDriftFinding[] = [];
  for (const entry of catalog) {
    // Skip MCP-style entries (they don't have shell command signatures).
    if (!entry.command.startsWith("mneme ")) continue;
    const declaredFlags = new Set(entry.command.match(FLAG_RE) ?? []);
    const declaredPositionals = entry.command.match(POSITIONAL_RE) ?? [];
    const mentionedFlagsInWhat = (entry.what.match(FLAG_RE) ?? []).filter((f) => f.length > 2);
    // A `--flag` mentioned in `what` but missing from the command
    // signature is suspicious (could be hidden but most are bugs).
    for (const f of mentionedFlagsInWhat) {
      if (!declaredFlags.has(f) && !COMMON_PARENT_FLAGS.has(f)) {
        findings.push({
          command: entry.command,
          driftKind: "missing-option",
          detail: `description mentions ${f} but the command signature does not declare it`,
        });
      }
    }
    // Description mentions "positional" or "<arg>" pattern but
    // command has no positional? Flag.
    if (/positional|\<[a-z]/.test(entry.what.toLowerCase()) && declaredPositionals.length === 0) {
      findings.push({
        command: entry.command,
        driftKind: "missing-positional",
        detail: "description mentions a positional argument but command signature has none",
      });
    }
  }
  const drifted = new Set(findings.map((f) => f.command)).size;
  return {
    total: catalog.filter((c) => c.command.startsWith("mneme ")).length,
    clean: catalog.filter((c) => c.command.startsWith("mneme ")).length - drifted,
    drifted,
    findings,
  };
}

// Flags inherited from program-wide options; they appear in commands' `what`
// but aren't re-declared per command.
const COMMON_PARENT_FLAGS = new Set([
  "--help", "--version", "--json", "--compliance", "--naked", "--full",
  "--debug", "--verbose", "--quiet",
]);
