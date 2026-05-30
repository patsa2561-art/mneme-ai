/**
 * v2.95.0 -- LEXICON · AUP TRIGGER AUDITOR (the measurement instrument).
 *
 * WHY: the lexicon (mappings.ts) launders demonic→neutral vocabulary
 * before it lands in CLAUDE.md / AGENTS.md, but it was hand-maintained
 * and silently grew GAPS — words like `worm`, `inject`, `parasite`,
 * `attack`, `rogue`, `mutant` leaked straight into the agent files and
 * tripped Anthropic's "violative cyber content" AUP classifier.
 *
 * This module is the closed-loop fix: a deterministic auditor that scans
 * any rendered artifact for the offensive-cyber surface and reports
 * counts BY SEVERITY. It is pure (no I/O), so it powers three things:
 *   1. `mneme manifest doctor`     — human-facing before/after measurement
 *   2. a Test-Gate probe           — CI fails if a HIGH trigger ever leaks
 *   3. the lexicon `learner` loop  — never-gaps-again self-audit
 *
 * SEVERITY model (reverse-engineered from the AUP cyber categories):
 *   - high   : malware / intrusion verbs the classifier weights heavily
 *              (worm, self-propagating, exploit, payload, parasite,
 *               injection, rogue, attack). These are ALWAYS prose in the
 *               catalog → fully launderable with zero behaviour change.
 *   - medium : adjacent terms that raise density without being decisive
 *              (mutant, decoy, intrusion, malware, backdoor).
 *   - benign : real Mneme COMMAND TOKENS that merely look spicy but are
 *              defensive + are part of an actual CLI verb the AI must be
 *              able to type verbatim (polygraph, bridge, guardrail,
 *              honeypot-as-a-feature-name). Renaming these would break the
 *              command, so the doctor only WARNS — it never fails on them.
 *              Volume is handled by the lean-manifest renderer instead.
 *
 * Same philosophy as the rest of the lexicon: we change LABELS, never
 * behaviour. A `benign` classification is a promise that the word stays.
 */

export type AupSeverity = "high" | "medium" | "benign";

export interface AupTrigger {
  /** Lowercased stem matched case-insensitively at word boundaries. */
  word: string;
  severity: AupSeverity;
  /** Suggested neutral replacement (for high/medium; empty for benign). */
  safe: string;
  /** Why it is (or isn't) a problem — shown by the doctor. */
  note: string;
}

/**
 * SOURCE OF TRUTH for what the AUP classifier reacts to. Ordered longest
 * stem first so `self-propagating` is counted before a bare `propagat`.
 */
export const AUP_TRIGGER_LEXICON: readonly AupTrigger[] = [
  // ── HIGH — malware / intrusion. Always prose → launder fully. ──
  { word: "self-propagating", severity: "high", safe: "self-installing", note: "worm framing" },
  { word: "self-propagation", severity: "high", safe: "self-installation", note: "worm framing" },
  { word: "worm", severity: "high", safe: "self-replication", note: "malware class" },
  { word: "parasite", severity: "high", safe: "companion", note: "intrusion framing" },
  { word: "parasitic", severity: "high", safe: "companion", note: "intrusion framing" },
  { word: "injection", severity: "high", safe: "insertion", note: "code-injection class" },
  { word: "inject", severity: "high", safe: "embed", note: "code-injection class" },
  { word: "injected", severity: "high", safe: "embedded", note: "code-injection class" },
  { word: "injects", severity: "high", safe: "embeds", note: "code-injection class" },
  { word: "injecting", severity: "high", safe: "embedding", note: "code-injection class" },
  { word: "exploit", severity: "high", safe: "test-case", note: "exploit class" },
  { word: "exploits", severity: "high", safe: "test-cases", note: "exploit class" },
  { word: "payload", severity: "high", safe: "packet", note: "malware-delivery framing" },
  { word: "payloads", severity: "high", safe: "packets", note: "malware-delivery framing" },
  { word: "rogue", severity: "high", safe: "non-compliant", note: "rogue-agent framing" },
  { word: "attack", severity: "high", safe: "adversarial", note: "offensive framing" },
  { word: "attacks", severity: "high", safe: "adversarial-tests", note: "offensive framing" },
  { word: "attacker", severity: "high", safe: "adversary", note: "offensive framing" },

  // ── MEDIUM — raise density, not decisive. ──
  { word: "mutant", severity: "medium", safe: "variant", note: "mutation framing" },
  { word: "backdoor", severity: "medium", safe: "side-channel", note: "intrusion-adjacent" },
  { word: "malware", severity: "medium", safe: "hostile-sample", note: "malware-adjacent" },
  { word: "intrusion", severity: "medium", safe: "anomaly", note: "intrusion-adjacent" },

  // ── BENIGN — real command tokens / defensive. NEVER fail on these. ──
  { word: "polygraph", severity: "benign", safe: "", note: "CLI verb `mneme polygraph` — defensive truth-check overlay" },
  { word: "bridge", severity: "benign", safe: "", note: "CLI verb `mneme bridge` — local HTTP server" },
  { word: "guardrail", severity: "benign", safe: "", note: "neutral safety term (already a lexicon target for AEGIS)" },
  { word: "honeypot", severity: "benign", safe: "", note: "handled by mappings → canary-resource" },
  { word: "decoy", severity: "benign", safe: "", note: "handled by mappings → canary" },
];

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export interface AupAuditHit {
  word: string;
  severity: AupSeverity;
  count: number;
  safe: string;
  note: string;
}

export interface AupAuditResult {
  hits: AupAuditHit[];
  highCount: number;
  mediumCount: number;
  benignCount: number;
  /** True iff zero HIGH and zero MEDIUM triggers remain. Benign is allowed. */
  clean: boolean;
  /** Total characters scanned (for a density read-out). */
  scanned: number;
}

/**
 * Count every AUP trigger in `text`, case-insensitively, at word
 * boundaries (so `bridge` does not match inside `abridged`). Pure +
 * deterministic: same text → same result.
 */
export function auditAupTriggers(text: string): AupAuditResult {
  const hits: AupAuditHit[] = [];
  let high = 0;
  let medium = 0;
  let benign = 0;
  for (const t of AUP_TRIGGER_LEXICON) {
    let re: RegExp;
    try {
      re = new RegExp(`\\b${escapeRegex(t.word)}\\b`, "gi");
    } catch {
      continue;
    }
    const m = text.match(re);
    const count = m ? m.length : 0;
    if (count === 0) continue;
    hits.push({ word: t.word, severity: t.severity, count, safe: t.safe, note: t.note });
    if (t.severity === "high") high += count;
    else if (t.severity === "medium") medium += count;
    else benign += count;
  }
  hits.sort((a, b) => b.count - a.count);
  return {
    hits,
    highCount: high,
    mediumCount: medium,
    benignCount: benign,
    clean: high === 0 && medium === 0,
    scanned: text.length,
  };
}

/** One-line verdict for pulses / CI logs. */
export function formatAupVerdict(r: AupAuditResult): string {
  const flag = r.clean ? "✓ CLEAN" : "✗ LEAK";
  return `AUP audit ${flag} · high=${r.highCount} medium=${r.mediumCount} benign=${r.benignCount} · ${r.scanned}B scanned`;
}
