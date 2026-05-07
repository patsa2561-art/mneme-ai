/**
 * Render helpers for `mneme ask` — now routed through Iris.
 *
 * The top-level `renderAnswer` builds a structured `PyramidInput` and lets
 * the journalist engine handle wrapping, ordering, and the 30-second
 * contract.  Every helper below stays exported for backwards compat —
 * tests + callers in core/insights still reference them.
 *
 * Pure functions; no I/O.
 */

import kleur from "kleur";
import { insights } from "@mneme-ai/core";
import type { SearchResult, RepoMeta, retrieve } from "@mneme-ai/core";
import {
  iris,
  renderCommit as irisRenderCommit,
  type PyramidSection,
} from "./iris/index.js";

type ConfidenceLabel = retrieve.ConfidenceLabel;
type SynthesizedAnswer = retrieve.SynthesizedAnswer;

/** OSC 8 hyperlink — clickable in iTerm2, Wezterm, Windows Terminal, VSCode terminal.
 *  Falls back gracefully on dumb terminals (link text shows; URL is dropped). */
export function osc8(url: string | undefined, text: string): string {
  if (!url) return text;
  // Only emit OSC 8 on TTY — piped output gets plain text.
  if (!process.stdout.isTTY) return text;
  return `\x1b]8;;${url}\x1b\\${text}\x1b]8;;\x1b\\`;
}

/** Confidence → colored emoji + label. */
/**
 * Render a trust score 0..1 as a colored badge.
 *   ≥ 0.85  → green TRUST 95%
 *   ≥ 0.6   → cyan TRUST 70%
 *   ≥ 0.3   → yellow TRUST 40%
 *   else    → red TRUST 0%
 */
export function trustBadge(score: number): string {
  const pct = Math.round(score * 100);
  const label = `TRUST ${pct}%`;
  if (score >= 0.85) return `${kleur.green("◉")} ${kleur.green().bold(label)}`;
  if (score >= 0.6) return `${kleur.cyan("◉")} ${kleur.cyan().bold(label)}`;
  if (score >= 0.3) return `${kleur.yellow("◉")} ${kleur.yellow().bold(label)}`;
  return `${kleur.red("◉")} ${kleur.red().bold(label)}`;
}

export function confidenceBadge(c: ConfidenceLabel): string {
  switch (c) {
    case "high":
      return `${kleur.green("●")} ${kleur.green().bold("HIGH CONFIDENCE")}`;
    case "medium":
      return `${kleur.yellow("●")} ${kleur.yellow().bold("MEDIUM CONFIDENCE")}`;
    case "low":
      return `${kleur.red("●")} ${kleur.red().bold("LOW CONFIDENCE — verify")}`;
    case "none":
      return `${kleur.gray("○")} ${kleur.gray().bold("NO CONTEXT FOUND")}`;
  }
}

/** Cluster file paths by their top-level module/folder. */
export function clusterFiles(files: string[]): Array<{ name: string; count: number; sample: string[] }> {
  const groups = new Map<string, string[]>();
  for (const f of files) {
    const parts = f.split("/");
    // First two segments capture "src/payment", "tests/eval", etc.
    const key = parts.length >= 2 ? `${parts[0]}/${parts[1]}` : (parts[0] ?? "(root)");
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push(f);
  }
  return [...groups.entries()]
    .map(([name, list]) => ({ name, count: list.length, sample: list.slice(0, 2) }))
    .sort((a, b) => b.count - a.count);
}

/** GitHub/GitLab/Bitbucket URL builder for a commit. Returns undefined if unhostable. */
export function commitUrl(hash: string, repo?: RepoMeta): string | undefined {
  if (!repo?.owner || !repo.repo) return undefined;
  if (repo.host === "github") return `https://github.com/${repo.owner}/${repo.repo}/commit/${hash}`;
  if (repo.host === "gitlab") return `https://gitlab.com/${repo.owner}/${repo.repo}/-/commit/${hash}`;
  if (repo.host === "bitbucket") return `https://bitbucket.org/${repo.owner}/${repo.repo}/commits/${hash}`;
  return undefined;
}

/** Render a single evidence row (legacy helper — kept for downstream consumers). */
export function renderEvidence(r: SearchResult, repo?: RepoMeta): string[] {
  const c = r.commit;
  const date = c.authorDate.slice(0, 10);
  const ref = c.prNumber ? `PR #${c.prNumber}` : c.shortHash;
  const score = r.score.toFixed(3);
  const url = commitUrl(c.hash, repo);
  const refLink = osc8(url, kleur.bold(ref));
  const lines: string[] = [];
  lines.push(`  ${kleur.green("●")} ${refLink}  ${kleur.gray(`[${date} · ${c.authorName} · ${score}]`)}`);
  lines.push(`    ${kleur.white(c.subject)}`);
  if (c.body) {
    const firstLine = c.body.split("\n")[0]!.trim();
    if (firstLine && firstLine !== c.subject) {
      lines.push(`    ${kleur.gray(truncate(firstLine, 110))}`);
    }
  }
  return lines;
}

/** Top-level renderer — the "answer card" the user sees. */
export interface AskRenderInput {
  question: string;
  synthesized: SynthesizedAnswer;
  results: SearchResult[];
  repo?: RepoMeta;
  feedbackId?: string;
  /** Pre-built headline (Iris pillar 2). When omitted, an extractive one is used. */
  headline?: string;
}

/**
 * Build the structured pyramid input for `mneme ask` — separated so the
 * caller can either render directly via Iris or inspect the structure in
 * tests.
 */
export function buildAskPyramid(input: AskRenderInput): {
  headline: string;
  sections: PyramidSection[];
  whyShown: string;
} {
  const { question, synthesized, results, repo, feedbackId } = input;

  // ── Headline (lede stand-in) — short, scannable.
  const ev = synthesized.evidenceCommitHashes.length;
  const headline =
    input.headline ??
    `Q: ${truncate(question, 60)} — ${synthesized.confidence} confidence, ${ev} citation${ev === 1 ? "" : "s"}`;

  const sections: PyramidSection[] = [];

  // ── Lede: confidence badge, trust score, then the answer prose.
  const ledeLines: string[] = [];
  ledeLines.push(`  ${kleur.bold().cyan("Q")}  ${kleur.bold(question)}`);
  ledeLines.push("");
  ledeLines.push(
    `  ${confidenceBadge(synthesized.confidence)}  ${trustBadge(synthesized.trustScore)}`,
  );
  ledeLines.push(`  ${kleur.gray(humanizeTrustScore(synthesized.trustScore))}`);
  if (synthesized.source === "llm") {
    ledeLines.push(`  ${kleur.gray(`synthesized in ${synthesized.durationMs}ms`)}`);
  }
  if (synthesized.source === "audit-refused") {
    ledeLines.push(`  ${kleur.red().bold("⊘ AUDIT REFUSED")}`);
    ledeLines.push(
      `  ${kleur.gray("Mneme is in audit mode and the evidence wasn't strong enough to answer safely.")}`,
    );
    ledeLines.push(
      `  ${kleur.gray("Refusing here is a feature — it prevents an unverifiable answer from leaking into a CI gate or another agent.")}`,
    );
    ledeLines.push(
      `  ${kleur.gray("Try again without")} ${kleur.bold("--audit")} ${kleur.gray("to see the best-effort answer with full evidence.")}`,
    );
  }
  if (
    synthesized.unverifiedCitations &&
    synthesized.unverifiedCitations.length > 0 &&
    synthesized.source !== "audit-refused"
  ) {
    const list = synthesized.unverifiedCitations.slice(0, 3).join(", ");
    ledeLines.push(
      `  ${kleur.yellow().bold("⚠ HALLUCINATION RISK")}  ${kleur.gray(`cited ${synthesized.unverifiedCitations.length} hash(es) not in evidence: ${list}${synthesized.unverifiedCitations.length > 3 ? "…" : ""}`)}`,
    );
    ledeLines.push(`  ${kleur.gray("→ re-run with --audit to refuse on unverified citations")}`);
  }
  ledeLines.push("");
  // The answer paragraph (already humanly-readable). Iris wrap-aware.
  for (const para of synthesized.answer.split(/\n\n+/)) {
    for (const line of para.split("\n")) ledeLines.push(`    ${line}`);
    ledeLines.push("");
  }
  sections.push({ tier: "lede", title: "✦ Answer", lines: ledeLines });

  // ── No-context case: stop here. Evidence/Files/Try-next are all empty.
  if (synthesized.confidence !== "none" && results.length > 0) {
    // ── Key-facts: top-3 evidence cards.
    const evidenceLines: string[] = [];
    for (const r of results.slice(0, 3)) {
      const url = commitUrl(r.commit.hash, repo);
      evidenceLines.push(
        irisRenderCommit(
          {
            hash: r.commit.hash,
            shortHash: r.commit.shortHash,
            subject: r.commit.subject,
            authorName: r.commit.authorName,
            authorDate: r.commit.authorDate,
          },
          { emphasized: true, url },
        ),
      );
      evidenceLines.push(`    ${kleur.gray(`score ${r.score.toFixed(3)}`)}`);
      evidenceLines.push("");
    }
    sections.push({
      tier: "key-facts",
      title: `◆ Evidence  ${kleur.gray(`(showing ${Math.min(3, results.length)} of ${results.length})`)}`,
      lines: evidenceLines,
    });

    // ── Body: file clusters.
    const allFiles = unique(results.slice(0, 3).flatMap((r) => r.commit.files ?? []));
    if (allFiles.length > 0) {
      const clusters = clusterFiles(allFiles).slice(0, 5);
      const fileLines: string[] = [];
      for (const c of clusters) {
        fileLines.push(
          `    ${kleur.cyan(c.name.padEnd(22))} ${kleur.gray(`(${c.count})`)}  ${kleur.gray(c.sample.join(", "))}`,
        );
      }
      sections.push({
        tier: "body",
        title: `⊕ Files  ${kleur.gray(`(${allFiles.length} unique)`)}`,
        lines: fileLines,
      });
    }

    // ── Details: remaining evidence beyond top-3 (collapsed).
    if (results.length > 3) {
      const moreLines: string[] = [];
      for (const r of results.slice(3)) {
        const url = commitUrl(r.commit.hash, repo);
        moreLines.push(
          irisRenderCommit(
            {
              hash: r.commit.hash,
              shortHash: r.commit.shortHash,
              subject: r.commit.subject,
              authorName: r.commit.authorName,
              authorDate: r.commit.authorDate,
            },
            { compact: true, url },
          ),
        );
      }
      sections.push({
        tier: "details",
        title: "All evidence",
        lines: moreLines,
      });
    }

    // ── Sources: smart "try next" + feedback CTA.
    const suggestions = insights.suggestFollowUps(question, results);
    const trySources: string[] = [];
    for (const s of suggestions) {
      trySources.push(`    ${kleur.cyan("$")} ${kleur.bold(s.command)}`);
      trySources.push(`      ${kleur.gray(s.reason)}`);
    }
    if (feedbackId) {
      const id8 = feedbackId.slice(0, 8);
      trySources.push("");
      trySources.push(
        `    ${kleur.gray("Was this useful?")}  ${kleur.bold("mneme feedback")} ${kleur.cyan(id8)} ${kleur.green("up")}${kleur.gray(" | ")}${kleur.red("down")}`,
      );
    }
    if (trySources.length > 0) {
      sections.push({ tier: "sources", title: "→ Try next", lines: trySources });
    }
  }

  const whyShown = `Because the question matched ${synthesized.confidence} confidence retrieval`;
  return { headline, sections, whyShown };
}

/** Render the answer using Iris (the journalist engine). */
export function renderAnswer(input: AskRenderInput): string {
  const { headline, sections, whyShown } = buildAskPyramid(input);
  return iris.render({ headline, sections, whyShown });
}

/** Pure helpers used above and tested directly. */

/** Translate a 0..1 trust score into a one-line plain-English explanation. */
export function humanizeTrustScore(score: number): string {
  const pct = Math.round(score * 100);
  if (score >= 0.85) {
    return `Mneme has ${pct}% confidence the answer is grounded in the evidence below — safe to act on.`;
  }
  if (score >= 0.6) {
    return `Mneme has ${pct}% confidence the answer is grounded in the evidence below — usually reliable, double-check the citations.`;
  }
  if (score >= 0.5) {
    return `Mneme has ${pct}% confidence — borderline. Read the cited commits before acting on this.`;
  }
  if (score >= 0.3) {
    return `Mneme has only ${pct}% confidence — treat the answer as a hint, not a fact.`;
  }
  return `Mneme has ${pct}% confidence — too low to trust. The evidence below is what was actually found; ignore the synthesized answer if it doesn't match.`;
}

export function truncate(s: string, n: number): string {
  if (s.length <= n) return s;
  return `${s.slice(0, n - 1)}…`;
}

export function unique<T>(arr: T[]): T[] {
  return [...new Set(arr)];
}

/** Word-wrap that preserves paragraph breaks; prefixes every line with `indent`. */
export function wrapText(text: string, width: number, indent = ""): string[] {
  const out: string[] = [];
  for (const para of text.split(/\n\n+/)) {
    const words = para.replace(/\n/g, " ").split(/\s+/).filter(Boolean);
    let line = indent;
    for (const w of words) {
      if (line.length + w.length + 1 > width && line.trim().length > 0) {
        out.push(line);
        line = indent + w;
      } else {
        line = line === indent ? line + w : `${line} ${w}`;
      }
    }
    if (line.trim()) out.push(line);
    out.push("");
  }
  if (out.length > 0 && out[out.length - 1] === "") out.pop();
  return out;
}
