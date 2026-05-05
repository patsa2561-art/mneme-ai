/**
 * `mneme crystal-ball` — predict the probability that the staged change
 * will fail CI, BEFORE you push.
 *
 * Approach (Bayesian-ish over historical signals):
 *   1. Compute a fingerprint of the staged diff:
 *        modules touched, file types, add/remove ratio, test changes Y/N.
 *   2. Find historical commits with similar fingerprints.
 *   3. Look at each one's fate within `windowDays`:
 *        - revert / hotfix / fix follow-up = "trouble"
 *        - else                            = "clean"
 *   4. Output: prediction p(clean) = clean / total similar.
 *
 * Without integrated CI run history (which Mneme doesn't index by default),
 * follow-up commits are our best proxy: a commit that needed a hotfix is
 * indistinguishable from one that broke CI from the user's perspective.
 *
 * The output is honest about its limits: if `n` is small (< 5), we say
 * "low signal" instead of pretending to be confident.
 */

import type { MnemeStore } from "../store/sqlite.js";
import type { Commit } from "../types.js";
import { parseDiff, type ParsedDiff } from "./commit-coach.js";
import { detectRegrets } from "./regret.js";

export interface DiffFingerprint {
  /** Top-2-segment modules touched, sorted. */
  modules: string[];
  /** File extensions touched, sorted. */
  extensions: string[];
  /** "feat" / "fix" / "refactor" / etc. */
  shape: ParsedDiff["shape"];
  /** Total touch volume: added + removed. */
  size: "tiny" | "small" | "medium" | "large";
  /** Whether tests were also modified. */
  hasTests: boolean;
}

export interface CrystalBallPrediction {
  fingerprint: DiffFingerprint;
  /** Number of similar past commits found. */
  similarN: number;
  /** Of those, how many had no follow-up regret. */
  cleanN: number;
  /** Probability of clean CI / no follow-up trouble (0..1). */
  pClean: number;
  /** Verdict label: clear / moderate / risky / unknown. */
  verdict: "clear" | "moderate" | "risky" | "unknown";
  /** Most-similar past commit (a concrete reference). */
  mostSimilar?: { hash: string; subject: string; date: string; outcome: "clean" | "trouble" };
  /** A 1-line recommendation. */
  recommendation: string;
}

export function fingerprint(diff: ParsedDiff): DiffFingerprint {
  const exts = new Set<string>();
  for (const f of diff.files) {
    const m = f.match(/\.([a-z0-9]+)$/i);
    if (m) exts.add(m[1]!.toLowerCase());
  }
  const totalLines = diff.added + diff.removed;
  const size: DiffFingerprint["size"] =
    totalLines < 20 ? "tiny" : totalLines < 100 ? "small" : totalLines < 500 ? "medium" : "large";
  const hasTests = diff.files.some((f) => /(\.test\.|\.spec\.|\/tests?\/|\/specs?\/)/.test(f));
  return {
    modules: [...new Set(diff.modules)].sort(),
    extensions: [...exts].sort(),
    shape: diff.shape,
    size,
    hasTests,
  };
}

/**
 * Score similarity between two fingerprints. Returns 0..1.
 *
 * Each dimension contributes a weight; the score is a weighted average:
 *   modules:    0.40  (Jaccard)
 *   extensions: 0.20  (Jaccard)
 *   shape:      0.20  (1.0 if equal, else 0.0)
 *   size:       0.10  (linear distance over 4 buckets)
 *   hasTests:   0.10  (1.0 if equal, else 0.0)
 */
export function similarity(a: DiffFingerprint, b: DiffFingerprint): number {
  const jaccard = (xs: string[], ys: string[]) => {
    if (xs.length === 0 && ys.length === 0) return 1;
    const A = new Set(xs);
    const B = new Set(ys);
    let inter = 0;
    for (const x of A) if (B.has(x)) inter += 1;
    const union = A.size + B.size - inter;
    return union === 0 ? 0 : inter / union;
  };

  const modules = jaccard(a.modules, b.modules);
  const exts = jaccard(a.extensions, b.extensions);
  const shape = a.shape === b.shape ? 1 : 0;
  const sizes = ["tiny", "small", "medium", "large"];
  const sizeDist = Math.abs(sizes.indexOf(a.size) - sizes.indexOf(b.size));
  const size = 1 - sizeDist / 3;
  const tests = a.hasTests === b.hasTests ? 1 : 0;

  return 0.4 * modules + 0.2 * exts + 0.2 * shape + 0.1 * size + 0.1 * tests;
}

const SIMILARITY_THRESHOLD = 0.5;

/**
 * Predict CI/follow-up trouble probability for the given diff.
 *
 * @param store - the indexed store
 * @param diffText - unified diff text (e.g. `git diff --staged` output)
 * @param windowDays - how long after a past commit do we still count a
 *                     follow-up as "trouble" (default 14)
 */
export function predict(
  store: MnemeStore,
  diffText: string,
  windowDays = 14,
): CrystalBallPrediction {
  const parsed = parseDiff(diffText);
  const fp = fingerprint(parsed);

  // Pull all commits from the store + their files.
  // Only consider recent-enough commits (skip ancient history).
  const commitRows = store.db
    .prepare(
      `SELECT * FROM commits ORDER BY author_date DESC LIMIT 1000`,
    )
    .all() as Array<Record<string, unknown>>;

  if (commitRows.length === 0) {
    return {
      fingerprint: fp,
      similarN: 0,
      cleanN: 0,
      pClean: 0,
      verdict: "unknown",
      recommendation: "Index the repo first (mneme index) — no historical signal yet.",
    };
  }

  const commits: Commit[] = [];
  for (const r of commitRows) {
    const hash = String(r.hash);
    const files = (
      store.db.prepare("SELECT path FROM file_changes WHERE commit_hash = ?").all(hash) as Array<{ path: string }>
    ).map((x) => x.path);
    commits.push({
      hash,
      shortHash: String(r.short_hash),
      authorName: String(r.author_name),
      authorEmail: String(r.author_email),
      authorDate: String(r.author_date),
      committerDate: String(r.committer_date),
      subject: String(r.subject),
      body: String(r.body || ""),
      parents: r.parents ? String(r.parents).split(/\s+/).filter(Boolean) : [],
      files,
    });
  }

  // Compute similarity for each historical commit.
  const scored: Array<{ commit: Commit; sim: number; fp: DiffFingerprint }> = [];
  for (const c of commits) {
    const cFp = fingerprintFromCommit(c);
    const sim = similarity(fp, cFp);
    if (sim >= SIMILARITY_THRESHOLD) scored.push({ commit: c, sim, fp: cFp });
  }
  scored.sort((a, b) => b.sim - a.sim);

  // Top 50 most-similar commits are our base.
  const similar = scored.slice(0, 50);
  const similarN = similar.length;

  if (similarN === 0) {
    return {
      fingerprint: fp,
      similarN: 0,
      cleanN: 0,
      pClean: 0,
      verdict: "unknown",
      recommendation: "No similar past changes in this repo. Treat as exploratory — small commits, careful review.",
    };
  }

  // Detect regrets ONLY among the similar commits (constrain corpus).
  // Use only strong regret signals (revert/hotfix/fix) — the weaker
  // 'sameFiles' kind is too noisy for failure prediction.
  const similarHashes = new Set(similar.map((s) => s.commit.hash));
  const allRegrets = detectRegrets(commits, { windowDays });
  const troubledHashes = new Set(
    allRegrets
      .filter((r) => r.kind !== "sameFiles" && similarHashes.has(r.shipped.hash))
      .map((r) => r.shipped.hash),
  );

  const cleanN = similarN - troubledHashes.size;
  const pClean = cleanN / similarN;

  // Find most-similar past commit (top of scored list) and its outcome.
  const top = similar[0]!;
  const mostSimilar = {
    hash: top.commit.shortHash || top.commit.hash.slice(0, 7),
    subject: top.commit.subject,
    date: top.commit.authorDate.slice(0, 10),
    outcome: troubledHashes.has(top.commit.hash) ? ("trouble" as const) : ("clean" as const),
  };

  const verdict: CrystalBallPrediction["verdict"] =
    similarN < 5
      ? "unknown"
      : pClean >= 0.85
        ? "clear"
        : pClean >= 0.6
          ? "moderate"
          : "risky";

  const recommendation = buildRecommendation(verdict, similarN, troubledHashes.size, pClean);

  return {
    fingerprint: fp,
    similarN,
    cleanN,
    pClean,
    verdict,
    mostSimilar,
    recommendation,
  };
}

function fingerprintFromCommit(c: Commit): DiffFingerprint {
  // Reconstruct a parsed-diff-like view from commit metadata.
  const files = c.files ?? [];
  const modules = [
    ...new Set(
      files.map((f) => {
        const parts = f.split("/");
        return parts.length >= 2 ? `${parts[0]}/${parts[1]}` : parts[0]!;
      }),
    ),
  ].sort();
  const exts = new Set<string>();
  for (const f of files) {
    const m = f.match(/\.([a-z0-9]+)$/i);
    if (m) exts.add(m[1]!.toLowerCase());
  }
  // Shape from subject conventions.
  const subjectLower = c.subject.toLowerCase();
  const shape: ParsedDiff["shape"] = /^fix|^hotfix|^bug/.test(subjectLower)
    ? "fix"
    : /^refactor/.test(subjectLower)
      ? "refactor"
      : /^docs?|^chore/.test(subjectLower)
        ? "docs"
        : /^test/.test(subjectLower)
          ? "test"
          : /^perf/.test(subjectLower)
            ? "perf"
            : "feat";
  // We don't have line counts; treat as "small" by default.
  const hasTests = files.some((f) => /(\.test\.|\.spec\.|\/tests?\/)/.test(f));
  return { modules, extensions: [...exts].sort(), shape, size: "small", hasTests };
}

function buildRecommendation(
  verdict: CrystalBallPrediction["verdict"],
  similarN: number,
  troubledN: number,
  pClean: number,
): string {
  switch (verdict) {
    case "unknown":
      return `Only ${similarN} similar past change${similarN === 1 ? "" : "s"} in history — too thin to predict. Run tests locally before pushing.`;
    case "clear":
      return `${(pClean * 100).toFixed(0)}% of ${similarN} similar past changes shipped cleanly. Looks like a routine change.`;
    case "moderate":
      return `${troubledN} of ${similarN} similar past changes needed a follow-up fix. Run lint + tests locally first.`;
    case "risky":
      return `${troubledN} of ${similarN} similar past changes needed a follow-up fix (${(pClean * 100).toFixed(0)}% clean rate). Strongly consider splitting this commit + extra review.`;
  }
}
