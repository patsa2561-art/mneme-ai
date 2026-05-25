/**
 * v2.46.0 — NEMESIS ORGAN 1: FINGERPRINTER (41 features).
 *
 * Implements the 41-feature vector from arxiv 2601.17406 — pure
 * deterministic extraction (no ML model needed for the EXTRACTOR; the
 * CLASSIFIER applies the paper's feature weights to predict vendor).
 *
 * Each feature is documented in types.ts. Every value is a finite
 * non-negative real. NEVER throws — empty inputs return zero-vector.
 */

import type { Fingerprint, Fixture } from "./types.js";

function safeDivide(num: number, den: number): number {
  return den === 0 ? 0 : num / den;
}

function shannonEntropyNormalized(counts: number[]): number {
  const total = counts.reduce((a, b) => a + b, 0);
  if (total === 0 || counts.length === 0) return 0;
  let h = 0;
  for (const c of counts) {
    if (c === 0) continue;
    const p = c / total;
    h += -p * Math.log2(p);
  }
  const maxH = Math.log2(Math.max(1, counts.length));
  return maxH === 0 ? 0 : h / maxH; // ∈ [0, 1]
}

/**
 * Parse a unified diff into per-file added/removed line counts +
 * collected added-line text.
 */
function parseDiff(diff: string): {
  perFile: Map<string, { added: number; removed: number }>;
  addedLines: string[];
  removedLines: string[];
} {
  const perFile = new Map<string, { added: number; removed: number }>();
  const addedLines: string[] = [];
  const removedLines: string[] = [];
  let current: { added: number; removed: number } | null = null;
  let currentName = "";
  for (const ln of diff.split("\n")) {
    const m = ln.match(/^diff --git a\/(\S+) b\/(\S+)/);
    if (m) {
      currentName = m[2]!;
      current = { added: 0, removed: 0 };
      perFile.set(currentName, current);
      continue;
    }
    if (!current) continue;
    if (ln.startsWith("+") && !ln.startsWith("+++")) {
      current.added++;
      addedLines.push(ln.slice(1));
    } else if (ln.startsWith("-") && !ln.startsWith("---")) {
      current.removed++;
      removedLines.push(ln.slice(1));
    }
  }
  return { perFile, addedLines, removedLines };
}

export function extractFingerprint(fixture: Fixture): Fingerprint {
  const diff = fixture.diff ?? "";
  const prDesc = fixture.prDescription ?? "";
  const commits = fixture.commitMessages ?? [];

  // ── Commit shape ──
  const commit_count = commits.length;
  const multiline = commits.filter((c) => /\n/.test(c)).length;
  const multiline_commit_ratio = safeDivide(multiline, commit_count);
  const commitLineCounts = commits.map((c) => c.split("\n").length);
  const mean_commit_lines = commit_count === 0 ? 0 : commitLineCounts.reduce((a, b) => a + b, 0) / commit_count;
  const max_commit_chars = commits.reduce((m, c) => Math.max(m, c.length), 0);
  const commit_bullet_count = commits.reduce((n, c) => n + (c.match(/^[\s>]*[-*+]\s/gm)?.length ?? 0), 0);

  // ── Diff parse ──
  const { perFile, addedLines, removedLines } = parseDiff(diff);
  const added_lines = addedLines.length;
  const removed_lines = removedLines.length;
  const net_lines = added_lines - removed_lines;
  const files_touched = perFile.size;
  const addedJoined = addedLines.join("\n");

  // Conditional / control flow
  const if_count = (addedJoined.match(/\b(if|elif|else\s+if)\b/g) ?? []).length;
  const switch_count = (addedJoined.match(/\b(switch|case|match)\b/g) ?? []).length;
  const try_count = (addedJoined.match(/\b(try|catch|except|finally)\b/g) ?? []).length;
  const conditional_density = safeDivide(if_count + switch_count + try_count, added_lines);

  // ── PR description shape ──
  const pr_desc_length_chars = prDesc.length;
  const pr_desc_length_words = prDesc.split(/\s+/).filter(Boolean).length;
  const pr_desc_length_lines = prDesc.split("\n").length;
  const bullet_point_count = (prDesc.match(/^[\s>]*[-*+]\s/gm) ?? []).length;
  const hyperlink_count =
    (prDesc.match(/\[[^\]]+\]\([^)]+\)/g) ?? []).length +
    (prDesc.match(/\bhttps?:\/\/\S+/g) ?? []).length;
  const heading_count = (prDesc.match(/^#{1,6}\s/gm) ?? []).length;
  const code_fence_count = (prDesc.match(/```/g) ?? []).length / 2;
  const inline_code_count = (prDesc.match(/`[^`\n]+`/g) ?? []).length;

  // ── Change concentration ──
  const perFileCounts = [...perFile.values()].map((v) => v.added + v.removed);
  const distributed_changes_score = shannonEntropyNormalized(perFileCounts);
  const change_concentration = 1 - distributed_changes_score;

  // ── Line shape ──
  const lineLengths = addedLines.map((l) => l.length);
  const mean_line_length = lineLengths.length === 0 ? 0 : lineLengths.reduce((a, b) => a + b, 0) / lineLengths.length;
  const max_line_length = lineLengths.reduce((m, l) => Math.max(m, l), 0);
  const long_line_ratio = safeDivide(lineLengths.filter((l) => l > 100).length, lineLengths.length);

  // ── Comments / blanks ──
  const comment_count = addedLines.filter((l) =>
    /^\s*(\/\/|#|\/\*|\*\s|---)/.test(l)
  ).length;
  const comment_ratio = safeDivide(comment_count, added_lines);
  const blank_line_count = addedLines.filter((l) => /^\s*$/.test(l)).length;
  const blank_line_ratio = safeDivide(blank_line_count, added_lines);

  // ── Test / doc files ──
  const filePaths = [...perFile.keys()];
  const test_files_touched = filePaths.filter((p) => /\.(test|spec)\.|__tests__\/|tests?\//.test(p)).length;
  const doc_files_touched = filePaths.filter((p) => /\.(md|rst|txt|adoc)$|docs?\//i.test(p)).length;
  const test_file_ratio = safeDivide(test_files_touched, files_touched);

  // ── Hygiene markers ──
  const debug_print_count =
    (addedJoined.match(/\bconsole\.log\(/g) ?? []).length +
    (addedJoined.match(/\bprint\(/g) ?? []).length +
    (addedJoined.match(/\bdebugger\b/g) ?? []).length;
  const todo_marker_count = (addedJoined.match(/\b(TODO|FIXME|XXX|HACK)\b/g) ?? []).length;

  // ── Imports ──
  const import_count =
    (addedJoined.match(/^\s*import\s/gm) ?? []).length +
    (addedJoined.match(/\brequire\(/g) ?? []).length +
    (addedJoined.match(/\bfrom\s+["']/g) ?? []).length;
  const relative_import_count = (addedJoined.match(/from\s+["']\.{1,2}\//g) ?? []).length;

  // ── Punctuation density ──
  const semicolon_count = (addedJoined.match(/;/g) ?? []).length;
  const semicolon_density = safeDivide(semicolon_count, added_lines);
  const brace_count = (addedJoined.match(/[{}]/g) ?? []).length;
  const brace_density = safeDivide(brace_count, added_lines);
  const paren_count = (addedJoined.match(/[()]/g) ?? []).length;
  const paren_density = safeDivide(paren_count, added_lines);

  // ── Naming style ──
  const identifiers = addedJoined.match(/\b[A-Za-z_][A-Za-z0-9_]{2,}\b/g) ?? [];
  const camel_case_count = identifiers.filter((id) => /^[a-z][a-z0-9]*[A-Z]/.test(id)).length;
  const snake_case_count = identifiers.filter((id) => /^[a-z][a-z0-9]*_[a-z]/.test(id)).length;
  const mean_identifier_length = identifiers.length === 0 ? 0 : identifiers.reduce((s, i) => s + i.length, 0) / identifiers.length;

  return {
    multiline_commit_ratio, mean_commit_lines, max_commit_chars, commit_count,
    conditional_density, if_count, switch_count, try_count,
    pr_desc_length_chars, pr_desc_length_words, pr_desc_length_lines,
    bullet_point_count, hyperlink_count, heading_count, code_fence_count, inline_code_count,
    change_concentration, distributed_changes_score, files_touched,
    added_lines, removed_lines, net_lines,
    mean_line_length, max_line_length, long_line_ratio,
    comment_ratio, blank_line_ratio,
    test_files_touched, doc_files_touched, test_file_ratio,
    debug_print_count, todo_marker_count,
    import_count, relative_import_count,
    semicolon_density, brace_density, paren_density,
    camel_case_count, snake_case_count, mean_identifier_length,
    commit_bullet_count,
  };
}
