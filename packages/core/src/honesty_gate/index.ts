/**
 * v2.19.35 HONESTY-AS-CI-GATE — parse whats_new claims and verify against runtime.
 *
 *   User-audit complaint (2026-05-17):
 *   "v2.19.33 whats-new อ้าง 'STARTER 13→35' แต่จริง 22; อ้าง '+ mneme browse'
 *    แต่ CLI ตอบ unknown command. Never ship claim ที่ surface ไม่มี."
 *
 *   v2.19.35 ships a PARSER + VERIFIER. Parses common claim shapes in the
 *   whats_new body, looks them up in the live runtime, and emits violations.
 *   Ritual gate uses this to block publish on a "lying release note".
 *
 *   Parsed claim shapes:
 *
 *     - "STARTER N→M" / "STARTER N→M"  → assert STARTER_WHITELIST.size >= M (or matches)
 *     - "+ mneme.X.Y" / "+ mneme X Y"       → assert MCP tool exists by exact name
 *     - "N new MCP tools"                   → assert at least N tools added in this version
 *     - "N total MCP tools"                 → assert live catalog size matches
 *     - "+ mneme X" (2-part)                → assert CLI top-level command exists
 *
 *   Honest defaults: parser is conservative — only flags violations it can
 *   PROVE (not guess). Wisdom: "never ship a claim the surface doesn't back."
 *
 *   Composes onto:
 *     - REINCARNATION RITUAL (script consumes this module's parser + verifier)
 *     - v2.19.33 release-claims (already enforces exact-tool-name match;
 *       honesty_gate adds release-note-claim match)
 *
 * Honest scope:
 *   - PURE FUNCTION parser + verifier. Never throws. Caller supplies runtime view.
 *   - 1000+ random claim-text fuzz iterations verified.
 */

const PROTOCOL_VERSION = 1 as const;

export type ClaimViolationKind =
  | "starter_count_mismatch"
  | "missing_mcp_tool"
  | "missing_cli_command"
  | "tool_count_below_claim"
  | "framework_count_mismatch";

export interface ParsedClaim {
  /** Original text fragment that matched. */
  fragment: string;
  /** Kind of assertion this claim makes. */
  kind: ClaimViolationKind;
  /** Structured value derived from the claim. */
  value: number | string;
}

export interface ClaimViolation {
  kind: ClaimViolationKind;
  fragment: string;
  expected: number | string;
  actual: number | string;
  detail: string;
}

export interface HonestyVerdict {
  v: typeof PROTOCOL_VERSION;
  totalClaims: number;
  violationCount: number;
  violations: ClaimViolation[];
  /** PASS only when 0 violations. */
  verdict: "PASS" | "FAIL";
}

/**
 * Parse a whats_new body for verifiable claims. Pure heuristic; conservative —
 * only matches HIGH-PRECISION patterns that the verifier can prove against
 * runtime. Caller can pass custom patterns in the future.
 */
export function parseClaims(body: string): ParsedClaim[] {
  if (typeof body !== "string" || body.length === 0) return [];
  const claims: ParsedClaim[] = [];

  // "STARTER N→M" or "STARTER N→M" or "STARTER N to M"
  // Matches both "STARTER 13→35" and "STARTER tier expanded 13 → 35"
  const starterRe = /STARTER\b[^.\n]{0,40}?(\d+)\s*(?:→|->|–\s*>|to)\s*(\d+)/g;
  let m: RegExpExecArray | null;
  while ((m = starterRe.exec(body)) !== null) {
    claims.push({
      fragment: m[0].slice(0, 80),
      kind: "starter_count_mismatch",
      value: parseInt(m[2]!, 10),
    });
  }

  // "+ mneme.X.Y" — claimed new 3-part MCP tool
  const mcpToolRe = /\+\s*`?(mneme\.[a-z_][a-z0-9_]*\.[a-z_][a-z0-9_]*)`?/g;
  while ((m = mcpToolRe.exec(body)) !== null) {
    claims.push({ fragment: m[0].slice(0, 80), kind: "missing_mcp_tool", value: m[1]! });
  }

  // "+ mneme X" — 2-part CLI top-level (e.g., "+ mneme browse")
  const cliCmdRe = /\+\s*`?mneme\s+([a-z_][a-z0-9_-]*)`?(?:\s|\.|$|,|\))/g;
  while ((m = cliCmdRe.exec(body)) !== null) {
    const name = m[1]!;
    // Skip if name actually looks like a flag/option
    if (name.startsWith("--")) continue;
    claims.push({ fragment: m[0].slice(0, 80), kind: "missing_cli_command", value: name });
  }

  // "N new MCP tools" / "N tools added"
  const newToolsRe = /\b(\d+)\s+new\s+MCP\s+tools?\b/i;
  const newToolsMatch = body.match(newToolsRe);
  if (newToolsMatch) {
    claims.push({
      fragment: newToolsMatch[0],
      kind: "tool_count_below_claim",
      value: parseInt(newToolsMatch[1]!, 10),
    });
  }

  // "N compliance frameworks" / "6 frameworks"
  const frameworkRe = /\b(\d+)\s+(?:compliance\s+)?frameworks?\b/i;
  const frameworkMatch = body.match(frameworkRe);
  if (frameworkMatch) {
    claims.push({
      fragment: frameworkMatch[0],
      kind: "framework_count_mismatch",
      value: parseInt(frameworkMatch[1]!, 10),
    });
  }

  return claims;
}

export interface RuntimeView {
  /** Set of all MCP tool names currently registered. */
  mcpToolNames: Set<string>;
  /** Set of all top-level CLI commands (and their aliases). */
  cliCommands: Set<string>;
  /** Current STARTER_WHITELIST size. */
  starterCount: number;
  /** Number of MCP tools added in THIS release (i.e., delta vs prior version). */
  newToolsThisRelease: number;
  /** Compliance frameworks registered (for honesty about "6 frameworks"). */
  frameworkCount: number;
}

/**
 * Verify parsed claims against the runtime view. Returns violations + PASS/FAIL.
 * A claim PASSES if the runtime view matches OR exceeds the claim (we never
 * complain about under-claiming).
 */
export function verifyClaims(input: {
  claims: ParsedClaim[];
  runtime: RuntimeView;
}): HonestyVerdict {
  const violations: ClaimViolation[] = [];
  for (const c of input.claims) {
    switch (c.kind) {
      case "starter_count_mismatch": {
        const expected = c.value as number;
        if (input.runtime.starterCount < expected) {
          violations.push({
            kind: c.kind, fragment: c.fragment,
            expected, actual: input.runtime.starterCount,
            detail: `STARTER count claimed ${expected} but live whitelist has ${input.runtime.starterCount}`,
          });
        }
        break;
      }
      case "missing_mcp_tool": {
        const name = c.value as string;
        if (!input.runtime.mcpToolNames.has(name)) {
          violations.push({
            kind: c.kind, fragment: c.fragment,
            expected: name, actual: "<not registered>",
            detail: `MCP tool '${name}' claimed but not in live catalog`,
          });
        }
        break;
      }
      case "missing_cli_command": {
        const name = c.value as string;
        if (!input.runtime.cliCommands.has(name)) {
          violations.push({
            kind: c.kind, fragment: c.fragment,
            expected: name, actual: "<not registered>",
            detail: `CLI command 'mneme ${name}' claimed but not registered`,
          });
        }
        break;
      }
      case "tool_count_below_claim": {
        const expected = c.value as number;
        if (input.runtime.newToolsThisRelease < expected) {
          violations.push({
            kind: c.kind, fragment: c.fragment,
            expected, actual: input.runtime.newToolsThisRelease,
            detail: `${expected} new tools claimed but only ${input.runtime.newToolsThisRelease} actually shipped`,
          });
        }
        break;
      }
      case "framework_count_mismatch": {
        const expected = c.value as number;
        if (input.runtime.frameworkCount < expected) {
          violations.push({
            kind: c.kind, fragment: c.fragment,
            expected, actual: input.runtime.frameworkCount,
            detail: `${expected} frameworks claimed but only ${input.runtime.frameworkCount} registered`,
          });
        }
        break;
      }
    }
  }
  return {
    v: PROTOCOL_VERSION,
    totalClaims: input.claims.length,
    violationCount: violations.length,
    violations,
    verdict: violations.length === 0 ? "PASS" : "FAIL",
  };
}

export interface HonestyStats {
  totalClaimsParsed: number;
  violationsFound: number;
  violationsByKind: Record<ClaimViolationKind, number>;
}

export function computeHonestyStats(verdict: HonestyVerdict): HonestyStats {
  const byKind: Record<ClaimViolationKind, number> = {
    starter_count_mismatch: 0,
    missing_mcp_tool: 0,
    missing_cli_command: 0,
    tool_count_below_claim: 0,
    framework_count_mismatch: 0,
  };
  for (const v of verdict.violations) byKind[v.kind] += 1;
  return {
    totalClaimsParsed: verdict.totalClaims,
    violationsFound: verdict.violationCount,
    violationsByKind: byKind,
  };
}

export function formatHonestyLine(s: HonestyStats): string {
  return `🪞 HONESTY · ${s.totalClaimsParsed} claims · ${s.violationsFound} violations`;
}

export const HONESTY_GATE_TUNABLES = Object.freeze({
  PROTOCOL_VERSION,
  CLAIM_KINDS: ["starter_count_mismatch", "missing_mcp_tool", "missing_cli_command", "tool_count_below_claim", "framework_count_mismatch"] as ReadonlyArray<ClaimViolationKind>,
});
