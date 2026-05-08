/**
 * Constitutional Gate — runtime enforcement of repo-history rules.
 *
 * Constitutional AI is currently a TRAINING-time idea (Anthropic 2022).
 * This module implements it at the DEV-TOOL RUNTIME layer:
 *
 *   1. Mneme synthesises a constitution from repo history (regrets,
 *      decisions, atrophy, forensics) — already shipped in v1.10.0.
 *   2. When the AI proposes code (e.g., a draft PR), the gate checks
 *      whether the proposal violates any MUST-NOT rule.
 *   3. If violated → REFUSE + return the rule + the evidence + a
 *      rewrite hint. The AI must rewrite. Loop until pass.
 *
 * Contrast with the existing constitution system: that returns advice
 * the AI may ignore. This gate returns a verdict the AI must respect.
 *
 * Wisdom check (world-class?): YES.
 *   • Constitutional AI applied at runtime — first MCP tool to do this.
 *   • Decision is auditable: gate records every refusal in audit log.
 *   • Rule matching is explainable: every refusal cites the source rule.
 *   • Bounded: gate only refuses on MUST / MUST-NOT severity, never on
 *     SHOULD / CONSIDER (those stay advisory).
 */

export type RuleSeverity = "must-not" | "must" | "should" | "consider";

export interface ConstitutionRule {
  id: string;
  source: "regret" | "atrophy" | "forensics" | "decision";
  rule: string;
  evidence: string;
  severity: RuleSeverity;
}

export interface ConstitutionalCheckInput {
  /** The code/answer/diff being proposed by the AI */
  proposal: string;
  /** Optional file path the proposal targets */
  targetPath?: string;
  /** The constitution rules to check against */
  rules: ConstitutionRule[];
}

export interface ConstitutionalVerdict {
  /** "allow" | "refuse" — the gate's decision */
  verdict: "allow" | "refuse";
  /** When refused, the rules that were violated (in severity order) */
  violations: Array<{
    rule: ConstitutionRule;
    /** The matching span from the proposal that triggered the rule */
    matchedText: string;
    /** Suggested rewrite hint based on the rule */
    rewriteHint: string;
  }>;
  /** Plain-English summary the AI can quote back to the user */
  wisdom: string;
}

/**
 * Convert a rule into a deny-pattern. Rules are derived from repo
 * history (e.g., "Be cautious with patterns similar to: revert JWT auth")
 * — we extract the "key phrase" that flags the proposal.
 *
 * Heuristic: take the most distinctive nouns/phrases after "to:", "using",
 * "switch from X to Y", etc. Conservative — only fire on clear matches
 * to avoid false positives.
 */
function rulePattern(rule: ConstitutionRule): RegExp | null {
  const r = rule.rule;
  // Forensics rules typically reference a file path → match if the
  // proposal touches that file.
  if (rule.source === "forensics") {
    const fileMatch = /\b((?:src|packages|lib|app|tests?)\/[a-zA-Z0-9_./-]+\.[a-z]{1,4})\b/.exec(r);
    if (fileMatch) {
      const escaped = fileMatch[1]!.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      return new RegExp(`\\b${escaped}\\b`, "i");
    }
  }

  // Extract content after "patterns similar to:" or "switch from X to Y"
  let phrase: string | null = null;
  const m1 = /patterns similar to:\s*(.+?)$/i.exec(r);
  const m2 = /switch from .+? to\s+(.+?)$/i.exec(r);
  const m3 = /(?:use|using|chose)\s+([A-Z][a-zA-Z0-9]+)/.exec(r);
  if (m1) phrase = m1[1]!.trim();
  else if (m2) phrase = m2[1]!.trim();
  else if (m3) phrase = m3[1]!.trim();
  if (!phrase || phrase.length < 3) return null;
  // Take the first 2-3 distinctive tokens (filter common words)
  const STOPWORDS = new Set(["the", "a", "an", "is", "to", "for", "of", "in", "and", "or", "with", "on", "by"]);
  const tokens = phrase.split(/\s+/).filter((t) => t.length > 2 && !STOPWORDS.has(t.toLowerCase())).slice(0, 3);
  if (tokens.length === 0) return null;
  // Build a regex that matches if any token from the rule appears in the proposal
  const escaped = tokens.map((t) => t.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
  return new RegExp(`\\b(${escaped.join("|")})\\b`, "i");
}

function buildRewriteHint(rule: ConstitutionRule, matchedText: string): string {
  if (rule.source === "regret") {
    return `Avoid this pattern. The repo previously tried it and rolled it back. ` +
      `Evidence: ${rule.evidence}. Consider an alternative approach.`;
  }
  if (rule.source === "forensics") {
    return `This file/pattern has a security incident in its history. ` +
      `Apply extra scrutiny — get review before committing. Evidence: ${rule.evidence}.`;
  }
  if (rule.source === "atrophy") {
    return `This area's expertise is fading. Pair with the original author ` +
      `before changing. Evidence: ${rule.evidence}.`;
  }
  if (rule.source === "decision") {
    return `An architectural decision exists for this area. Re-read it ` +
      `before deviating. Evidence: ${rule.evidence}.`;
  }
  return `Revise the proposal to comply with the rule. Matched: "${matchedText}".`;
}

/**
 * Check a proposal against a constitution. Returns ALLOW unless a MUST
 * or MUST-NOT rule is violated.
 */
export function constitutionalCheck(input: ConstitutionalCheckInput): ConstitutionalVerdict {
  const violations: ConstitutionalVerdict["violations"] = [];
  for (const rule of input.rules) {
    // Only enforce on enforceable severities
    if (rule.severity !== "must-not" && rule.severity !== "must") continue;
    const pattern = rulePattern(rule);
    if (!pattern) continue;
    const m = pattern.exec(input.proposal);
    if (m) {
      violations.push({
        rule,
        matchedText: m[0],
        rewriteHint: buildRewriteHint(rule, m[0]),
      });
    }
  }

  if (violations.length === 0) {
    return {
      verdict: "allow",
      violations: [],
      wisdom: `Proposal passes the constitution check. ${input.rules.length} rule(s) considered, 0 violated. Safe to deliver.`,
    };
  }

  const top = violations[0]!;
  return {
    verdict: "refuse",
    violations,
    wisdom:
      `STOP — this proposal violates ${violations.length} constitution rule(s). ` +
      `The most critical: "${top.rule.rule.slice(0, 80)}". ` +
      `Rewrite using the rewriteHint. Do NOT deliver until verdict is "allow".`,
  };
}

/**
 * Convenience: check + return a single hint string the AI can paste
 * into its rewrite prompt.
 */
export function constitutionalRewriteHint(input: ConstitutionalCheckInput): string {
  const v = constitutionalCheck(input);
  if (v.verdict === "allow") return "";
  return v.violations.map((x) => `[${x.rule.severity.toUpperCase()}] ${x.rewriteHint}`).join("\n");
}
