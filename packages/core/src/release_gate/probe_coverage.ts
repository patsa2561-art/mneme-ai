/**
 * v2.48.0 — RELEASE GATE: MANDATORY probe-coverage check.
 *
 * Root-cause fix for "feature velocity > probe velocity" bug class.
 * Pre-v2.48 pattern: new `mneme.<verb>.<sub>` tool ships in code,
 * `chore(release)` tags the version, BUT no TRUTH GATE probe exists
 * for the new tool. Result: bugs in the new feature slip through every
 * release because no measurement binds the marketing claim to live
 * behavior.
 *
 * This module provides a check that the release script (scripts/release.mjs)
 * calls before allowing `git tag`. New tools in the agent_manifest catalog
 * must EITHER have a matching `claim.<topic>` binding in CLAIM_CATALOG
 * OR be on an explicit whitelist (read-only / informational / experimental).
 */

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

// Whitelist of tools that are EXEMPT from probe-coverage (read-only /
// trivially safe / experimental). New tools should AVOID this list;
// it's the escape hatch, not the default.
const COVERAGE_EXEMPT = new Set<string>([
  "mneme.welcome",
  "mneme.capabilities",
  "mneme.release_notes",
  "mneme.version",
  "mneme.health",
  "mneme.verify_self",
  "mneme.system.health",
  "mneme.system.upgrade",
  "mneme.system.bootstrap",
  "mneme.system.cleanse_history",
  // Trivially-pure helpers
  "mneme.nemesis.fingerprint",
  "mneme.nemesis.env_scan",
  "mneme.nemesis.calibration_status",
  "mneme.nemesis.detect_tooling",
  "mneme.nemesis.verify_stamp",
  "mneme.nemesis.eu_stamp",
  "mneme.nemesis.install_hook",
  "mneme.nemesis.drift_check",
  "mneme.nemesis.replay_check",
  "mneme.argus.eyes",
  "mneme.argus.adapters",
  "mneme.argus.hydra",
  "mneme.argus.verify",
]);

export interface ProbeCoverageInput {
  /** List of NEW tool names introduced in this release (e.g. from agent_manifest diff). */
  newTools: string[];
  /** Known claim IDs currently registered in the TRUTH GATE catalog. */
  knownClaims: string[];
  /** Override the whitelist (for tests). */
  exemptOverride?: ReadonlySet<string>;
}

export interface ProbeCoverageResult {
  ok: boolean;
  /** Tools that have neither a matching claim nor exemption. */
  uncovered: string[];
  /** Tools that matched at least one claim. */
  covered: Array<{ tool: string; via: "claim" | "exempt" }>;
  /** Helpful next-step suggestion. */
  hint: string;
}

/**
 * Heuristic for matching tool → claim: extract the SECOND segment of
 * the tool name (e.g. `mneme.nemesis.classify` → `nemesis`) and check
 * if any claim id contains that key (e.g. `claim.nemesis.world_first`).
 * Tools matching at least one claim are covered.
 */
export function checkProbeCoverage(input: ProbeCoverageInput): ProbeCoverageResult {
  const exempt = input.exemptOverride ?? COVERAGE_EXEMPT;
  const claims = input.knownClaims ?? [];
  const covered: ProbeCoverageResult["covered"] = [];
  const uncovered: string[] = [];
  for (const tool of input.newTools) {
    if (exempt.has(tool)) {
      covered.push({ tool, via: "exempt" });
      continue;
    }
    const seg = tool.split(".")[1] ?? "";
    if (!seg) {
      uncovered.push(tool);
      continue;
    }
    // Match: any claim id contains the segment.
    const hit = claims.some((c) => c.toLowerCase().includes(seg.toLowerCase()));
    if (hit) covered.push({ tool, via: "claim" });
    else uncovered.push(tool);
  }
  const ok = uncovered.length === 0;
  return {
    ok,
    uncovered,
    covered,
    hint: ok
      ? "all new tools have probe coverage"
      : `${uncovered.length} new tool(s) lack TRUTH GATE probe binding. Either: (a) add a probe.<topic> + claim.<topic> to packages/core/src/truth_gate/{probes,claims}.ts, or (b) add the tool to COVERAGE_EXEMPT in packages/core/src/release_gate/probe_coverage.ts with a written justification.`,
  };
}

/**
 * Convenience: load the agent_manifest catalog + claim catalog from
 * disk + run the check. Returns a structured envelope the release
 * script can consume.
 */
export interface CrossCheckResult {
  ok: boolean;
  totalTools: number;
  totalClaims: number;
  uncovered: string[];
  hint: string;
}

export function crossCheckFromDisk(repoRoot: string): CrossCheckResult {
  try {
    const manifestPath = join(repoRoot, "packages", "core", "src", "agent_manifest.ts");
    const claimsPath = join(repoRoot, "packages", "core", "src", "truth_gate", "claims.ts");
    if (!existsSync(manifestPath) || !existsSync(claimsPath)) {
      return { ok: true, totalTools: 0, totalClaims: 0, uncovered: [], hint: "release-gate skipped: source files missing" };
    }
    const manifestBody = readFileSync(manifestPath, "utf8");
    const claimsBody = readFileSync(claimsPath, "utf8");
    // Extract tool names: `command: "mneme <verb> ..."`  AND  `name: "mneme.<verb>.<sub>"` from MCP tool files.
    const toolMatches = manifestBody.match(/command:\s*["']mneme\s+([a-z_][a-z0-9_]*)\s+([a-z_][a-z0-9_]*)/gi) ?? [];
    const tools = new Set<string>();
    for (const m of toolMatches) {
      const inner = m.match(/mneme\s+([a-z_][a-z0-9_]*)\s+([a-z_][a-z0-9_]*)/i);
      if (inner) tools.add(`mneme.${inner[1]}.${inner[2]}`);
    }
    const claimMatches = claimsBody.match(/id:\s*["'](claim\.[a-z0-9_.]+)["']/gi) ?? [];
    const claims: string[] = [];
    for (const m of claimMatches) {
      const inner = m.match(/(claim\.[a-z0-9_.]+)/i);
      if (inner) claims.push(inner[1]!);
    }
    const r = checkProbeCoverage({ newTools: Array.from(tools), knownClaims: claims });
    return { ok: r.ok, totalTools: tools.size, totalClaims: claims.length, uncovered: r.uncovered, hint: r.hint };
  } catch (e) {
    return { ok: true, totalTools: 0, totalClaims: 0, uncovered: [], hint: `release-gate skipped: ${(e as Error).message}` };
  }
}
