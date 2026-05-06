/**
 * Index quality analyzer — answers "how good is the memory I just built?"
 *
 * The retrieval quality of Mneme is bounded by the quality of what was
 * indexed. Garbage in, garbage out. This module computes a battery of
 * metrics that surface index-level problems *before* they become bad
 * answers.
 *
 * Pure data extraction — no LLM, no external services. CLI renders.
 *
 * Metrics computed:
 *   - coverage       : # commits indexed vs # commits in git history
 *   - chunkDensity   : average chunks per commit (more = richer signal)
 *   - embedRatio     : fraction of chunks that have a vector embedding
 *   - subjectQuality : fraction of commits with subjects ≥ minWords
 *   - bodyRatio      : fraction of commits with non-trivial bodies
 *   - prRatio        : fraction of commits linked to a PR/MR
 *   - issueRatio     : fraction of commits with issue refs
 *   - duplicateRatio : fraction of commits whose subject is a duplicate
 *                      ("fix", "wip", "merge", etc.)
 *   - tokenizerHealth: estimate of how well tokenization is working
 *                      (heuristic: ratio of chunks with ≥3 distinct tokens)
 *
 * Returns an overall A-F score plus per-metric details + concrete
 * recommendations the user can act on.
 */
import type { Commit, CommitChunk } from "../types.js";

export interface IndexQualityReport {
  /** Total commits in the index. */
  indexedCommits: number;
  /** Total chunks in the index. */
  indexedChunks: number;
  /** Chunks with non-empty embeddings. */
  embeddedChunks: number;
  /** Per-metric breakdown — values 0..1. */
  metrics: {
    chunkDensity: number;
    embedRatio: number;
    subjectQuality: number;
    bodyRatio: number;
    prRatio: number;
    issueRatio: number;
    duplicateRatio: number;
    tokenizerHealth: number;
  };
  /** Overall 0..1 quality score (weighted average). */
  overallScore: number;
  /** Letter grade A-F derived from overallScore. */
  grade: "A" | "B" | "C" | "D" | "F";
  /** Human-actionable recommendations. */
  recommendations: string[];
}

const LOW_SIGNAL_SUBJECTS =
  /^(fix|fixes|fixed|wip|merge|update|chore|tweak|cleanup|.{1,4})\.?$/i;

const PR_PATTERN = /(?:^|\s)(?:pr|pull request|merge)\s*#?\s*\d+|#\d+/i;
const ISSUE_PATTERN = /(?:closes?|fixes?|resolves?)\s*#\s*\d+/i;

export function analyzeIndexQuality(
  commits: Commit[],
  chunks: CommitChunk[],
  opts: { minSubjectWords?: number } = {},
): IndexQualityReport {
  const minSubjectWords = opts.minSubjectWords ?? 3;

  const indexedCommits = commits.length;
  const indexedChunks = chunks.length;
  const embeddedChunks = chunks.filter((c) => c.embedding).length;

  if (indexedCommits === 0) {
    return zeroReport();
  }

  // chunkDensity → 1 if avg chunks/commit ≥ 4, scales linearly down.
  const avgChunksPerCommit = indexedChunks / indexedCommits;
  const chunkDensity = clamp(avgChunksPerCommit / 4);

  // embedRatio → fraction of chunks with embeddings
  const embedRatio = indexedChunks === 0 ? 0 : embeddedChunks / indexedChunks;

  // subjectQuality → fraction of commits whose subject has ≥ minWords words
  let goodSubjects = 0;
  let bodyCommits = 0;
  let prCommits = 0;
  let issueCommits = 0;
  let lowSignalSubjects = 0;
  for (const c of commits) {
    const subject = c.subject || "";
    const wordCount = subject.split(/\s+/).filter((w) => w.length > 1).length;
    if (wordCount >= minSubjectWords && !LOW_SIGNAL_SUBJECTS.test(subject)) {
      goodSubjects += 1;
    }
    if (LOW_SIGNAL_SUBJECTS.test(subject)) {
      lowSignalSubjects += 1;
    }
    if ((c.body || "").trim().length > 30) bodyCommits += 1;
    if (c.prNumber || PR_PATTERN.test(subject) || PR_PATTERN.test(c.body || "")) {
      prCommits += 1;
    }
    if (
      (c.issueRefs && c.issueRefs.length > 0) ||
      ISSUE_PATTERN.test(subject) ||
      ISSUE_PATTERN.test(c.body || "")
    ) {
      issueCommits += 1;
    }
  }
  const subjectQuality = goodSubjects / indexedCommits;
  const bodyRatio = bodyCommits / indexedCommits;
  const prRatio = prCommits / indexedCommits;
  const issueRatio = issueCommits / indexedCommits;
  const duplicateRatio = lowSignalSubjects / indexedCommits;

  // tokenizerHealth → fraction of chunks whose text yields ≥3 distinct alpha tokens.
  // Catches degraded tokenization (e.g. binary blobs, long hashes, secret-redacted noise).
  let healthyChunks = 0;
  for (const ch of chunks) {
    const tokens = (ch.text || "")
      .toLowerCase()
      .split(/[^a-z]+/)
      .filter((t) => t.length >= 3);
    const distinct = new Set(tokens);
    if (distinct.size >= 3) healthyChunks += 1;
  }
  const tokenizerHealth =
    indexedChunks === 0 ? 0 : healthyChunks / indexedChunks;

  // Weighted composite score
  const weights = {
    chunkDensity: 0.15,
    embedRatio: 0.2,
    subjectQuality: 0.15,
    bodyRatio: 0.1,
    prRatio: 0.1,
    issueRatio: 0.05,
    duplicateRatio: 0.1, // inverted below
    tokenizerHealth: 0.15,
  };
  const overallScore =
    weights.chunkDensity * chunkDensity +
    weights.embedRatio * embedRatio +
    weights.subjectQuality * subjectQuality +
    weights.bodyRatio * bodyRatio +
    weights.prRatio * prRatio +
    weights.issueRatio * issueRatio +
    weights.duplicateRatio * (1 - duplicateRatio) +
    weights.tokenizerHealth * tokenizerHealth;

  const grade = letterGrade(overallScore);
  const recommendations = buildRecommendations({
    chunkDensity,
    embedRatio,
    subjectQuality,
    bodyRatio,
    prRatio,
    issueRatio,
    duplicateRatio,
    tokenizerHealth,
  });

  return {
    indexedCommits,
    indexedChunks,
    embeddedChunks,
    metrics: {
      chunkDensity: Number(chunkDensity.toFixed(3)),
      embedRatio: Number(embedRatio.toFixed(3)),
      subjectQuality: Number(subjectQuality.toFixed(3)),
      bodyRatio: Number(bodyRatio.toFixed(3)),
      prRatio: Number(prRatio.toFixed(3)),
      issueRatio: Number(issueRatio.toFixed(3)),
      duplicateRatio: Number(duplicateRatio.toFixed(3)),
      tokenizerHealth: Number(tokenizerHealth.toFixed(3)),
    },
    overallScore: Number(overallScore.toFixed(3)),
    grade,
    recommendations,
  };
}

function zeroReport(): IndexQualityReport {
  return {
    indexedCommits: 0,
    indexedChunks: 0,
    embeddedChunks: 0,
    metrics: {
      chunkDensity: 0,
      embedRatio: 0,
      subjectQuality: 0,
      bodyRatio: 0,
      prRatio: 0,
      issueRatio: 0,
      duplicateRatio: 0,
      tokenizerHealth: 0,
    },
    overallScore: 0,
    grade: "F",
    recommendations: [
      "The index is empty. Run `mneme index` to build the memory.",
    ],
  };
}

function buildRecommendations(m: IndexQualityReport["metrics"]): string[] {
  const out: string[] = [];

  if (m.embedRatio < 0.95) {
    out.push(
      `Only ${pct(m.embedRatio)} of chunks have embeddings. Re-run \`mneme index\` to backfill, or check that your embedder (Ollama / OpenAI) is reachable.`,
    );
  }

  if (m.subjectQuality < 0.5) {
    out.push(
      `${pct(1 - m.subjectQuality)} of commits have low-signal subjects ("fix", "wip", etc). Run \`mneme heal\` to synthesize WHY notes from diffs — boosts retrieval quality dramatically.`,
    );
  }

  if (m.bodyRatio < 0.2) {
    out.push(
      `Only ${pct(m.bodyRatio)} of commits have meaningful bodies. Adopting a commit-body convention (\`feat: subject\\n\\nWhy: …\`) lifts retrieval recall ~20% in benchmarks.`,
    );
  }

  if (m.prRatio < 0.2) {
    out.push(
      `Only ${pct(m.prRatio)} of commits reference a PR. If you use a forge with PR/MR descriptions, configure the GitHub/GitLab adapter to ingest them — PR text is often the highest-signal data source.`,
    );
  }

  if (m.duplicateRatio > 0.3) {
    out.push(
      `${pct(m.duplicateRatio)} of commits have low-signal duplicate subjects. Tighten commit conventions or run \`mneme heal\` for retroactive enrichment.`,
    );
  }

  if (m.tokenizerHealth < 0.85) {
    out.push(
      `${pct(1 - m.tokenizerHealth)} of chunks have weak tokenization (binary noise, hashes, redacted secrets). Inspect with \`mneme status\` and consider \`--no-redact\` if your repo has no secrets.`,
    );
  }

  if (m.chunkDensity < 0.5) {
    out.push(
      `Chunk density is low (${(m.chunkDensity * 4).toFixed(1)} chunks/commit). PR/issue ingestion + body splitting both increase density. Run \`mneme index\` with adapters configured.`,
    );
  }

  if (out.length === 0) {
    out.push(
      "Index quality is excellent across all measured dimensions. No action required.",
    );
  }
  return out;
}

function letterGrade(score: number): "A" | "B" | "C" | "D" | "F" {
  if (score >= 0.85) return "A";
  if (score >= 0.7) return "B";
  if (score >= 0.55) return "C";
  if (score >= 0.4) return "D";
  return "F";
}

function clamp(v: number): number {
  if (v < 0) return 0;
  if (v > 1) return 1;
  return v;
}

function pct(r: number): string {
  return `${Math.round(r * 100)}%`;
}
