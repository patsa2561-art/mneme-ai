/**
 * v2.46.0 — NEMESIS types.
 *
 * Inspired by arxiv 2601.17406 (Jan 2026): "Fingerprinting AI Coding
 * Agents in the Wild" — 97.2% F1 across 33,580 PRs using 41 features.
 * Vendors covered: Codex / Claude Code / Copilot / Cursor / Devin.
 */

export type VendorId =
  | "codex"
  | "claude-code"
  | "copilot"
  | "cursor"
  | "devin"
  | "unknown";

export interface Fixture {
  /** Unified-diff text. */
  diff: string;
  /** PR / merge-request description (markdown). */
  prDescription: string;
  /** Each commit message (one element per commit). */
  commitMessages: string[];
}

/** The 41 numeric features extracted from a fixture. Pure-numeric: every
 *  value is a real number in [0, +inf). Most are ratios in [0, 1]; a few
 *  are counts. */
export interface Fingerprint {
  // ── Multiline shape ────────────────────────────────────────────────
  /** Fraction of commits that contain a newline. */
  multiline_commit_ratio: number;
  /** Mean lines per commit message (across all commits). */
  mean_commit_lines: number;
  /** Max commit message length (chars). */
  max_commit_chars: number;
  /** Total commit count. */
  commit_count: number;

  // ── Conditional / control flow ─────────────────────────────────────
  /** Conditional keyword count divided by added-line count. */
  conditional_density: number;
  /** Total `if` / `else if` keywords in the diff. */
  if_count: number;
  /** `switch` / `case` keyword count. */
  switch_count: number;
  /** `try` / `catch` keyword count. */
  try_count: number;

  // ── PR description ─────────────────────────────────────────────────
  /** Length of PR description (chars). */
  pr_desc_length_chars: number;
  /** Length of PR description (words). */
  pr_desc_length_words: number;
  /** Length of PR description (lines). */
  pr_desc_length_lines: number;

  // ── Visual structure of PR description ─────────────────────────────
  /** Count of markdown bullet markers (-, *, +) at line starts. */
  bullet_point_count: number;
  /** Count of markdown hyperlinks `[text](url)` + bare URLs. */
  hyperlink_count: number;
  /** Count of markdown headings (`#` ... `######`). */
  heading_count: number;
  /** Count of fenced code blocks (```). */
  code_fence_count: number;
  /** Count of inline-code spans (backticks). */
  inline_code_count: number;

  // ── Change concentration ───────────────────────────────────────────
  /** 1 - distributed_changes_score; high = changes concentrated in few files. */
  change_concentration: number;
  /** Shannon-entropy-style spread of changes across files (0..1). */
  distributed_changes_score: number;
  /** Number of distinct files touched. */
  files_touched: number;

  // ── Line shape ─────────────────────────────────────────────────────
  added_lines: number;
  removed_lines: number;
  /** Net = added - removed. */
  net_lines: number;
  /** Mean added-line length (chars). */
  mean_line_length: number;
  /** Max added-line length. */
  max_line_length: number;
  /** Fraction of added lines that exceed 100 chars. */
  long_line_ratio: number;

  // ── Comment density ────────────────────────────────────────────────
  /** Lines starting with `//` `#` `/*` `*` divided by added lines. */
  comment_ratio: number;
  /** Blank lines / added lines. */
  blank_line_ratio: number;

  // ── Test / docs presence ───────────────────────────────────────────
  test_files_touched: number;
  doc_files_touched: number;
  /** Fraction of files that look like tests. */
  test_file_ratio: number;

  // ── Identifier hygiene ─────────────────────────────────────────────
  /** Count of `console.log` / `print(` debug calls left in. */
  debug_print_count: number;
  /** Count of `TODO` / `FIXME` markers. */
  todo_marker_count: number;

  // ── Import / module shape ──────────────────────────────────────────
  /** New `import` / `require` lines. */
  import_count: number;
  /** Relative import count. */
  relative_import_count: number;

  // ── Punctuation entropy ────────────────────────────────────────────
  /** Semicolon density in added lines. */
  semicolon_density: number;
  /** Brace density `{` `}`. */
  brace_density: number;
  /** Paren density `(` `)`. */
  paren_density: number;

  // ── Naming style of new identifiers ────────────────────────────────
  /** camelCase identifier count. */
  camel_case_count: number;
  /** snake_case identifier count. */
  snake_case_count: number;
  /** Mean identifier length. */
  mean_identifier_length: number;

  // ── Commit-message phrase markers ──────────────────────────────────
  /** Count of bullet markers in COMMIT messages. */
  commit_bullet_count: number;
}

export interface AgentVerdict {
  /** Top-ranked vendor; "unknown" when all scores tie at 0. */
  topVendor: VendorId;
  /** Confidence ∈ [0, 1] = topScore / sum(scores). */
  confidence: number;
  /** Per-vendor signature-match score. */
  scores: Partial<Record<VendorId, number>>;
  /** One-line explanation of which features drove the verdict. */
  reasoning: string;
}

export type IdentityVerdictKind = "CONFIRMED" | "DISPUTED" | "IMPOSSIBLE" | "INCONCLUSIVE";

export interface IdentityClaimInput {
  claimedVendor: string;
  fixture: Fixture;
}

export interface IdentityVerdict {
  verdict: IdentityVerdictKind;
  claimedVendor: string;
  fingerprintTop: VendorId;
  fingerprintConfidence: number;
  /** One-line summary. */
  reasoning: string;
  /** HMAC over canonical(verdict + claimedVendor + topVendor + confidence). */
  hmac: string;
}

export interface Article50StampInput {
  /** Original commit message / content text. */
  message: string;
  /** Vendor that generated the content. */
  vendor: string;
  /** Caller's confidence in attribution (0..1). */
  confidence: number;
  /** Optional content-type override (default text/x-source-code). */
  contentType?: string;
}

export interface Article50Stamp {
  /** ISO timestamp. */
  at: string;
  vendor: string;
  confidence: number;
  contentType: string;
  /** HMAC over canonical(at + vendor + confidence + contentType + message). */
  hmac: string;
  /** "EU-AI-ACT-2024" — locked. */
  regime: string;
  /** "50" — Article number. */
  article: string;
}

export interface StampResult {
  ok: boolean;
  reason?: string;
  /** message + machine-readable disclosure block appended. */
  stampedMessage: string;
  stamp: Article50Stamp;
}

export interface VerifyStampResult {
  valid: boolean;
  reason?: string;
  parsed?: Article50Stamp;
}
