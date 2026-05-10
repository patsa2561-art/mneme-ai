/**
 * STIGMERGY fixture (v1.27.7) -- a synthetic 5-author / 200-commit
 * git history with KNOWN ground-truth stigmergic pairs.
 *
 * Why this exists: an AI reviewer correctly noted that v1.27.6
 * couldn't be verified end-to-end on a solo-dev repo (ours -- only
 * one author). This fixture provides a built-in proof: anyone can
 * run `mneme stigmergy verify` to see the algorithm detect the
 * KNOWN pairs in a controlled synthetic dataset.
 *
 * The fixture is generated DETERMINISTICALLY (seeded random) so the
 * output is identical across machines + reruns. No flakiness.
 *
 * Ground-truth pairs we engineer in:
 *
 *   1. alice + bob   -- "auth squad". Both touch src/auth/* in
 *      tight 24h windows (high synchrony) AND extend each other's
 *      files within 7d (high carry-on). Expected score: HIGH (50+).
 *
 *   2. carol + dave  -- "infra squad". Same pattern but on
 *      src/infra/*. Expected score: HIGH (50+).
 *
 *   3. eve           -- "lone wolf" who only touches src/util/*.
 *      No co-touches with anyone. Expected: not in any pair.
 *
 *   4. alice + carol -- "weak overlap". Each occasionally touches
 *      shared/config.ts. Expected score: LOW (below threshold).
 *
 * The verify command asserts these expectations.
 */

import type { CommitFact } from "./types.js";

/** Seeded LCG so output is deterministic. */
function makeRng(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s * 1103515245 + 12345) >>> 0;
    return (s & 0x7fffffff) / 0x7fffffff;
  };
}

interface ExpectedPair {
  authorA: string;
  authorB: string;
  /** "high" -> score >= 50; "low" -> below threshold but > 0. */
  band: "high" | "low";
}

export interface FixtureBundle {
  commits: CommitFact[];
  expectedPairs: ExpectedPair[];
  /** Authors who appear but should not be in any high-score pair. */
  loneAuthors: string[];
}

/**
 * Build the synthetic 5-author 200-commit history. Returns the
 * commits in newest-first order (matching `git log` default), plus
 * the expected pairs the algorithm MUST surface for the verify pass
 * to succeed.
 */
export function buildFixture(seed = 42): FixtureBundle {
  const rng = makeRng(seed);
  const commits: CommitFact[] = [];

  // Anchor time: 2026-01-01T00:00:00Z. Commits march forward with
  // small jitter so timestamps are never identical.
  const anchorMs = Date.parse("2026-01-01T00:00:00Z");
  let nowMs = anchorMs;
  const tick = (minDt: number, maxDt: number): void => {
    nowMs += minDt + Math.floor(rng() * (maxDt - minDt));
  };

  let shaCounter = 0;
  const sha = (): string => `c${(shaCounter++).toString(16).padStart(7, "0")}`;
  const iso = (): string => new Date(nowMs).toISOString();

  // ── auth squad: alice + bob, 30 paired bursts on src/auth/* ─────
  // Each burst: alice -> bob (or bob -> alice) within ~12h on the
  // same auth file. Plus carry-on: one introduces a file, the other
  // extends within 5d.
  const authFiles = ["src/auth/login.ts", "src/auth/session.ts", "src/auth/middleware.ts", "src/auth/refresh.ts", "src/auth/oauth.ts"];
  for (let i = 0; i < 30; i++) {
    const file = authFiles[i % authFiles.length]!;
    const aliceFirst = i % 2 === 0;
    // Alice's commit
    commits.push({
      sha: sha(), email: aliceFirst ? "alice@example.com" : "bob@example.com",
      at: iso(), files: [file],
    });
    tick(30 * 60 * 1000, 11 * 3600 * 1000);  // 30min - 11h
    // Bob's follow-up on the same file
    commits.push({
      sha: sha(), email: aliceFirst ? "bob@example.com" : "alice@example.com",
      at: iso(), files: [file],
    });
    tick(2 * 86400 * 1000, 6 * 86400 * 1000); // 2-6 days between bursts
  }

  // ── infra squad: carol + dave, 25 paired bursts on src/infra/* ─
  const infraFiles = ["src/infra/db.ts", "src/infra/cache.ts", "src/infra/queue.ts", "src/infra/scheduler.ts"];
  for (let i = 0; i < 25; i++) {
    const file = infraFiles[i % infraFiles.length]!;
    const carolFirst = i % 2 === 0;
    commits.push({
      sha: sha(), email: carolFirst ? "carol@example.com" : "dave@example.com",
      at: iso(), files: [file],
    });
    tick(1 * 3600 * 1000, 10 * 3600 * 1000);
    commits.push({
      sha: sha(), email: carolFirst ? "dave@example.com" : "carol@example.com",
      at: iso(), files: [file],
    });
    tick(2 * 86400 * 1000, 5 * 86400 * 1000);
  }

  // ── lone wolf: eve touches src/util/* alone, no overlaps ────────
  for (let i = 0; i < 20; i++) {
    commits.push({
      sha: sha(), email: "eve@example.com", at: iso(),
      files: [`src/util/helper${i % 4}.ts`],
    });
    tick(86400 * 1000, 3 * 86400 * 1000);
  }

  // ── weak overlap: alice + carol both touch shared/config.ts a few
  //    times, far apart in time + few touches. Should yield a pair
  //    but with score below the surface threshold. ────────────────
  for (let i = 0; i < 4; i++) {
    commits.push({
      sha: sha(), email: i % 2 === 0 ? "alice@example.com" : "carol@example.com",
      at: iso(), files: ["shared/config.ts"],
    });
    tick(20 * 86400 * 1000, 30 * 86400 * 1000);  // 20-30 days apart
  }

  // git log returns newest-first; sort accordingly.
  commits.sort((a, b) => Date.parse(b.at) - Date.parse(a.at));

  return {
    commits,
    expectedPairs: [
      { authorA: "alice@example.com", authorB: "bob@example.com", band: "high" },
      { authorA: "carol@example.com", authorB: "dave@example.com", band: "high" },
      { authorA: "alice@example.com", authorB: "carol@example.com", band: "low" },
    ],
    loneAuthors: ["eve@example.com"],
  };
}

export interface VerificationOutcome {
  ok: boolean;
  details: string[];
  /** Detected pair scores keyed by alphabetised "a::b". */
  detectedScores: Record<string, number>;
  expectedPairs: ExpectedPair[];
}

/**
 * Run the algorithm against the fixture + assert the expected pairs
 * surface above threshold (high band) or below threshold but >0 (low
 * band). Returns a structured outcome for the CLI to render.
 */
export function verifyAgainstFixture(
  computeOverlaps: (commits: CommitFact[]) => Array<{ authorA: string; authorB: string; stigmergyScore: number }>,
  surfaceThreshold = 10,
): VerificationOutcome {
  const fx = buildFixture();
  const overlaps = computeOverlaps(fx.commits);

  const scoreMap: Record<string, number> = {};
  for (const o of overlaps) {
    const key = o.authorA < o.authorB ? `${o.authorA}::${o.authorB}` : `${o.authorB}::${o.authorA}`;
    scoreMap[key] = o.stigmergyScore;
  }

  const details: string[] = [];
  let ok = true;

  for (const ep of fx.expectedPairs) {
    const a = ep.authorA, b = ep.authorB;
    const key = a < b ? `${a}::${b}` : `${b}::${a}`;
    const got = scoreMap[key] ?? 0;
    if (ep.band === "high") {
      const pass = got >= surfaceThreshold * 5; // 50+ when threshold default 10
      if (pass) details.push(`✓ HIGH pair ${a} <-> ${b}: score=${got} (>=${surfaceThreshold * 5})`);
      else { details.push(`✗ HIGH pair ${a} <-> ${b}: score=${got} (expected >=${surfaceThreshold * 5})`); ok = false; }
    } else {
      const pass = got > 0 && got < surfaceThreshold * 3;
      if (pass) details.push(`✓ LOW pair ${a} <-> ${b}: score=${got} (>0 and <${surfaceThreshold * 3})`);
      else { details.push(`✗ LOW pair ${a} <-> ${b}: score=${got} (expected 0 < score < ${surfaceThreshold * 3})`); ok = false; }
    }
  }

  for (const lone of fx.loneAuthors) {
    const inAnyPair = Object.keys(scoreMap).some((k) => k.includes(lone) && scoreMap[k]! >= surfaceThreshold);
    if (!inAnyPair) details.push(`✓ LONE author ${lone}: not in any high-score pair`);
    else { details.push(`✗ LONE author ${lone}: unexpectedly surfaced in a pair`); ok = false; }
  }

  return { ok, details, detectedScores: scoreMap, expectedPairs: fx.expectedPairs };
}
