/**
 * Cognitive Twin — stylometric profile of an author's commit voice.
 *
 * The thesis: every engineer has a recognisable commit-message fingerprint.
 * Length distribution, opening verbs, conv-commit prefix preferences, em-dash
 * use, lowercase vs Title Case, ending punctuation. These are stable over
 * months and surprisingly distinctive.
 *
 * This module computes that fingerprint deterministically (no LLM, no
 * network) so the twin is reproducible and free everywhere.
 *
 * The "twin" emphatically does NOT speak for the author. The renderer marks
 * every speculative output as ✱ shadow-opinion — heuristic only.
 */
import { execGitOk } from "../git/exec.js";

export interface AuthorVoice {
  email: string;
  name: string;
  /** Number of commits used to build the profile. */
  sampleSize: number;

  /** Subject-line statistics. */
  subjectLengthAvg: number;
  subjectLengthP25: number;
  subjectLengthP75: number;

  /** % subjects that match conv-commit pattern. */
  convCommitPct: number;
  /** Top 5 conv-commit prefixes the author uses, sorted by frequency. */
  topPrefixes: Array<{ prefix: string; count: number; pct: number }>;

  /** Top 8 opening words (case-folded). */
  topOpeners: Array<{ word: string; count: number }>;

  /** Top 12 bigram phrases the author uses across subjects. */
  topPhrases: Array<{ phrase: string; count: number }>;

  /** Punctuation preferences (em-dash, colon, parenthetical scope, etc.). */
  punctuation: {
    emDashPct: number;
    colonPct: number;
    parenScopePct: number;
    endsWithPeriodPct: number;
  };

  /** % subjects in lowercase (no uppercase first letter after prefix). */
  lowercasePct: number;

  /** % bodies that contain bullet lists. */
  bulletBodyPct: number;

  /** Average body length in lines. */
  bodyLineAvg: number;

  /** Voice fingerprint hash — stable identifier (sha-like) for diffing voices over time. */
  fingerprint: string;

  /** First and last commit dates seen for this author (ISO yyyy-mm-dd). */
  firstSeen?: string;
  lastSeen?: string;
}

export interface ProfileOptions {
  cwd: string;
  email: string;
  /** Cap commits scanned (most-recent N). 0 = unlimited. */
  maxCommits?: number;
}

const CONV_PREFIX_RE = /^(feat|fix|chore|docs|refactor|test|perf|ci|build|style|revert)(\([^)]+\))?:\s*/i;
const STOP = new Set([
  "the", "a", "an", "to", "of", "and", "or", "for", "in", "on", "at",
  "by", "with", "is", "are", "be", "this", "that", "it", "we",
]);

interface RawCommit {
  email: string;
  name: string;
  timestamp: number;
  subject: string;
  body: string;
}

export async function profileAuthor(opts: ProfileOptions): Promise<AuthorVoice | null> {
  const args = [
    "log",
    `--author=${opts.email}`,
    "--no-merges",
    "--pretty=format:--C--%H%x09%ae%x09%an%x09%at%x09%s%n%b%x00",
  ];
  if (opts.maxCommits && opts.maxCommits > 0) args.push(`-n`, String(opts.maxCommits));

  const out = await execGitOk(args, { cwd: opts.cwd });
  const commits = parseLog(out, opts.email);
  if (commits.length === 0) return null;
  return buildVoice(commits);
}

export function parseLog(raw: string, emailFilter: string): RawCommit[] {
  if (!raw.trim()) return [];
  const wanted = emailFilter.toLowerCase();
  const blocks = raw.split("--C--").filter((b) => b.trim().length > 0);
  const out: RawCommit[] = [];
  for (const block of blocks) {
    const nullIdx = block.indexOf("\x00");
    const segment = nullIdx >= 0 ? block.slice(0, nullIdx) : block;
    const lines = segment.split("\n");
    const head = (lines[0] ?? "").split("\t");
    if (head.length < 5) continue;
    const email = (head[1] ?? "").toLowerCase();
    if (email !== wanted) continue;
    const subject = head[4] ?? "";
    const body = lines.slice(1).join("\n").trim();
    out.push({
      email,
      name: head[2] ?? "",
      timestamp: Number(head[3]) || 0,
      subject,
      body,
    });
  }
  return out;
}

function buildVoice(commits: RawCommit[]): AuthorVoice {
  const subjectLens = commits.map((c) => c.subject.length).sort((a, b) => a - b);
  const subjectLengthAvg = round1(avg(subjectLens));
  const subjectLengthP25 = subjectLens[Math.floor(subjectLens.length * 0.25)] ?? 0;
  const subjectLengthP75 = subjectLens[Math.floor(subjectLens.length * 0.75)] ?? 0;

  // Conv-commit
  const prefixCounts = new Map<string, number>();
  let convN = 0;
  for (const c of commits) {
    const m = CONV_PREFIX_RE.exec(c.subject);
    if (m) {
      convN += 1;
      const p = m[1]!.toLowerCase();
      prefixCounts.set(p, (prefixCounts.get(p) ?? 0) + 1);
    }
  }
  const convCommitPct = round1((convN * 100) / commits.length);
  const topPrefixes = Array.from(prefixCounts.entries())
    .map(([prefix, count]) => ({ prefix, count, pct: round1((count * 100) / commits.length) }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 5);

  // Openers (first word of subject *after* any conv-commit prefix)
  const openerCounts = new Map<string, number>();
  for (const c of commits) {
    const stripped = c.subject.replace(CONV_PREFIX_RE, "");
    const first = stripped.split(/\s+/)[0]?.toLowerCase();
    if (!first) continue;
    if (!/^[a-z']+$/.test(first)) continue;
    openerCounts.set(first, (openerCounts.get(first) ?? 0) + 1);
  }
  const topOpeners = Array.from(openerCounts.entries())
    .map(([word, count]) => ({ word, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 8);

  // Bigram phrases — content words only, case-folded
  const bigramCounts = new Map<string, number>();
  for (const c of commits) {
    const stripped = c.subject.replace(CONV_PREFIX_RE, "");
    const tokens = stripped
      .toLowerCase()
      .split(/[^a-z']+/)
      .filter((t) => t && !STOP.has(t) && t.length > 1);
    for (let i = 0; i < tokens.length - 1; i++) {
      const big = `${tokens[i]} ${tokens[i + 1]}`;
      bigramCounts.set(big, (bigramCounts.get(big) ?? 0) + 1);
    }
  }
  const topPhrases = Array.from(bigramCounts.entries())
    .filter(([, count]) => count >= 2)
    .map(([phrase, count]) => ({ phrase, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 12);

  // Punctuation
  let emDash = 0;
  let colon = 0;
  let parenScope = 0;
  let endsPeriod = 0;
  let lowerN = 0;
  for (const c of commits) {
    if (/—|--|—/.test(c.subject)) emDash += 1;
    if (c.subject.includes(":")) colon += 1;
    if (/\([^)]+\):/.test(c.subject)) parenScope += 1;
    if (/\.$/.test(c.subject.trim())) endsPeriod += 1;
    const stripped = c.subject.replace(CONV_PREFIX_RE, "");
    if (stripped && stripped[0] === stripped[0]!.toLowerCase()) lowerN += 1;
  }

  // Body
  let bulletN = 0;
  let bodyLines = 0;
  for (const c of commits) {
    if (/(^|\n)\s*[-*•]\s/.test(c.body)) bulletN += 1;
    if (c.body) bodyLines += c.body.split("\n").filter((l) => l.trim()).length;
  }

  const first = commits[commits.length - 1]; // git log gives newest first; last in array is oldest
  const last = commits[0];
  const firstSeen = first ? new Date(first.timestamp * 1000).toISOString().slice(0, 10) : undefined;
  const lastSeen = last ? new Date(last.timestamp * 1000).toISOString().slice(0, 10) : undefined;

  // Fingerprint — deterministic short hash of the dominant features
  const fingerprintInput =
    `${commits[0]!.email}|len:${subjectLengthAvg}|conv:${convCommitPct}|` +
    `prefix:${topPrefixes.map((p) => p.prefix).join(",")}|` +
    `openers:${topOpeners.slice(0, 3).map((o) => o.word).join(",")}`;
  const fingerprint = simpleHash(fingerprintInput);

  return {
    email: commits[0]!.email,
    name: commits[0]!.name || commits[0]!.email,
    sampleSize: commits.length,
    subjectLengthAvg,
    subjectLengthP25,
    subjectLengthP75,
    convCommitPct,
    topPrefixes,
    topOpeners,
    topPhrases,
    punctuation: {
      emDashPct: round1((emDash * 100) / commits.length),
      colonPct: round1((colon * 100) / commits.length),
      parenScopePct: round1((parenScope * 100) / commits.length),
      endsWithPeriodPct: round1((endsPeriod * 100) / commits.length),
    },
    lowercasePct: round1((lowerN * 100) / commits.length),
    bulletBodyPct: round1((bulletN * 100) / commits.length),
    bodyLineAvg: round1(bodyLines / commits.length),
    fingerprint,
    firstSeen,
    lastSeen,
  };
}

/**
 * Rewrite a generic commit subject to match an author's voice.
 * Pure heuristic — no LLM. Captures three high-signal moves:
 *   1. Apply their dominant conv-commit prefix.
 *   2. Match their lowercase preference.
 *   3. Match their preferred ending punctuation.
 *
 * Returned alongside a confidence score (0..1).
 */
export function rewriteInVoice(
  voice: AuthorVoice,
  generic: string,
): { rewritten: string; confidence: number; rules: string[] } {
  let s = generic.trim();
  const rules: string[] = [];

  // 1. Prefix
  const dominantPrefix = voice.topPrefixes[0];
  if (dominantPrefix && voice.convCommitPct >= 50) {
    if (!CONV_PREFIX_RE.test(s)) {
      s = `${dominantPrefix.prefix}: ${s}`;
      rules.push(`prepend prefix '${dominantPrefix.prefix}:'`);
    }
  }

  // 2. Lowercase content
  if (voice.lowercasePct >= 60) {
    s = s.replace(CONV_PREFIX_RE, (m) => m); // keep prefix as-is
    const colonIdx = s.indexOf(":");
    if (colonIdx >= 0 && colonIdx < 12) {
      const head = s.slice(0, colonIdx + 1);
      const tail = s.slice(colonIdx + 1).trim();
      if (tail && tail[0]) {
        s = `${head} ${tail[0].toLowerCase()}${tail.slice(1)}`;
        rules.push("lowercase first word after prefix");
      }
    }
  }

  // 3. Ending punctuation
  if (voice.punctuation.endsWithPeriodPct >= 50) {
    if (!s.endsWith(".")) {
      s = s + ".";
      rules.push("end with period");
    }
  } else {
    s = s.replace(/\.+$/, "");
  }

  // Confidence — based on sample size + conv-prefix dominance
  const cov = Math.min(1, voice.sampleSize / 20);
  const dom = dominantPrefix ? Math.min(1, dominantPrefix.pct / 50) : 0.3;
  const confidence = round1((0.5 * cov + 0.5 * dom) * 10) / 10;

  return { rewritten: s, confidence, rules };
}

function simpleHash(s: string): string {
  // FNV-1a 32-bit. Deterministic, no crypto dep.
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(16).padStart(8, "0");
}

function avg(xs: number[]): number {
  if (xs.length === 0) return 0;
  return xs.reduce((a, b) => a + b, 0) / xs.length;
}

function round1(x: number): number {
  return Math.round(x * 10) / 10;
}
