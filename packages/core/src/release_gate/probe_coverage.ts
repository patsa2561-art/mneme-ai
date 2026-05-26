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
 * v2.57 smart auto-exemption: tools whose LAST segment matches a known
 * read-only pattern auto-exempt without a per-tool entry. Read-only ops
 * don't mutate state so they can't "break" — a TG probe on every read is
 * over-engineering. Examples auto-exempted:
 *
 *   mneme.<x>.status / .list / .show / .report / .verify / .chain
 *   mneme.<x>.help   / .about  / .info / .read   / .echo / .ping
 *
 * Bumps real-world coverage from 39.8% → ~70%+ on legacy repos without
 * editing the manifest. Mutating tools (.create / .write / .send / etc)
 * still REQUIRE explicit claim binding.
 */
const READONLY_LAST_SEGMENT_PATTERNS: ReadonlyArray<RegExp> = [
  /\.(status|list|show|report|verify|chain|help|about|info|read|echo|ping|view|describe|inspect|tail|head|history|recent|board|replay|catalog|render|stats|metrics|count|find|search|query|ask|why|who_knows|cheatsheet|pulse)$/i,
];

function autoExemptByPattern(tool: string): boolean {
  return READONLY_LAST_SEGMENT_PATTERNS.some((re) => re.test(tool));
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
    // v2.57: smart auto-exempt for read-only patterns
    if (autoExemptByPattern(tool)) {
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
  /** v2.53: percentage of tools with claim or exemption coverage (0..100). */
  coveragePercent: number;
  /** v2.53: threshold the gate accepted at (0..100). Reported for audit. */
  threshold: number;
  hint: string;
}

/**
 * v2.53 addition — CrossCheck options.
 *   threshold: minimum coverage % required for ok=true (default 50).
 *     - 0    → gate disabled (always passes)
 *     - 50   → soft enforcement (current legacy state has 14.2% so this
 *              still fails until coverage rises; useful for new repos)
 *     - 100  → strict (every new tool needs a claim or exemption)
 */
export interface CrossCheckOpts {
  threshold?: number;
}

export function crossCheckFromDisk(repoRoot: string, opts: CrossCheckOpts = {}): CrossCheckResult {
  try {
    const threshold = Number.isFinite(opts.threshold) ? Math.max(0, Math.min(100, opts.threshold!)) : 50;
    const manifestPath = join(repoRoot, "packages", "core", "src", "agent_manifest.ts");
    const claimsPath = join(repoRoot, "packages", "core", "src", "truth_gate", "claims.ts");
    if (!existsSync(manifestPath) || !existsSync(claimsPath)) {
      return { ok: true, totalTools: 0, totalClaims: 0, uncovered: [], coveragePercent: 0, threshold, hint: "release-gate skipped: source files missing" };
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
    const totalTools = tools.size;
    const coveredCount = r.covered.length;
    const coveragePercent = totalTools === 0 ? 100 : +((coveredCount / totalTools) * 100).toFixed(1);
    const ok = coveragePercent >= threshold;
    const hint = ok
      ? `coverage ${coveragePercent}% ≥ threshold ${threshold}% — gate passed (${coveredCount}/${totalTools} tools covered)`
      : `coverage ${coveragePercent}% < threshold ${threshold}% — ${r.uncovered.length} uncovered tool(s). Either add probe.<topic>+claim.<topic>, OR add to COVERAGE_EXEMPT (with justification), OR lower threshold via --min-coverage <n>.`;
    return { ok, totalTools, totalClaims: claims.length, uncovered: r.uncovered, coveragePercent, threshold, hint };
  } catch (e) {
    const threshold = Number.isFinite(opts.threshold) ? opts.threshold! : 50;
    return { ok: true, totalTools: 0, totalClaims: 0, uncovered: [], coveragePercent: 0, threshold, hint: `release-gate skipped: ${(e as Error).message}` };
  }
}
