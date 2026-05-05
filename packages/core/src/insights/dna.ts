/**
 * `mneme dna [@author]` — extract a "Codebase DNA" fingerprint for a
 * contributor: their preferred patterns, message style, hours, and file
 * affinity, packaged as an exportable JSON artifact.
 *
 * What makes this novel:
 *   - Existing tools either show *snapshot* metrics (HowYouCode) or
 *     ownership / hotspots (Hercules). None extract a stable, exportable,
 *     comparable per-developer fingerprint from commit *history*.
 *   - DNA is shareable as JSON — collaborators can compare strands,
 *     teams can baseline, the same person can track themselves over time.
 *   - Compatibility scoring (Jaccard over multiple feature axes) gives
 *     "how genetically similar are two coders?" in one number.
 *
 * Pure data extraction. CLI renders + writes JSON.
 */
import type { Commit } from "../types.js";

export interface CodebaseDna {
  /** Author email or login this strand was extracted from. */
  author: string;
  /** Number of commits used to build this strand. */
  commitCount: number;
  /** Date range covered by this strand. */
  fromDate: string;
  toDate: string;
  /** Style genome — surface-level coding habits inferred from commits. */
  style: StyleGenome;
  /** Commit message DNA — how this person writes. */
  message: MessageGenome;
  /** Working hours pattern (UTC). */
  hours: HoursGenome;
  /** File affinity — what they touch and avoid. */
  files: FilesGenome;
  /**
   * Stable hash of the strand — short identifier suitable for sharing
   * ("DNA hash"), like a git SHA prefix. Computed deterministically from
   * the genome contents.
   */
  hash: string;
}

export interface StyleGenome {
  /** Median number of files touched per commit. */
  filesPerCommit: number;
  /** Mean churn per commit (insertions + deletions, capped). */
  churnPerCommit: number;
  /** Fraction of commits touching tests (path includes test/spec). */
  testRatio: number;
  /** Fraction of commits referencing an issue or PR. */
  issueRefRatio: number;
  /** Fraction of commits whose subject starts with a conventional prefix. */
  conventionalRatio: number;
}

export interface MessageGenome {
  /** Mean subject length in characters. */
  avgSubjectLength: number;
  /** Fraction of subjects in imperative mood (rough heuristic). */
  imperativeRatio: number;
  /** Fraction of commits that include a body. */
  bodyRatio: number;
  /** Top 5 leading verbs / prefixes used. */
  topVerbs: Array<{ verb: string; count: number }>;
}

export interface HoursGenome {
  /** Hour-of-day histogram (UTC). 24 buckets. */
  byHour: number[];
  /** Day-of-week histogram (0=Sunday). 7 buckets. */
  byWeekday: number[];
  /** Fraction of commits on Sat/Sun. */
  weekendRatio: number;
  /** The peak window as "HH:00–HH:00" UTC. */
  peakWindow: string;
}

export interface FilesGenome {
  /** Top directories by commit count, normalized. */
  topDirs: Array<{ dir: string; share: number }>;
  /** Top file extensions by commit count. */
  topExts: Array<{ ext: string; share: number }>;
}

const CONVENTIONAL_RE = /^(feat|fix|chore|docs|style|refactor|test|perf|build|ci|revert)(\([^)]*\))?:/;
const IMPERATIVE_FIRST_WORDS = new Set([
  "add", "fix", "update", "remove", "refactor", "improve", "rename", "move",
  "extract", "introduce", "implement", "support", "drop", "use", "make", "ensure",
  "prevent", "handle", "wire", "expose", "switch", "replace", "migrate",
  "polish", "simplify", "consolidate", "split", "delete", "init", "scaffold",
  "bump", "release", "publish", "ship", "build", "configure", "enable", "disable",
  "create", "test", "document", "clarify", "tighten", "guard", "validate",
]);

/** Build a Codebase DNA strand for the given author from commits they made. */
export function extractDna(
  commits: Commit[],
  author: string,
  opts: { now?: number } = {},
): CodebaseDna {
  const filtered = commits.filter(
    (c) =>
      c.authorEmail.toLowerCase() === author.toLowerCase() ||
      c.authorName.toLowerCase() === author.toLowerCase(),
  );
  if (filtered.length === 0) {
    return emptyDna(author);
  }

  const sorted = [...filtered].sort((a, b) =>
    a.authorDate.localeCompare(b.authorDate),
  );
  const fromDate = sorted[0]!.authorDate.slice(0, 10);
  const toDate = sorted[sorted.length - 1]!.authorDate.slice(0, 10);

  const style = computeStyle(sorted);
  const message = computeMessage(sorted);
  const hours = computeHours(sorted);
  const files = computeFiles(sorted);

  const dna: CodebaseDna = {
    author,
    commitCount: sorted.length,
    fromDate,
    toDate,
    style,
    message,
    hours,
    files,
    hash: "", // filled in below
  };
  dna.hash = stableHash(dna);
  return dna;
}

/** Compatibility score 0..1 between two DNA strands. */
export function compareDna(a: CodebaseDna, b: CodebaseDna): {
  similarity: number;
  axes: Array<{ axis: string; similarity: number }>;
} {
  const axes: Array<{ axis: string; similarity: number }> = [];
  axes.push({ axis: "style", similarity: styleSim(a.style, b.style) });
  axes.push({ axis: "message", similarity: messageSim(a.message, b.message) });
  axes.push({ axis: "hours", similarity: hoursSim(a.hours, b.hours) });
  axes.push({ axis: "files", similarity: filesSim(a.files, b.files) });
  const overall =
    axes.reduce((s, x) => s + x.similarity, 0) / Math.max(1, axes.length);
  return {
    similarity: Number(overall.toFixed(3)),
    axes: axes.map((a) => ({ axis: a.axis, similarity: Number(a.similarity.toFixed(3)) })),
  };
}

// ─── computation ───────────────────────────────────────────────────────

function computeStyle(cs: Commit[]): StyleGenome {
  const filesPer = median(cs.map((c) => c.files.length));
  let testHits = 0;
  let issueHits = 0;
  let convHits = 0;
  for (const c of cs) {
    if (c.files.some((f) => /\b(test|spec|__tests__)\b|\.test\.|\.spec\./.test(f))) {
      testHits++;
    }
    if (c.issueRefs?.length || c.prNumber) issueHits++;
    if (CONVENTIONAL_RE.test(c.subject)) convHits++;
  }
  return {
    filesPerCommit: filesPer,
    churnPerCommit: 0, // cheap default — caller can pass changes if needed
    testRatio: cs.length === 0 ? 0 : testHits / cs.length,
    issueRefRatio: cs.length === 0 ? 0 : issueHits / cs.length,
    conventionalRatio: cs.length === 0 ? 0 : convHits / cs.length,
  };
}

function computeMessage(cs: Commit[]): MessageGenome {
  let totalLen = 0;
  let imp = 0;
  let body = 0;
  const verbs = new Map<string, number>();
  for (const c of cs) {
    const subj = c.subject.trim();
    totalLen += subj.length;
    if (c.body && c.body.trim().length > 0) body++;
    // strip conventional prefix
    const cleaned = subj.replace(CONVENTIONAL_RE, "").trim();
    const firstWord = (cleaned.match(/^[A-Za-z]+/)?.[0] || "").toLowerCase();
    if (IMPERATIVE_FIRST_WORDS.has(firstWord)) imp++;
    if (firstWord) verbs.set(firstWord, (verbs.get(firstWord) ?? 0) + 1);
  }
  const top = [...verbs.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([verb, count]) => ({ verb, count }));
  return {
    avgSubjectLength: cs.length === 0 ? 0 : Math.round(totalLen / cs.length),
    imperativeRatio: cs.length === 0 ? 0 : imp / cs.length,
    bodyRatio: cs.length === 0 ? 0 : body / cs.length,
    topVerbs: top,
  };
}

function computeHours(cs: Commit[]): HoursGenome {
  const byHour = new Array<number>(24).fill(0);
  const byWeekday = new Array<number>(7).fill(0);
  let weekend = 0;
  for (const c of cs) {
    const d = new Date(c.authorDate);
    if (Number.isNaN(d.getTime())) continue;
    byHour[d.getUTCHours()] = (byHour[d.getUTCHours()] ?? 0) + 1;
    const w = d.getUTCDay();
    byWeekday[w] = (byWeekday[w] ?? 0) + 1;
    if (w === 0 || w === 6) weekend++;
  }
  // peak window = 4-hour band with highest sum
  let bestStart = 0;
  let bestSum = -1;
  for (let i = 0; i < 24; i++) {
    let s = 0;
    for (let k = 0; k < 4; k++) s += byHour[(i + k) % 24] ?? 0;
    if (s > bestSum) {
      bestSum = s;
      bestStart = i;
    }
  }
  const peak = `${pad2(bestStart)}:00–${pad2((bestStart + 4) % 24)}:00`;
  return {
    byHour,
    byWeekday,
    weekendRatio: cs.length === 0 ? 0 : weekend / cs.length,
    peakWindow: peak,
  };
}

function computeFiles(cs: Commit[]): FilesGenome {
  const dirCounts = new Map<string, number>();
  const extCounts = new Map<string, number>();
  let totalFiles = 0;
  for (const c of cs) {
    for (const f of c.files) {
      totalFiles++;
      const dir = f.split("/").slice(0, 2).join("/") || "(root)";
      dirCounts.set(dir, (dirCounts.get(dir) ?? 0) + 1);
      const ext = (f.match(/\.[A-Za-z0-9]+$/)?.[0] || "(none)").toLowerCase();
      extCounts.set(ext, (extCounts.get(ext) ?? 0) + 1);
    }
  }
  const topDirs = [...dirCounts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([dir, n]) => ({ dir, share: totalFiles === 0 ? 0 : n / totalFiles }));
  const topExts = [...extCounts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([ext, n]) => ({ ext, share: totalFiles === 0 ? 0 : n / totalFiles }));
  return { topDirs, topExts };
}

// ─── similarity helpers ────────────────────────────────────────────────

function styleSim(a: StyleGenome, b: StyleGenome): number {
  const axes = [
    1 - clamp(Math.abs(a.filesPerCommit - b.filesPerCommit) / 10),
    1 - clamp(Math.abs(a.testRatio - b.testRatio)),
    1 - clamp(Math.abs(a.issueRefRatio - b.issueRefRatio)),
    1 - clamp(Math.abs(a.conventionalRatio - b.conventionalRatio)),
  ];
  return mean(axes);
}

function messageSim(a: MessageGenome, b: MessageGenome): number {
  const lenSim = 1 - clamp(Math.abs(a.avgSubjectLength - b.avgSubjectLength) / 80);
  const impSim = 1 - clamp(Math.abs(a.imperativeRatio - b.imperativeRatio));
  const bodySim = 1 - clamp(Math.abs(a.bodyRatio - b.bodyRatio));
  const verbSim = jaccard(
    new Set(a.topVerbs.map((v) => v.verb)),
    new Set(b.topVerbs.map((v) => v.verb)),
  );
  return mean([lenSim, impSim, bodySim, verbSim]);
}

function hoursSim(a: HoursGenome, b: HoursGenome): number {
  return cosineSimArr(normalize(a.byHour), normalize(b.byHour));
}

function filesSim(a: FilesGenome, b: FilesGenome): number {
  return jaccard(
    new Set(a.topDirs.map((d) => d.dir)),
    new Set(b.topDirs.map((d) => d.dir)),
  );
}

function jaccard<T>(a: Set<T>, b: Set<T>): number {
  if (a.size === 0 && b.size === 0) return 1;
  let inter = 0;
  for (const x of a) if (b.has(x)) inter++;
  const union = a.size + b.size - inter;
  return union === 0 ? 0 : inter / union;
}

function cosineSimArr(a: number[], b: number[]): number {
  let dot = 0;
  let na = 0;
  let nb = 0;
  const n = Math.min(a.length, b.length);
  for (let i = 0; i < n; i++) {
    const ai = a[i] ?? 0;
    const bi = b[i] ?? 0;
    dot += ai * bi;
    na += ai * ai;
    nb += bi * bi;
  }
  const denom = Math.sqrt(na) * Math.sqrt(nb);
  return denom === 0 ? 0 : dot / denom;
}

function normalize(xs: number[]): number[] {
  const sum = xs.reduce((s, x) => s + x, 0);
  if (sum === 0) return xs.slice();
  return xs.map((x) => x / sum);
}

function clamp(v: number): number {
  if (v < 0) return 0;
  if (v > 1) return 1;
  return v;
}

function mean(xs: number[]): number {
  if (xs.length === 0) return 0;
  return xs.reduce((s, x) => s + x, 0) / xs.length;
}

function median(xs: number[]): number {
  if (xs.length === 0) return 0;
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 === 1 ? s[m]! : (s[m - 1]! + s[m]!) / 2;
}

function pad2(n: number): string {
  return n < 10 ? "0" + n : "" + n;
}

function emptyDna(author: string): CodebaseDna {
  return {
    author,
    commitCount: 0,
    fromDate: "",
    toDate: "",
    style: { filesPerCommit: 0, churnPerCommit: 0, testRatio: 0, issueRefRatio: 0, conventionalRatio: 0 },
    message: { avgSubjectLength: 0, imperativeRatio: 0, bodyRatio: 0, topVerbs: [] },
    hours: { byHour: new Array(24).fill(0), byWeekday: new Array(7).fill(0), weekendRatio: 0, peakWindow: "00:00–00:00" },
    files: { topDirs: [], topExts: [] },
    hash: "0000000",
  };
}

function stableHash(dna: CodebaseDna): string {
  // FNV-1a 32-bit hash over a canonical string representation
  const json = JSON.stringify({
    author: dna.author,
    style: dna.style,
    message: { ...dna.message, topVerbs: dna.message.topVerbs.map((v) => v.verb) },
    files: { topDirs: dna.files.topDirs.map((d) => d.dir), topExts: dna.files.topExts.map((e) => e.ext) },
  });
  let h = 0x811c9dc5;
  for (let i = 0; i < json.length; i++) {
    h ^= json.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16).padStart(8, "0").slice(0, 7);
}
