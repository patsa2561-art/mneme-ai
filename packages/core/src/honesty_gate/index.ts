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

// ─── HONESTY GATE 2.0 (v2.19.42) ──────────────────────────────────────────
//
// User audit (2026-05-18): v2.19.40 whats_new claimed "HOLY GRAIL QUADRUPLE
// — APOSTILLE + OUTCOME MARKET + ZK-FAIRNESS + ETERNITY" but a grep for
// `mneme.outcome.*` and `mneme.zk_fairness.*` returned zero hits — the
// wrappers existed under `mneme.market.*` and `mneme.fairness.*`. Users
// saw "QUADRUPLE" and concluded 2/4 was missing.
//
// HONESTY GATE 1.0 (v2.19.35) caught the strict "+ mneme.X.Y" / count /
// framework claim shapes but did NOT recognise feature-name claims like
// "OUTCOME MARKET" as implying MCP coverage. HONESTY GATE 2.0 adds:
//
//   1. parseFeatureNameClaims — pulls feature-name phrases (e.g.,
//      "OUTCOME MARKET", "TOKEN GOVERNOR", "GANGLION") and the implied
//      MCP-family prefix.
//   2. verifyFeatureCoverage — checks each feature-name has at least
//      ONE tool under its expected family OR an alias family.
//   3. autoAmendWhatsNew — when a feature-name claim has 0 coverage,
//      auto-injects a disclaimer marker in the body so the published
//      release-note is self-correcting. The amendment is deterministic,
//      idempotent, and reversible.
//
// Composes with v2.19.42 DISCOVERABILITY ALIASES — feature-name claim
// resolves against either canonical family OR alias family before
// flagging missing coverage.

export interface FeatureNameClaim {
  /** The exact phrase matched in the body. */
  phrase: string;
  /** Expected MCP family prefix(es) — caller can supply >1 for aliases. */
  expectedFamilies: string[];
}

export interface FeatureCoverageReport {
  phrase: string;
  expectedFamilies: string[];
  matchedFamily: string | null;
  toolCount: number;
  status: "covered" | "uncovered" | "alias_covered";
}

/**
 * Pull "feature name" claims from whats_new bodies. These are the loud
 * marketing-style banners (HOLY GRAIL QUADRUPLE / WIRING TRINITY /
 * TALK OF THE TOWN QUINTUPLE) plus any inline FEATURE_NAME tokens we
 * can recognise. Heuristic + conservative.
 */
export function parseFeatureNameClaims(
  body: string,
  knownFeatures: Record<string, string[]>,
): FeatureNameClaim[] {
  if (!body || typeof body !== "string") return [];
  const out: FeatureNameClaim[] = [];
  const seen = new Set<string>();
  for (const [phrase, expectedFamilies] of Object.entries(knownFeatures)) {
    const re = new RegExp(`\\b${phrase.replace(/[.*+?^${}()|[\\]\\\\]/g, "\\\\$&")}\\b`, "i");
    if (re.test(body)) {
      const key = phrase.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      out.push({ phrase, expectedFamilies });
    }
  }
  return out;
}

/**
 * For each feature-name claim, look up its expected families against the
 * runtime view + return coverage. Status is:
 *   covered       — canonical family has >=1 tool
 *   alias_covered — only an alias family has tools (mention alias)
 *   uncovered     — no family has any tools (HONESTY violation)
 */
export function verifyFeatureCoverage(
  claims: FeatureNameClaim[],
  runtime: { mcpToolNames: Set<string> },
): FeatureCoverageReport[] {
  return claims.map((c) => {
    let matchedFamily: string | null = null;
    let toolCount = 0;
    for (const fam of c.expectedFamilies) {
      const prefix = `mneme.${fam}.`;
      let count = 0;
      for (const name of runtime.mcpToolNames) {
        if (name.startsWith(prefix)) count += 1;
      }
      if (count > 0) {
        matchedFamily = fam;
        toolCount = count;
        break;
      }
    }
    const status: FeatureCoverageReport["status"] =
      !matchedFamily ? "uncovered"
        : matchedFamily === c.expectedFamilies[0] ? "covered"
        : "alias_covered";
    return { phrase: c.phrase, expectedFamilies: c.expectedFamilies, matchedFamily, toolCount, status };
  });
}

/**
 * Auto-amend whats_new body with disclaimer markers when feature-name
 * coverage is incomplete. The marker is a deterministic single-line
 * sentinel of the shape:
 *
 *   <!-- HONESTY-GATE: <phrase> covered by <N> tools under mneme.<fam>.* -->
 *
 * Idempotent: re-running on an already-amended body produces identical
 * output. Reversible: callers can strip every HONESTY-GATE marker line
 * with one regex. The amendment is INFORMATIONAL — caller decides
 * whether to publish the amended body or just surface the diff.
 */
export function autoAmendWhatsNew(body: string, reports: FeatureCoverageReport[]): {
  amended: string;
  added: number;
  notes: string[];
} {
  const lines = body.split(/\r?\n/);
  let added = 0;
  const notes: string[] = [];
  for (const r of reports) {
    const marker = r.status === "uncovered"
      ? `<!-- HONESTY-GATE: ${r.phrase} has 0 MCP tools under expected families [${r.expectedFamilies.join("|")}] — pending wrapper -->`
      : r.status === "alias_covered"
        ? `<!-- HONESTY-GATE: ${r.phrase} covered by ${r.toolCount} tools under alias mneme.${r.matchedFamily}.* — canonical name was [${r.expectedFamilies[0]}] -->`
        : null;
    if (!marker) continue;
    if (lines.includes(marker)) continue; // idempotent
    // Insert marker right after the first line that mentions the phrase.
    const phraseRe = new RegExp(`\\b${r.phrase.replace(/[.*+?^${}()|[\\]\\\\]/g, "\\\\$&")}\\b`, "i");
    let insertedAt = -1;
    for (let i = 0; i < lines.length; i++) {
      if (phraseRe.test(lines[i]!)) {
        lines.splice(i + 1, 0, marker);
        insertedAt = i + 1;
        added += 1;
        break;
      }
    }
    if (insertedAt === -1) {
      lines.push(marker);
      added += 1;
    }
    notes.push(`${r.status === "uncovered" ? "❌" : "ℹ"} ${r.phrase}: ${r.status}${r.matchedFamily ? ` (${r.toolCount} tools @ mneme.${r.matchedFamily}.*)` : ""}`);
  }
  return { amended: lines.join("\n"), added, notes };
}

/** Strip every auto-amend marker from a body (round-trip safety). */
export function stripHonestyAmendments(body: string): string {
  return body.split(/\r?\n/).filter((l) => !l.startsWith("<!-- HONESTY-GATE:")).join("\n");
}

/**
 * One-call combined audit: parse feature-name claims + verify + amend.
 * The default knownFeatures map covers the loudest banners from v2.18+.
 * Caller can extend per-release.
 */
export const DEFAULT_FEATURE_FAMILY_MAP: Readonly<Record<string, string[]>> = Object.freeze({
  "APOSTILLE": ["apostille"],
  // Source-name first so the canonical name from whats_new gets matched as
  // expectedFamilies[0]; live MCP namespaces appear as fallback aliases.
  "OUTCOME MARKET": ["outcome", "market"],
  // v2.19.46 — user audit flagged the underscore spelling as unrecognised
  // by the honesty gate. Add the underscore variants so any of the three
  // shapes (OUTCOME MARKET / outcome_market / OUTCOME_MARKET) gets caught.
  "OUTCOME_MARKET": ["outcome", "market"],
  "outcome_market": ["outcome", "market"],
  "ZK-FAIRNESS": ["zk_fairness", "fairness"],
  "ZK FAIRNESS": ["zk_fairness", "fairness"],
  "ZK_FAIRNESS": ["zk_fairness", "fairness"],
  "zk_fairness": ["zk_fairness", "fairness"],
  "ETERNITY": ["eternity"],
  "TOKEN GOVERNOR": ["governor"],
  "PROMPT FOSSIL": ["fossil"],
  "GANGLION": ["ganglion"],
  "MAYOR ELECTION": ["mayor"],
  "CITIZEN'S AUDIT": ["citizens"],
  "CONSCIENCE CARD": ["card"],
  "RECEIPT PROTOCOL": ["protocol"],
  "BROWSER RECEIPT": ["browser"],
  "HONESTY GATE": ["honesty"],
  "BEACON HANDOFF": ["handoff", "beacon"],
  "SOUL EMBALMING": ["commonwealth"],
  "DREAMSPACE": ["dreamspace"],
  "TRUTH FORENSIC": ["truth"],
});

export function auditFeatureCoverage(input: {
  body: string;
  runtime: { mcpToolNames: Set<string> };
  knownFeatures?: Record<string, string[]>;
}): { claims: FeatureNameClaim[]; reports: FeatureCoverageReport[]; amend: { amended: string; added: number; notes: string[] } } {
  const known = input.knownFeatures ?? DEFAULT_FEATURE_FAMILY_MAP;
  const claims = parseFeatureNameClaims(input.body, known as Record<string, string[]>);
  const reports = verifyFeatureCoverage(claims, input.runtime);
  const amend = autoAmendWhatsNew(input.body, reports);
  return { claims, reports, amend };
}
