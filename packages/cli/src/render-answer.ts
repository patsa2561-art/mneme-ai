/**
 * Render helpers for `mneme ask` — the "AI from the future" look.
 *
 * Pure functions; no I/O. The ask command composes these with side-effects.
 * Tested independently — see render-answer.test.ts.
 */

import kleur from "kleur";
import { insights } from "@mneme-ai/core";
import type { SearchResult, RepoMeta, retrieve } from "@mneme-ai/core";

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

/** Render a single evidence row. */
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
}

export function renderAnswer(input: AskRenderInput): string {
  const out: string[] = [];
  const { question, synthesized, results, repo, feedbackId } = input;

  // ── Header: question + confidence badge + trust score ────────────────
  out.push("");
  out.push(`  ${kleur.bold().cyan("Q")}  ${kleur.bold(question)}`);
  out.push("");
  out.push(`  ${confidenceBadge(synthesized.confidence)}  ${trustBadge(synthesized.trustScore)}`);
  if (synthesized.source === "llm") {
    out.push(`  ${kleur.gray(`synthesized in ${synthesized.durationMs}ms`)}`);
  }
  if (synthesized.source === "audit-refused") {
    out.push(`  ${kleur.red().bold("⊘ AUDIT REFUSED")}`);
  }
  // Hallucination warning: cited hashes not in evidence
  if (
    synthesized.unverifiedCitations &&
    synthesized.unverifiedCitations.length > 0 &&
    synthesized.source !== "audit-refused"
  ) {
    const list = synthesized.unverifiedCitations.slice(0, 3).join(", ");
    out.push(
      `  ${kleur.yellow().bold("⚠ HALLUCINATION RISK")}  ${kleur.gray(`cited ${synthesized.unverifiedCitations.length} hash(es) not in evidence: ${list}${synthesized.unverifiedCitations.length > 3 ? "…" : ""}`)}`,
    );
    out.push(`  ${kleur.gray("→ re-run with --audit to refuse on unverified citations")}`);
  }
  out.push("");

  // ── Answer section ───────────────────────────────────────────────────
  out.push(`  ${kleur.bold().magenta("✦ Answer")}`);
  out.push("");
  for (const line of wrapText(synthesized.answer, 92, "    ")) out.push(line);
  out.push("");

  // No-context case ends here.
  if (synthesized.confidence === "none" || results.length === 0) {
    out.push("");
    return out.join("\n");
  }

  // ── Evidence (top 3) ─────────────────────────────────────────────────
  out.push(`  ${kleur.bold().magenta("◆ Evidence")}  ${kleur.gray(`(showing ${Math.min(3, results.length)} of ${results.length})`)}`);
  out.push("");
  for (const r of results.slice(0, 3)) {
    for (const line of renderEvidence(r, repo)) out.push(line);
    out.push("");
  }

  // ── Files (clustered) ────────────────────────────────────────────────
  const allFiles = unique(results.slice(0, 3).flatMap((r) => r.commit.files ?? []));
  if (allFiles.length > 0) {
    const clusters = clusterFiles(allFiles).slice(0, 5);
    out.push(`  ${kleur.bold().magenta("⊕ Files")}  ${kleur.gray(`(${allFiles.length} unique)`)}`);
    for (const c of clusters) {
      out.push(`    ${kleur.cyan(c.name.padEnd(22))} ${kleur.gray(`(${c.count})`)}  ${kleur.gray(c.sample.join(", "))}`);
    }
    out.push("");
  }

  // ── Smart suggestions — what to run next ─────────────────────────────
  const suggestions = insights.suggestFollowUps(question, results);
  if (suggestions.length > 0) {
    out.push(`  ${kleur.bold().magenta("→ Try next")}`);
    for (const s of suggestions) {
      out.push(`    ${kleur.cyan("$")} ${kleur.bold(s.command)}`);
      out.push(`      ${kleur.gray(s.reason)}`);
    }
    out.push("");
  }

  // ── Feedback CTA ─────────────────────────────────────────────────────
  if (feedbackId) {
    const id8 = feedbackId.slice(0, 8);
    out.push(
      `  ${kleur.gray("Was this useful?")}  ${kleur.bold("mneme feedback")} ${kleur.cyan(id8)} ${kleur.green("up")}${kleur.gray(" | ")}${kleur.red("down")}`,
    );
    out.push("");
  }

  return out.join("\n");
}

/** Pure helpers used above and tested directly. */

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
