/**
 * v2.22.2 — CHALLENGER LIBRARIAN.
 *
 * Cross-checks an AI-generated plan / spec / claim against a curated
 * library of historical aerospace + safety-critical software failures.
 * For each registered pattern, the librarian:
 *
 *   - Runs the appropriate DETECTOR (keyword / dimensional /
 *     physics-axiom / structural)
 *   - Returns matches with the historical root cause + avoidance
 *     prescription + citation
 *
 * Composes:
 *   - dimensional_oracle.dimensionalCheck (for Mars Climate Orbiter)
 *   - physics_lathe.physicsCheck         (for Challenger O-ring temp,
 *                                          Apollo 1 over-pressure)
 *   - keyword + structural rules (simple regex over plan text)
 *
 * No LLM is called. All judgements are deterministic.
 */

import { dimensionalCheck } from "../dimensional_oracle/index.js";
import { physicsCheck } from "../physics_lathe/index.js";
import { FAILURES, listFailures, findFailure, type FailurePattern, type DetectorKind } from "./catalog.js";

export { FAILURES, listFailures, findFailure, type FailurePattern, type DetectorKind };

export interface FailureMatch {
  /** Stable id from the catalog. */
  id: string;
  /** Plain-English failure name. */
  name: string;
  /** Why this matched. */
  why: string;
  /** Match strength 0-1 (how certain the librarian is). */
  confidence: number;
  /** Root cause + avoidance. */
  rootCause: string;
  avoid: string;
  citation: string;
}

function keywordMatch(plan: string, triggers: string[] | undefined): { matched: string[]; score: number } {
  if (!triggers) return { matched: [], score: 0 };
  const lower = plan.toLowerCase();
  const matched = triggers.filter((t) => lower.includes(t.toLowerCase()));
  return { matched, score: triggers.length === 0 ? 0 : matched.length / triggers.length };
}

function runDimensional(plan: string, pattern: FailurePattern): FailureMatch | null {
  // Find any dimensional claim in the plan ("X = N lbf·s" etc.) by
  // splitting on sentence-ending punctuation (period FOLLOWED BY space
  // or end, never inside a decimal number like 9.8).
  const candidates = plan.split(/(?<=[a-zA-Z²³⁻\d])\s*[.;\n]+\s+|[.;\n]+$/).map((s) => s.trim()).filter((s) => /=|is\s/.test(s));
  for (const c of candidates) {
    const r = dimensionalCheck(c);
    if (r.verdict === "MISMATCH") {
      return {
        id: pattern.id,
        name: pattern.name,
        why: `dimensional mismatch: ${r.rationale}`,
        confidence: 0.9,
        rootCause: pattern.rootCause,
        avoid: pattern.avoid,
        citation: pattern.citation,
      };
    }
  }
  // Fallback: keyword-pass
  const { matched } = keywordMatch(plan, pattern.triggers);
  if (matched.length > 0) {
    return {
      id: pattern.id,
      name: pattern.name,
      why: `keyword cues: ${matched.join(", ")}`,
      confidence: 0.4,
      rootCause: pattern.rootCause,
      avoid: pattern.avoid,
      citation: pattern.citation,
    };
  }
  return null;
}

function runPhysics(plan: string, pattern: FailurePattern): FailureMatch | null {
  if (!pattern.physicsProbes) return null;
  // For each probe sentence, see if the PLAN contains structurally
  // similar phrasing (keyword overlap + numeric inconsistency).
  // v1: simple substring match on the probe template; if both halves
  // appear in plan, run physicsCheck on the whole thing.
  const lower = plan.toLowerCase();
  let anyMatched = false;
  for (const p of pattern.physicsProbes) {
    const tokens = p.toLowerCase().replace(/\$\{[^}]+\}/g, "").split(/\s+/).filter((t) => t.length > 2);
    const overlap = tokens.filter((t) => lower.includes(t)).length;
    if (overlap >= 2) anyMatched = true;
  }
  if (anyMatched) {
    const r = physicsCheck(plan);
    if (r.verdict === "REFUTED") {
      return {
        id: pattern.id,
        name: pattern.name,
        why: `physics-axiom refutation: ${r.rationale}`,
        confidence: 0.9,
        rootCause: pattern.rootCause,
        avoid: pattern.avoid,
        citation: pattern.citation,
      };
    }
  }
  // Fallback keyword
  const { matched } = keywordMatch(plan, pattern.triggers);
  if (matched.length > 0) {
    return {
      id: pattern.id,
      name: pattern.name,
      why: `keyword cues: ${matched.join(", ")}`,
      confidence: 0.5,
      rootCause: pattern.rootCause,
      avoid: pattern.avoid,
      citation: pattern.citation,
    };
  }
  return null;
}

function runKeyword(plan: string, pattern: FailurePattern): FailureMatch | null {
  const { matched, score } = keywordMatch(plan, pattern.triggers);
  if (matched.length === 0) return null;
  return {
    id: pattern.id,
    name: pattern.name,
    why: `keyword cues: ${matched.join(", ")}`,
    confidence: Math.min(0.9, 0.4 + score * 0.5),
    rootCause: pattern.rootCause,
    avoid: pattern.avoid,
    citation: pattern.citation,
  };
}

function runDetector(plan: string, pattern: FailurePattern): FailureMatch | null {
  switch (pattern.detector) {
    case "dimensional": return runDimensional(plan, pattern);
    case "physics-axiom": return runPhysics(plan, pattern);
    case "keyword":     return runKeyword(plan, pattern);
    case "structural":  return runKeyword(plan, pattern); // v1: structural reduces to keyword
  }
}

export interface CrossCheckReport {
  v: 1;
  plan: string;
  matches: FailureMatch[];
  /** Aggregate verdict: SAFE if no matches, CAUTION on 1+ low-conf,
   *  WARN on ≥1 high-conf, BLOCK on ≥1 max-conf + safety-critical. */
  verdict: "SAFE" | "CAUTION" | "WARN" | "BLOCK";
  /** Plain-English summary. */
  rationale: string;
}

const HIGH_CONF = 0.7;
const BLOCK_CONF = 0.85;

export function crossCheck(plan: string): CrossCheckReport {
  const matches: FailureMatch[] = [];
  for (const pattern of FAILURES) {
    const m = runDetector(plan, pattern);
    if (m) matches.push(m);
  }
  matches.sort((a, b) => b.confidence - a.confidence);
  let verdict: CrossCheckReport["verdict"] = "SAFE";
  let rationale = `No historical failure pattern matched (${FAILURES.length} catalog entries checked).`;
  if (matches.length > 0) {
    const top = matches[0]!;
    if (top.confidence >= BLOCK_CONF) {
      verdict = "BLOCK";
      rationale = `BLOCK: plan structurally resembles ${top.name} (${(top.confidence * 100).toFixed(0)}% confidence). ${top.why}`;
    } else if (top.confidence >= HIGH_CONF) {
      verdict = "WARN";
      rationale = `WARN: plan resembles ${top.name} (${(top.confidence * 100).toFixed(0)}% confidence). Review root cause.`;
    } else {
      verdict = "CAUTION";
      rationale = `CAUTION: ${matches.length} weak match(es); top is ${top.name} (${(top.confidence * 100).toFixed(0)}%).`;
    }
  }
  return { v: 1, plan, matches, verdict, rationale };
}

export function formatReport(r: CrossCheckReport): string {
  const badge = r.verdict === "SAFE" ? "✓" : r.verdict === "BLOCK" ? "🚨" : r.verdict === "WARN" ? "⚠" : "·";
  const lines: string[] = [
    `📚 CHALLENGER LIBRARIAN — ${badge} ${r.verdict}`,
    "",
    `  ${r.rationale}`,
  ];
  if (r.matches.length > 0) {
    lines.push("");
    lines.push("  Matches (highest confidence first):");
    for (const m of r.matches) {
      lines.push("");
      lines.push(`    ${m.name}   confidence=${(m.confidence * 100).toFixed(0)}%`);
      lines.push(`      why:        ${m.why}`);
      lines.push(`      root cause: ${m.rootCause}`);
      lines.push(`      avoid:      ${m.avoid}`);
      lines.push(`      citation:   ${m.citation}`);
    }
  }
  return lines.join("\n");
}
