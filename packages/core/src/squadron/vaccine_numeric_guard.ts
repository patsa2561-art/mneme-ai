/**
 * v2.28.0 — VACCINE NUMERIC-FACT GUARD.
 *
 * Closes R1 of the v2.27.0 audit: vaccine cache matched
 *   sig: "IMPOSSIBLE_REFUTE :: swarm_organ_count=8"
 *   claim: "Mneme has 9 verification agents"
 * via simhash similarity, returning AUTO_REFUTE 99% on a claim with
 * a DIFFERENT numeric fact. The N3-overshoot fix (v2.19.44) only
 * checks `mneme.X.Y` tool mentions; numeric facts slipped through.
 *
 * The world-first move: vaccines that ENCODE a numeric fact must
 * REJECT new claims whose number is different. We extract the
 * number from both the vaccine signature and the claim, and refuse
 * to match when they disagree (within tolerance).
 *
 * Pure deterministic logic; no LLM, no network.
 */

interface ExtractedNumeric {
  key: string;
  value: number;
}

/**
 * Extract `key=NUMBER` pairs from a vaccine signature like
 *   "IMPOSSIBLE_REFUTE :: swarm_organ_count=8"
 *   "BLACK_HOLE :: version=2.19.34"
 *
 * Version-shaped values (`2.19.34`) are returned as the first
 * number ONLY (the major version); structural matching for
 * full semver is the caller's job.
 */
export function numericsInSignature(signature: string): ExtractedNumeric[] {
  const out: ExtractedNumeric[] = [];
  // Match `key=value` pairs; key is identifier-ish, value is number-ish
  const re = /([a-zA-Z_][a-zA-Z0-9_]*)=([0-9]+(?:\.[0-9]+)*)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(signature)) !== null) {
    const key = m[1]!;
    const raw = m[2]!;
    // For semver-like strings, take FIRST segment
    const first = raw.includes(".") ? raw.split(".")[0]! : raw;
    const n = Number(first);
    if (Number.isFinite(n)) out.push({ key, value: n });
  }
  return out;
}

/**
 * Extract numeric facts FROM the claim text. We do a coarse pass:
 *   - "9 verification agents" → {key:"agents", value:9}
 *   - "1290 MCP tools" → {key:"tools", value:1290}
 *   - "Mneme v2.27.0" → {key:"version", value:2}
 *
 * This is intentionally conservative — false positives here would
 * INVALIDATE legitimate vaccine matches. The guard is OPT-IN per
 * vaccine: it ONLY fires when the vaccine itself encodes a numeric
 * fact (so unrelated vaccines are unaffected).
 */
export function numericsInClaim(claim: string): ExtractedNumeric[] {
  const out: ExtractedNumeric[] = [];
  // Pattern 1: "NUMBER WORD" e.g. "9 verification agents"
  const re1 = /\b(\d+(?:\.\d+)*)\s+([a-zA-Z][a-zA-Z_-]+)/g;
  let m: RegExpExecArray | null;
  while ((m = re1.exec(claim)) !== null) {
    const raw = m[1]!;
    const first = raw.includes(".") ? raw.split(".")[0]! : raw;
    const n = Number(first);
    if (Number.isFinite(n)) out.push({ key: m[2]!.toLowerCase(), value: n });
  }
  // Pattern 2: "v2.27.0" → version=2
  const reV = /\bv?(\d+)(?:\.\d+)+/g;
  while ((m = reV.exec(claim)) !== null) {
    const n = Number(m[1]!);
    if (Number.isFinite(n)) out.push({ key: "version", value: n });
  }
  return out;
}

/**
 * Decide whether the vaccine's encoded numeric fact CONFLICTS with
 * any numeric fact in the new claim. Returns:
 *   { conflict: true, reason: "..." }  → burn the vaccine match
 *   { conflict: false }                 → keep the vaccine match
 *
 * The matcher is SOFT — only confirmed mismatches return true. If
 * the vaccine has no numerics OR the claim has no overlapping
 * numerics, conflict=false (so unrelated vaccines aren't affected).
 *
 * Semantic-key bridge: the vaccine's key (e.g. "swarm_organ_count")
 * is matched against the claim's keys (e.g. "verification", "agents",
 * "organs", "count") via TOKEN OVERLAP. If any token from the
 * vaccine key overlaps with the claim key (after split-by-underscore-
 * and-lowercase), they are considered comparable.
 */
export function vaccineConflictsWithClaim(
  signature: string,
  claim: string,
): { conflict: boolean; reason: string } {
  const sigNums = numericsInSignature(signature);
  if (sigNums.length === 0) return { conflict: false, reason: "vaccine encodes no numeric fact" };
  const claimNums = numericsInClaim(claim);
  if (claimNums.length === 0) return { conflict: false, reason: "claim has no numeric facts" };

  // Build keyword tokens for fuzzy matching
  const sigTokens = (sig: ExtractedNumeric) => sig.key.split(/[_\-]/).map((t) => t.toLowerCase()).filter(Boolean);
  // Some claim keys correspond semantically (agents ↔ organs ↔ verifier ↔ count etc)
  // Semantic-bridge: families of tokens that mean "the same kind of
  // countable thing" across English variants. When the vaccine sig
  // token + claim token share a family, the numeric mismatch is a
  // genuine contradiction, not a coincidence.
  const FAMILY_VERIFIERS = ["agent", "agents", "organ", "organs", "verifier", "verifiers", "verification", "verifications", "count", "swarm", "checker", "checkers", "validator", "validators"];
  const FAMILY_TOOLS = ["tool", "tools", "count", "command", "commands"];
  const FAMILY_VERSION = ["version", "v"];
  const SEMANTIC_BRIDGE: Record<string, string[]> = {};
  for (const t of FAMILY_VERIFIERS) SEMANTIC_BRIDGE[t] = FAMILY_VERIFIERS;
  for (const t of FAMILY_TOOLS) SEMANTIC_BRIDGE[t] = [...(SEMANTIC_BRIDGE[t] ?? []), ...FAMILY_TOOLS];
  for (const t of FAMILY_VERSION) SEMANTIC_BRIDGE[t] = FAMILY_VERSION;

  for (const sn of sigNums) {
    const sTokens = sigTokens(sn);
    for (const cn of claimNums) {
      const cTokens = (cn.key + "").split(/[_\-]/).map((t) => t.toLowerCase()).filter(Boolean);
      // Semantic-bridge match: any sTokens or cTokens map to overlapping family
      const sFamily = new Set<string>();
      for (const t of sTokens) {
        sFamily.add(t);
        for (const b of SEMANTIC_BRIDGE[t] ?? []) sFamily.add(b);
      }
      const cFamily = new Set<string>();
      for (const t of cTokens) {
        cFamily.add(t);
        for (const b of SEMANTIC_BRIDGE[t] ?? []) cFamily.add(b);
      }
      const overlap = [...sFamily].some((t) => cFamily.has(t));
      if (!overlap) continue;
      // Same key (or semantically-bridged) → compare values
      if (sn.value !== cn.value) {
        return {
          conflict: true,
          reason: `vaccine '${sn.key}=${sn.value}' contradicts claim '${cn.key}=${cn.value}' (semantically related; numbers differ)`,
        };
      }
    }
  }
  return { conflict: false, reason: "no numeric conflict" };
}
