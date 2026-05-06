/**
 * `decisions` — auto-extract architectural decisions (ADRs) from commit
 * history. The classic "we should write ADRs" never works in practice;
 * instead, extract them from the commit messages that *already exist*.
 *
 * The extractor is intentionally conservative — it triggers on a small set
 * of high-precision patterns ("decided to", "switched from X to Y",
 * "replaced X with Y", "deprecate X"). False positives are worse than
 * false negatives here: an ADR list with garbage erodes trust faster than
 * a thin one builds it.
 */

import type { Commit } from "../types.js";
import { isNoiseFile } from "../util/noise.js";

export interface ExtractedDecision {
  /** Commit hash where the decision was recorded. */
  commitHash: string;
  shortHash: string;
  date: string;
  author: string;
  /** A 1-line summary of the decision, drawn from the matched span. */
  summary: string;
  /** Optional rationale clause, when the message includes "because"/"so that". */
  rationale?: string;
  /** The pattern that fired — for transparency. */
  kind:
    | "decided-to"
    | "switched"
    | "replaced"
    | "deprecated"
    | "chose-over"
    | "instead-of"
    | "migrated"
    | "adopted"
    | "rejected";
  /** Confidence score in [0, 1]; calibrated from pattern specificity. */
  confidence: number;
  /** Files affected by the underlying commit (top 3, noise-filtered). Lets
   *  the reader jump directly to where the decision landed. */
  filesAffected?: string[];
}

interface Pattern {
  kind: ExtractedDecision["kind"];
  re: RegExp;
  confidence: number;
}

/**
 * Patterns ordered by specificity. The first matching pattern wins.
 * Each match exposes the decision text via the `text` group.
 */
const PATTERNS: Pattern[] = [
  // Highest specificity: explicit "decided to ..."
  { kind: "decided-to", re: /\b(?:we\s+)?decided\s+to\s+(?<text>[^.\n;]{8,200})/gi, confidence: 0.95 },

  // Switched / migrated FROM A TO B
  { kind: "switched", re: /\bswitch(?:ed)?\s+from\s+(?<from>[^.\n;]{2,80})\s+to\s+(?<text>[^.\n;]{2,120})/gi, confidence: 0.9 },
  { kind: "migrated", re: /\bmigrat(?:e|ed)\s+from\s+(?<from>[^.\n;]{2,80})\s+to\s+(?<text>[^.\n;]{2,120})/gi, confidence: 0.9 },

  // Replaced X with Y
  { kind: "replaced", re: /\breplaced?\s+(?<from>[^.\n;]{2,80})\s+with\s+(?<text>[^.\n;]{2,120})/gi, confidence: 0.85 },

  // Chose X over Y
  { kind: "chose-over", re: /\bch(?:ose|ooses?)\s+(?<text>[^.\n;]{2,80})\s+over\s+(?<from>[^.\n;]{2,80})/gi, confidence: 0.85 },

  // Use X instead of Y — text is lazy so it stops at "instead" instead of greedily eating it.
  { kind: "instead-of", re: /\b(?:use|using|used)\s+(?<text>\S[^.\n;]*?)\s+instead\s+of\s+(?<from>[^.\n;]{2,80})/gi, confidence: 0.8 },

  // Adopted X
  { kind: "adopted", re: /\b(?:we\s+)?adopt(?:ed|ing)?\s+(?<text>[^.\n;]{4,120})/gi, confidence: 0.65 },

  // Deprecated X / Deprecate X
  { kind: "deprecated", re: /\bdeprecat(?:e|ed|ing)\s+(?<text>[^.\n;]{2,120})/gi, confidence: 0.75 },

  // Rejected (the opposite — a decision NOT to do something)
  { kind: "rejected", re: /\b(?:we\s+)?reject(?:ed|ing)?\s+(?<text>[^.\n;]{4,120})/gi, confidence: 0.6 },
];

const RATIONALE_RE = /\b(?:because|so\s+that|in\s+order\s+to|due\s+to)\s+(?<rationale>[^.\n;]{4,200})/i;

/**
 * Extract every decision in a single commit's text (subject + body + PR
 * title + PR body). Returns 0..N decisions; one commit can record several.
 */
export function extractDecisions(commit: Commit): ExtractedDecision[] {
  const fullText = [commit.subject, commit.body, commit.prTitle, commit.prBody]
    .filter(Boolean)
    .join("\n");
  if (!fullText) return [];

  const found: ExtractedDecision[] = [];
  const seen = new Set<string>(); // dedupe by summary text

  for (const p of PATTERNS) {
    // Re-create regex per call to reset lastIndex.
    const re = new RegExp(p.re.source, p.re.flags);
    let m: RegExpExecArray | null;
    while ((m = re.exec(fullText)) !== null) {
      const text = (m.groups?.text ?? "").trim();
      const from = (m.groups?.from ?? "").trim();
      // Min 2 chars — code identifiers like "Go", "DB", "JS", "Map" are real.
      if (!text || text.length < 2) continue;
      const summary = buildSummary(p.kind, text, from);
      if (seen.has(summary.toLowerCase())) continue;
      seen.add(summary.toLowerCase());

      // Look for a rationale within ~120 chars after the match.
      const tail = fullText.slice(m.index, m.index + m[0].length + 200);
      const ratMatch = RATIONALE_RE.exec(tail);
      const rationale = ratMatch?.groups?.rationale?.trim();

      const filesAffected = (commit.files ?? [])
        .filter((f) => !isNoiseFile(f))
        .slice(0, 3);
      found.push({
        commitHash: commit.hash,
        shortHash: commit.shortHash || commit.hash.slice(0, 7),
        date: commit.authorDate.slice(0, 10),
        author: commit.authorName,
        summary,
        rationale: rationale || undefined,
        kind: p.kind,
        confidence: p.confidence,
        filesAffected,
      });
    }
  }

  return found;
}

function buildSummary(kind: ExtractedDecision["kind"], text: string, from: string): string {
  const t = text.replace(/\s+/g, " ").replace(/^[,:\s]+|[,:\s]+$/g, "");
  const f = from.replace(/\s+/g, " ").replace(/^[,:\s]+|[,:\s]+$/g, "");
  switch (kind) {
    case "decided-to":
      return `decided to ${t}`;
    case "switched":
      return `switched from ${f} to ${t}`;
    case "migrated":
      return `migrated from ${f} to ${t}`;
    case "replaced":
      return `replaced ${f} with ${t}`;
    case "chose-over":
      return `chose ${t} over ${f}`;
    case "instead-of":
      return `using ${t} instead of ${f}`;
    case "adopted":
      return `adopted ${t}`;
    case "deprecated":
      return `deprecated ${t}`;
    case "rejected":
      return `rejected ${t}`;
  }
}

/**
 * Render a list of decisions as a Markdown table. Useful for
 * `mneme decisions --format markdown > docs/ADR.md`.
 */
export function renderDecisionsAsMarkdown(decisions: ExtractedDecision[]): string {
  if (decisions.length === 0) {
    return "# Architecture Decisions\n\n(no decisions extracted — try richer commit messages)\n";
  }
  const lines: string[] = [];
  lines.push("# Architecture Decisions (auto-extracted)");
  lines.push("");
  lines.push("| Date | Author | Decision | Rationale | Source |");
  lines.push("|---|---|---|---|---|");
  for (const d of decisions) {
    const decision = d.summary.replace(/\|/g, "\\|");
    const rationale = (d.rationale ?? "").replace(/\|/g, "\\|");
    const files = (d.filesAffected ?? []).join(", ");
    // Inline files into the Source cell so the Markdown table column
    // structure stays compatible with anyone post-processing it.
    const source = files
      ? `\`${d.shortHash}\` <br/>files: ${files.replace(/\|/g, "\\|")}`
      : `\`${d.shortHash}\``;
    lines.push(`| ${d.date} | ${d.author} | ${decision} | ${rationale} | ${source} |`);
  }
  lines.push("");
  return lines.join("\n");
}
