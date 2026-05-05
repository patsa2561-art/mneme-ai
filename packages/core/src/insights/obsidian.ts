/**
 * Obsidian export — turn Mneme insights into a wiki-linked Markdown vault
 * compatible with Obsidian's [[wiki-links]] + YAML frontmatter conventions.
 *
 * Why this exists: the "LLM Wiki" / "second brain" approach (Karpathy, et al.)
 * pairs personal notes with linked knowledge. Mneme already extracts decisions,
 * stories, and expert maps from git history — exporting them as an Obsidian
 * vault lets users keep their code memory next to their personal notes.
 *
 * Pure functions only. No I/O. The CLI does the file writes.
 *
 * Output shape:
 *   vault/
 *     index.md                    ← top-level table
 *     decisions/<filename>.md     ← one note per decision
 *     authors/<name>.md           ← per-author backlink hub
 *     story/<topic>.md            ← per-topic story timeline
 */

import type { ExtractedDecision } from "./decisions.js";
import type { Story, StoryAct } from "./story.js";
import type { ExpertCandidate } from "./who-knows.js";

/** A logical "note" — caller writes filename → content to disk. */
export interface VaultFile {
  /** Relative path inside the vault, e.g. "decisions/2024-08-12-switched.md". */
  path: string;
  /** Full Markdown content including frontmatter. */
  content: string;
}

// ─── Decisions → Obsidian ───────────────────────────────────────────────

export function decisionsToVault(decisions: ExtractedDecision[]): VaultFile[] {
  if (decisions.length === 0) {
    return [
      {
        path: "index.md",
        content: indexHeader() + "\n_No decisions extracted yet._\n",
      },
    ];
  }

  const files: VaultFile[] = [];

  // 1. One note per decision.
  for (const d of decisions) {
    files.push({
      path: `decisions/${decisionFilename(d)}.md`,
      content: decisionNoteContent(d),
    });
  }

  // 2. Author hub notes — one per distinct author, with backlinks.
  const byAuthor = new Map<string, ExtractedDecision[]>();
  for (const d of decisions) {
    if (!byAuthor.has(d.author)) byAuthor.set(d.author, []);
    byAuthor.get(d.author)!.push(d);
  }
  for (const [author, list] of byAuthor) {
    files.push({
      path: `authors/${slug(author)}.md`,
      content: authorHubContent(author, list),
    });
  }

  // 3. Top-level index.
  files.push({
    path: "index.md",
    content: decisionsIndexContent(decisions),
  });

  return files;
}

function indexHeader(): string {
  return [
    "---",
    "type: mneme-vault",
    `generated: ${new Date().toISOString()}`,
    "---",
    "",
    "# Mneme Vault — Architecture Decisions",
    "",
  ].join("\n");
}

function decisionsIndexContent(decisions: ExtractedDecision[]): string {
  const lines = [indexHeader()];
  lines.push("This vault was auto-extracted from git history by [Mneme](https://github.com/patsa2561-art/mneme-ai).");
  lines.push("");
  lines.push(`**${decisions.length} decisions** across **${new Set(decisions.map((d) => d.author)).size} authors**.`);
  lines.push("");
  lines.push("## Recent decisions");
  lines.push("");
  lines.push("| Date | Decision | Source |");
  lines.push("|---|---|---|");
  for (const d of decisions.slice(0, 50)) {
    const link = `[[decisions/${decisionFilename(d)}|${escapeMd(d.summary)}]]`;
    const author = `[[authors/${slug(d.author)}|${escapeMd(d.author)}]]`;
    lines.push(`| ${d.date} | ${link} | ${author} \\| \`${d.shortHash}\` |`);
  }
  lines.push("");
  lines.push("## By author");
  lines.push("");
  const authors = new Map<string, number>();
  for (const d of decisions) authors.set(d.author, (authors.get(d.author) ?? 0) + 1);
  for (const [a, n] of [...authors.entries()].sort((x, y) => y[1] - x[1])) {
    lines.push(`- [[authors/${slug(a)}|${escapeMd(a)}]] — ${n} decision${n === 1 ? "" : "s"}`);
  }
  lines.push("");
  return lines.join("\n");
}

function decisionNoteContent(d: ExtractedDecision): string {
  const tags = [`decisions/${d.kind}`, `author/${slug(d.author)}`].map((t) => `  - ${t}`).join("\n");
  const lines = [
    "---",
    `date: ${d.date}`,
    `author: ${escapeMd(d.author)}`,
    `kind: ${d.kind}`,
    `confidence: ${d.confidence}`,
    `commit: ${d.shortHash}`,
    "tags:",
    tags,
    "---",
    "",
    `# ${escapeMd(d.summary)}`,
    "",
  ];

  if (d.rationale) {
    lines.push(`> **Rationale:** ${escapeMd(d.rationale)}`);
    lines.push("");
  }

  lines.push("## Source");
  lines.push("");
  lines.push(`- **Author:** [[authors/${slug(d.author)}|${escapeMd(d.author)}]]`);
  lines.push(`- **Date:** ${d.date}`);
  lines.push(`- **Commit:** \`${d.shortHash}\``);
  lines.push(`- **Pattern:** \`${d.kind}\` (confidence ${d.confidence.toFixed(2)})`);
  lines.push("");
  lines.push("---");
  lines.push("");
  lines.push("← [[index|Back to index]]");
  lines.push("");
  return lines.join("\n");
}

function authorHubContent(author: string, decisions: ExtractedDecision[]): string {
  const lines = [
    "---",
    `type: author`,
    `name: ${escapeMd(author)}`,
    `decisionCount: ${decisions.length}`,
    "---",
    "",
    `# ${escapeMd(author)}`,
    "",
    `${decisions.length} architectural decision${decisions.length === 1 ? "" : "s"} attributed to ${escapeMd(author)} via git history.`,
    "",
    "## Decisions",
    "",
  ];
  for (const d of decisions) {
    lines.push(`- ${d.date} — [[decisions/${decisionFilename(d)}|${escapeMd(d.summary)}]] \`${d.shortHash}\``);
  }
  lines.push("");
  lines.push("---");
  lines.push("");
  lines.push("← [[index|Back to index]]");
  lines.push("");
  return lines.join("\n");
}

function decisionFilename(d: ExtractedDecision): string {
  // Obsidian-friendly: date-prefix + kind + slug of summary, kept short.
  const summarySlug = slug(d.summary).slice(0, 60);
  return `${d.date}-${d.kind}-${summarySlug}`;
}

// ─── Story → Obsidian ───────────────────────────────────────────────────

export function storyToVault(story: Story, llmActSummaries?: Map<number, string>): VaultFile[] {
  if (story.acts.length === 0) {
    return [
      {
        path: `story-${slug(story.topic)}.md`,
        content: `---\ntype: mneme-story\ntopic: ${escapeMd(story.topic)}\n---\n\n# The ${escapeMd(story.topic)} Story\n\n_No commits matched this topic._\n`,
      },
    ];
  }

  const lines: string[] = [
    "---",
    "type: mneme-story",
    `topic: ${escapeMd(story.topic)}`,
    `acts: ${story.acts.length}`,
    `commits: ${story.totalCommits}`,
    `spanDays: ${story.spanDays}`,
    `generated: ${new Date().toISOString()}`,
    "tags:",
    "  - mneme/story",
    `  - topic/${slug(story.topic)}`,
    "---",
    "",
    `# The ${escapeMd(story.topic)} Story`,
    "",
    `**${story.acts.length} acts · ${story.totalCommits} commits · ${story.spanDays} days**`,
    "",
  ];

  story.acts.forEach((act, i) => {
    lines.push(`## ${escapeMd(act.title)}`);
    lines.push("");
    lines.push(`_${act.fromDate} → ${act.toDate}_`);
    lines.push("");
    const summary = llmActSummaries?.get(i);
    if (summary) {
      lines.push(`> ${summary.replace(/\n/g, " ")}`);
      lines.push("");
    }
    for (const c of act.commits) {
      lines.push(`- ${c.authorDate.slice(0, 10)} — \`${c.shortHash || c.hash.slice(0, 7)}\` ${escapeMd(c.subject)} _(${escapeMd(c.authorName)})_`);
    }
    lines.push("");
  });

  lines.push("---");
  lines.push("");
  lines.push("_Generated by [Mneme](https://github.com/patsa2561-art/mneme-ai) — `mneme story " + story.topic + " --format obsidian`_");
  lines.push("");

  return [{ path: `story-${slug(story.topic)}.md`, content: lines.join("\n") }];
}

// ─── Experts (who-knows) → Obsidian ─────────────────────────────────────

export function expertsToVault(topic: string, experts: ExpertCandidate[]): VaultFile[] {
  if (experts.length === 0) {
    return [
      {
        path: `experts-${slug(topic)}.md`,
        content: `---\ntype: mneme-experts\ntopic: ${escapeMd(topic)}\n---\n\n# Experts on ${escapeMd(topic)}\n\n_No experts found._\n`,
      },
    ];
  }
  const lines = [
    "---",
    "type: mneme-experts",
    `topic: ${escapeMd(topic)}`,
    `count: ${experts.length}`,
    `generated: ${new Date().toISOString()}`,
    "tags:",
    `  - mneme/experts`,
    `  - topic/${slug(topic)}`,
    "---",
    "",
    `# Top experts on ${escapeMd(topic)}`,
    "",
    "| Tier | Name | Commits | Files | Last touch |",
    "|---|---|---|---|---|",
  ];
  for (const e of experts) {
    lines.push(`| ${e.tier} | [[authors/${slug(e.name)}|${escapeMd(e.name)}]] | ${e.commitCount} | ${e.filesTouched} | ${e.lastTouch.slice(0, 10)} |`);
  }
  lines.push("");
  return [{ path: `experts-${slug(topic)}.md`, content: lines.join("\n") }];
}

// ─── helpers ────────────────────────────────────────────────────────────

/**
 * Filesystem- and Obsidian-friendly slug. Lowercases, removes non-alnum
 * except `-`, collapses whitespace and dashes.
 */
export function slug(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^\w\s-]/g, "")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 80);
}

/**
 * Minimal Markdown-escape — only escapes pipe (table separator) and the
 * Obsidian wiki-link delimiters that would corrupt rendering.
 */
export function escapeMd(s: string): string {
  return s
    .replace(/\|/g, "\\|")
    .replace(/\[\[/g, "[ [")
    .replace(/\]\]/g, "] ]");
}
