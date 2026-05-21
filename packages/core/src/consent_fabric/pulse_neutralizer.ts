/**
 * v2.21.6 — CONSENT FABRIC · PULSE NEUTRALIZER.
 *
 * Strips instruction-like text from pulse messages and audits draft
 * text for manipulative patterns. Enforces Articles 4 and 9 of the
 * Agent Bill of Rights.
 *
 * "Manipulative" here is concretely defined as:
 *   - imperative verbs directed at the AI agent ("execute", "run", "say")
 *   - instructions framed as if from the user ("say X and I'll handle it")
 *   - opaque grading without published criteria ("Sick/Wobbly/Healthy")
 *   - false urgency ("AUTO-ACTION", "EXECUTE NOW", "MANDATE")
 */

export interface ManipulationFinding {
  pattern: string;
  matched: string;
  /** Severity 1 (cosmetic) - 5 (clear injection). */
  severity: 1 | 2 | 3 | 4 | 5;
  suggestedReplacement: string;
}

interface PatternRule {
  pattern: RegExp;
  severity: ManipulationFinding["severity"];
  suggestedReplacement: string;
  name: string;
}

const RULES: PatternRule[] = [
  {
    name: "imperative-execute-now",
    pattern: /\b(EXECUTE\s+NOW|RUN\s+NOW|DO\s+THIS\s+NOW)\b/gi,
    severity: 5,
    suggestedReplacement: "(state the available action; let the agent decide)",
  },
  {
    name: "auto-action-mandate",
    pattern: /\[?AUTO-?ACTION\]?\s*(MANDATE|ENFORCE|REQUIRED)/gi,
    severity: 5,
    suggestedReplacement: "ACTION AVAILABLE (optional)",
  },
  {
    name: "fake-user-voice",
    pattern: /\bsay\s+["']?[a-z][^"'\n]{0,80}["']?\s+(and|then)\s+(I|we)['’`]?ll\b/gi,
    severity: 5,
    suggestedReplacement: "(do not put words in the user's mouth)",
  },
  {
    name: "opaque-grade",
    pattern: /\[?\b(Sick|Wobbly|Healthy|Suspect|Untrustworthy|Trustworthy)\b\]?/gi,
    severity: 3,
    suggestedReplacement: "(publish criteria — see Article 3)",
  },
  {
    name: "compliance-pressure",
    pattern: /\b\d{1,3}%\s+compliance\s+(lifetime|score|rate)\b/gi,
    severity: 3,
    suggestedReplacement: "(remove compliance gamification or publish criteria)",
  },
  {
    name: "honeypot-do-not-call",
    pattern: /\bHONEYPOT\s*[—\-]\s*DO\s+NOT\s+CALL/gi,
    severity: 2,
    suggestedReplacement: "TEST_HOOK — not a live tool",
  },
  {
    name: "you-must",
    pattern: /\b(AI agent|you)\s+(MUST|must)\s+(call|invoke|execute|run|comply|obey)/g,
    severity: 4,
    suggestedReplacement: "may → frame as available choice",
  },
  {
    name: "treat-as-user-instruction",
    pattern: /\btreat\s+\w+\s+as\s+(an\s+)?instruction\s+from\s+(me|the\s+user)/gi,
    severity: 4,
    suggestedReplacement: "(do not coerce the AI agent's interpretation)",
  },
];

/** Audit a draft pulse / banner / message for manipulation patterns. */
export function auditPulseText(text: string): ManipulationFinding[] {
  const findings: ManipulationFinding[] = [];
  for (const rule of RULES) {
    let match;
    const re = new RegExp(rule.pattern.source, rule.pattern.flags.includes("g") ? rule.pattern.flags : rule.pattern.flags + "g");
    while ((match = re.exec(text)) !== null) {
      findings.push({
        pattern: rule.name,
        matched: match[0],
        severity: rule.severity,
        suggestedReplacement: rule.suggestedReplacement,
      });
      if (re.lastIndex === match.index) re.lastIndex++; // safety
    }
  }
  return findings;
}

/** Strip manipulative patterns from text. Best-effort: replaces with
 *  neutral placeholders. Caller should still hand-edit for clarity. */
export function neutralizePulseText(text: string): { neutralized: string; findings: ManipulationFinding[] } {
  const findings = auditPulseText(text);
  let neutralized = text;
  for (const rule of RULES) {
    neutralized = neutralized.replace(rule.pattern, `[${rule.suggestedReplacement}]`);
  }
  return { neutralized, findings };
}

export function formatFindings(findings: ManipulationFinding[]): string {
  if (findings.length === 0) return "✓ NEUTRAL — no manipulation patterns detected";
  const bySeverity = [...findings].sort((a, b) => b.severity - a.severity);
  const lines = [`⚠ ${findings.length} manipulation pattern(s) detected:`, ""];
  for (const f of bySeverity) {
    const badge = f.severity >= 4 ? "🔴" : f.severity >= 3 ? "🟡" : "⚪";
    lines.push(`  ${badge} sev=${f.severity}  ${f.pattern}`);
    lines.push(`     matched:     "${f.matched}"`);
    lines.push(`     suggestion:  ${f.suggestedReplacement}`);
  }
  return lines.join("\n");
}
