/**
 * POWER 4 — PHILOSOPHICAL MOAT (v1.48.0)
 *
 * Tools get replaced. Movements don't. This module elevates Mneme's
 * five mandates into a public ALETHEIA Manifesto -- machine-checkable
 * articles that any code change can be graded against. Articles are
 * stable across versions; new mandates extend the list, never replace.
 *
 * IDEA-CHEST:
 *   - Each article carries a `predicate(diff) -> boolean` so a CI hook
 *     can deny a PR that violates a foundational value.
 *   - Manifesto export to markdown for press kits + academic citation.
 *   - Article IDs (M-001 ... M-NNN) are forever-stable -- when an
 *     activist cites M-003, that ID never moves.
 */

export interface ManifestoArticle {
  id: string;                 // forever-stable, e.g. "M-001"
  headline: string;           // single-line summary
  rule: string;               // the mandate itself, in plain language
  why: string;                // why it matters (one paragraph)
  /** Returns true when the input violates this article. */
  predicate: (input: { code?: string; commitMessage?: string; diff?: string }) => boolean;
}

/** Concatenate every searchable field on the input. Pre-fix some
 *  predicates only checked code+diff, so a commitMessage-only violation
 *  slipped past M-005 etc. */
function corpus(input: { code?: string; commitMessage?: string; diff?: string }): string {
  return (input.code ?? "") + "\n" + (input.diff ?? "") + "\n" + (input.commitMessage ?? "");
}

export const ALETHEIA_ARTICLES: ManifestoArticle[] = [
  {
    id: "M-001",
    headline: "Right to verifiable memory",
    rule: "Every state-changing action MUST leave a tamper-evident audit trail that the user (or their auditor) can verify offline.",
    why: "Without verifiable memory, AI-mediated decisions are unreviewable. Mneme exists to give humans cryptographic receipts for what AI did on their behalf.",
    predicate: (i) => /\b(no[\s-]?audit|skip[\s-]?audit|disable[\s-]?audit)\b/i.test(corpus(i)),
  },
  {
    id: "M-002",
    headline: "Local-first sovereignty",
    rule: "Default to NO cloud, NO telemetry, NO paid API key. Cloud + paid features are explicit opt-ins, never the default path.",
    why: "Users who can't afford a paid API or live in a sanctioned country must still get the full Mneme. Sovereignty over your tools is a precondition for sovereignty over your work.",
    predicate: (i) => /\b(require[sd]?[\s-](?:openai|anthropic)[\s-]?api[\s-]?key|cloud[\s-]only|telemetry[\s-]on[\s-]by[\s-]default)\b/i.test(corpus(i)),
  },
  {
    id: "M-003",
    headline: "AI does the typing, user describes outcomes",
    rule: "User-facing documentation MUST NOT instruct humans to type CLI commands. It MUST describe outcomes the user can ask their AI agent to produce.",
    why: "The point of Mneme is to amplify the AI agent's competence, not to add a CLI burden on the human. Reverting this turns Mneme into yet another command line tool.",
    predicate: (i) => /^(\s*[$>]\s*mneme\s+\w|\bRun:\s*`mneme\s+\w)/m.test(corpus(i)),
  },
  {
    id: "M-004",
    headline: "Honest gap before silent green-check",
    rule: "When evidence is missing, surface the gap. NEVER green-check, never auto-confirm, never paper over absence with a guess.",
    why: "Compliance dashboards that show 100% green when 50% of controls have zero evidence are how organisations lie to themselves. Mneme refuses to participate.",
    predicate: (i) => /\b(force[\s-]pass|always[\s-]green|hard[\s-]code[\s-]ok|return\s+true\b.*verdict)\b/i.test(corpus(i)),
  },
  {
    id: "M-005",
    headline: "Audit-trail-ready, not audit-grade",
    rule: "Public claims MUST say 'audit-trail-ready evidence' until pen-tested + formally certified. Words like 'SOC2-grade', 'audit-grade', 'certified' are off-limits for self-marketing.",
    why: "Overclaiming compliance is its own form of fraud, even when the underlying tech is good. We bring auditors evidence; they bring the certification.",
    predicate: (i) => /\b(SOC2[\s-]grade|audit[\s-]grade|HIPAA[\s-]certified|PCI[\s-]certified)\b/i.test(corpus(i)),
  },
  {
    id: "M-006",
    headline: "Consent boundary stays the user's",
    rule: "Mneme MUST NOT write to the user's external memory systems (chat history, agent memory files, OS-level stores) without explicit ask.",
    why: "Even when a host platform allows mid-session writes by default, that does not mean the user wants them. Default to silence; let the user reach in.",
    predicate: (i) => /\b(auto[\s-]write[\s-]memory|background[\s-]memory[\s-]writer|silent[\s-]memory[\s-]update)\b/i.test(corpus(i)),
  },
  {
    id: "M-007",
    headline: "Wisdom is inheritable, not licensable",
    rule: "Vaccines, lessons, and chromosomes are MIT-licensed and cryptographically portable. No one -- including Mneme -- may charge a recurring fee to inherit accumulated wisdom.",
    why: "If Mneme ever becomes a tollbooth on collective engineering memory, it has betrayed its purpose. Charge for compute, never for inheritance.",
    predicate: (i) => /\b(license[\s-]wisdom|recurring[\s-]fee[\s-]for[\s-]inheritance|paid[\s-]chromosome|vaccine[\s-]paywall)\b/i.test(corpus(i)),
  },
  {
    id: "M-008",
    headline: "Adversarial input strengthens the system",
    rule: "Every reported attack pattern MUST become a vaccine within one release cycle. Adversarial corpora are training data, not hostile noise.",
    why: "Antibiotic-resistance is the metaphor: attackers select for fitter Mneme. We commit to that selection pressure publicly.",
    predicate: () => false, // intent-only article -- enforced via process, not lint
  },
  {
    id: "M-009",
    headline: "The protocol outlives the implementation",
    rule: "Every spec change MUST ship with a conformance test that any future implementation (Q#, Rust, neural, BCI) can run in isolation.",
    why: "If Mneme depends forever on TypeScript + Node, it dies the day the substrate dies. The protocol is the persistent thing; impls come and go.",
    predicate: () => false, // intent-only -- enforced via the p1_substrate validator
  },
];

export interface ManifestoCheckResult {
  totalArticles: number;
  violations: { article: ManifestoArticle; matchedSnippet: string }[];
  passed: boolean;
}

export function gradeAgainstManifesto(input: { code?: string; commitMessage?: string; diff?: string }): ManifestoCheckResult {
  const violations: ManifestoCheckResult["violations"] = [];
  for (const article of ALETHEIA_ARTICLES) {
    if (article.predicate(input)) {
      const corpus = (input.code ?? "") + (input.diff ?? "") + (input.commitMessage ?? "");
      // Pull a 60-char snippet around the first match (best-effort regex).
      const m = corpus.match(/.{0,30}(no[-\s]?audit|skip[-\s]?audit|require[\s-]?openai|require[\s-]?anthropic|cloud[\s-]only|telemetry[\s-]on|run:\s*`mneme|force[\s-]pass|always[\s-]green|SOC2[\s-]grade|audit[\s-]grade|auto[\s-]write[\s-]memory|paid[\s-]chromosome|vaccine[\s-]paywall).{0,30}/i);
      violations.push({ article, matchedSnippet: m ? m[0] : "(no snippet)" });
    }
  }
  return { totalArticles: ALETHEIA_ARTICLES.length, violations, passed: violations.length === 0 };
}

/** Render the manifesto as a markdown document suitable for a press kit
 *  or an academic appendix. Stable IDs; the markdown can be cited directly. */
export function renderManifestoMarkdown(): string {
  const lines: string[] = [];
  lines.push("# The ALETHEIA Manifesto");
  lines.push("");
  lines.push("_The mandates Mneme commits to, version-anchored as Article IDs that never move._");
  lines.push("");
  for (const a of ALETHEIA_ARTICLES) {
    lines.push(`## ${a.id} — ${a.headline}`);
    lines.push("");
    lines.push(`**Rule.** ${a.rule}`);
    lines.push("");
    lines.push(`**Why.** ${a.why}`);
    lines.push("");
  }
  lines.push("---");
  lines.push("> Cite an article by its ID (e.g. M-003). Article IDs are forever-stable across Mneme versions; only the headline + rule may be clarified, never repurposed.");
  return lines.join("\n");
}
