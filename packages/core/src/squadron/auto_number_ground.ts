/**
 * v2.44.0 — AUTO-NUMBER-GROUNDING.
 *
 * Turns NUMBER_BRIDGE caveat (informational) into a VERDICT (actionable)
 * by grounding the canonicalized number against live state.
 *
 * Pattern: when the claim says "Mneme has N <thing>" with N in any
 * paraphrase form (digits / English words / Thai numerals / hex / ...)
 * AND <thing> resolves to a measurable live count (tools / vaccines /
 * tests / files), auto-ground:
 *
 *   "Mneme has eight hundred sixty-five tools"
 *     → canonical: 865
 *     → live MCP catalog: 803
 *     → REFUTED: "claim says 865 tools (via 'eight hundred sixty-five'),
 *                 actual = 803 from MCP catalog"
 *
 * Pure deterministic + defensive: never throws; returns
 * { grounded: false } on any error so the caller falls back to the
 * existing NUMBER_BRIDGE caveat headline.
 */

import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { extractCanonicalNumbers } from "./acgv_number_bridge.js";

export type GroundVerdict = "SUPPORTED" | "REFUTED" | "UNKNOWN";

export interface NumberGroundResult {
  grounded: boolean;
  claimedValue?: number;
  expected?: number;
  noun?: string;
  verdict?: GroundVerdict;
  evidence?: string;
}

// Aliases the claim might use → canonical "thing" we know how to count.
const NOUN_FAMILIES: Record<string, "tools" | "vaccines" | "tests" | "files"> = {
  tool: "tools", tools: "tools",
  command: "tools", commands: "tools",
  mcp: "tools",
  vaccine: "vaccines", vaccines: "vaccines",
  test: "tests", tests: "tests",
  file: "files", files: "files",
};

function findCountableNoun(claim: string): string | null {
  // Tokenize and look for any noun we know.
  for (const w of claim.toLowerCase().split(/[^a-z]+/g)) {
    if (NOUN_FAMILIES[w]) return NOUN_FAMILIES[w]!;
  }
  return null;
}

function liveToolCount(repoRoot: string): number {
  // Mirror the pulse.ts fs-scan strategy: count `name: "mneme.*"` entries
  // in MCP tools source files. Defensive: any failure → 0 (caller skips).
  try {
    const sources = [
      join(repoRoot, "packages", "mcp", "src", "tools"),
      join(repoRoot, "node_modules", "@mneme-ai", "mcp", "dist", "tools"),
    ];
    for (const dir of sources) {
      if (!existsSync(dir)) continue;
      let count = 0;
      const entries = readdirSync(dir);
      for (const f of entries) {
        if (!/_tools?\.(ts|js)$/.test(f)) continue;
        try {
          const body = readFileSync(join(dir, f), "utf8");
          const matches = body.match(/name:\s*["']mneme\.[a-z_][a-z0-9_.]*["']/g);
          if (matches) count += matches.length;
        } catch { /* skip */ }
      }
      if (count > 0) return count;
    }
  } catch { /* fall through */ }
  return 0;
}

function liveVaccineCount(repoRoot: string): number {
  try {
    const p = join(repoRoot, ".mneme", "squadron", "lie-vaccines.jsonl");
    if (!existsSync(p)) return 0;
    return readFileSync(p, "utf8").split("\n").filter(Boolean).length;
  } catch { return 0; }
}

function liveTestCount(repoRoot: string): number {
  try {
    const dir = join(repoRoot, "tests", "regression");
    if (!existsSync(dir)) return 0;
    return readdirSync(dir).filter((f) => /\.test\.ts$/.test(f)).length;
  } catch { return 0; }
}

function liveFileCount(repoRoot: string, max = 50000): number {
  try {
    let count = 0;
    const walk = (d: string) => {
      let entries: string[];
      try { entries = readdirSync(d); } catch { return; }
      for (const e of entries) {
        if (count >= max) return;
        if (e === "node_modules" || e === ".git" || e === "dist") continue;
        const full = join(d, e);
        try {
          const st = statSync(full);
          if (st.isDirectory()) walk(full);
          else count++;
        } catch { /* skip */ }
      }
    };
    walk(repoRoot);
    return count;
  } catch { return 0; }
}

/**
 * Try to ground a number claim against live state. Returns grounded=false
 * when no recognizable pattern is found OR live count is unavailable.
 *
 * Pure-ish: reads fs (no network); defensive; never throws.
 */
export function tryAutoGroundNumber(claim: string, repoRoot: string): NumberGroundResult {
  if (!claim) return { grounded: false };
  const nums = extractCanonicalNumbers(claim);
  if (nums.length === 0) return { grounded: false };
  // Require "Mneme has N noun" shape (or similar with "the" / has variants).
  if (!/\b(mneme|the\s+repo|repo|project)\s+(has|contains|ships|provides|exposes|registers)\b/i.test(claim)) {
    return { grounded: false };
  }
  const noun = findCountableNoun(claim);
  if (!noun) return { grounded: false };
  // Get expected live value.
  let expected = 0;
  switch (noun) {
    case "tools":    expected = liveToolCount(repoRoot); break;
    case "vaccines": expected = liveVaccineCount(repoRoot); break;
    case "tests":    expected = liveTestCount(repoRoot); break;
    case "files":    expected = liveFileCount(repoRoot); break;
  }
  if (expected === 0) return { grounded: false };
  // Pick the FIRST integer value mentioned (most claims have one).
  const claimedValue = nums[0]!.value;
  // Tolerance: ±5% for soft equality (catches "around 800")
  const tol = Math.max(1, expected * 0.05);
  const diff = Math.abs(claimedValue - expected);
  const verdict: GroundVerdict = diff <= tol ? "SUPPORTED" : "REFUTED";
  return {
    grounded: true,
    claimedValue,
    expected,
    noun,
    verdict,
    evidence: verdict === "SUPPORTED"
      ? `claim's ${claimedValue} ${noun} matches live count ${expected} (±${Math.round(tol)})`
      : `claim says ${claimedValue} ${noun} (via "${nums[0]!.surface}") — actual live count is ${expected}`,
  };
}
