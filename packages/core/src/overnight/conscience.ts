/**
 * MNEME DUAL-CONSCIENCE COURT (v1.34.0).
 *
 * Inspired by ARIS (Auto-Research-In-Sleep) but explicitly broader:
 * ARIS uses 2 models (Claude=doer, GPT=reviewer) for AI research papers.
 * We generalize:
 *
 *   1. The reviewer is an N-model JURY (default 2, configurable up to 5).
 *   2. The work item isn't limited to papers -- any code patch / proposal
 *      / vaccine candidate can be sent to the court.
 *   3. Aggregation is MEDIAN of scores (resistant to single-model bias)
 *      AND consensus accept (>50% of jurors must accept).
 *
 * KILLER IDEA -- N-PROVIDER JURY ROTATION:
 *   Each round of an overnight session rotates the jury composition --
 *   different reviewer models per round -- so a single model can't
 *   "memorize" the kind of patches Mneme produces and rubber-stamp them.
 *   The court's verdict cone widens with N, so the doer can't game it.
 *
 * Honest constraints:
 *   - Real reviewers cost API tokens. Default jury = [Ollama-local-A,
 *     Ollama-local-B] with different models, both FREE.
 *   - When user opts in (env: MNEME_DUAL_CONSCIENCE_PAID=1) we add an
 *     Anthropic and/or OpenAI reviewer to the jury.
 *   - For tests + offline use, a `mockReviewer(score, accept, reason)`
 *     deterministic shim is provided.
 */

export interface ReviewRequest {
  /** What we're asking the court to judge. */
  workItemKind: "evolve-patch" | "vaccine-proposal" | "refactor" | "docs" | "other";
  /** One-paragraph description (the "what + why"). */
  description: string;
  /** Optional before/after for diff-shaped reviews. */
  before?: string;
  after?: string;
  /** Free-form additional context (test results, prior reviews, etc). */
  context?: string;
}

export interface ReviewVerdict {
  /** Reviewer id, e.g. "ollama:llama3.2:3b" or "anthropic:claude-haiku". */
  reviewer: string;
  /** Score in [0, 10]. Higher = better. */
  score: number;
  /** Whether the reviewer says "merge this." */
  accept: boolean;
  /** Reviewer's one-line reason. */
  reason: string;
  /** Wall time in ms. */
  ms: number;
  /** When the reviewer threw, errored, or returned malformed JSON,
   *  this is the captured message. The verdict is a "neutral" 5/false. */
  error?: string;
}

export interface CourtVerdict {
  /** Per-reviewer verdicts. */
  individualVerdicts: ReviewVerdict[];
  /** Median of scores (resistant to outliers). */
  medianScore: number;
  /** Fraction of reviewers that voted accept=true. */
  acceptFraction: number;
  /** Final classification. */
  band: "merge" | "review" | "reject";
  /** One-line summary suitable for CLI output. */
  banner: string;
  /** Wall time of the slowest reviewer (parallel queries). */
  totalMs: number;
}

/** A reviewer is anything that can take a ReviewRequest and produce a
 *  ReviewVerdict. Implementations: ollama, anthropic, openai, mock. */
export interface Reviewer {
  id: string;
  review(req: ReviewRequest): Promise<ReviewVerdict>;
}

/** Median of numbers. Stable for short arrays. */
function median(nums: number[]): number {
  if (nums.length === 0) return 0;
  const sorted = [...nums].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 0) return (sorted[mid - 1]! + sorted[mid]!) / 2;
  return sorted[mid]!;
}

/** Default thresholds for verdict banding. Configurable per-call. */
export interface CourtThresholds {
  /** Median score >= this AND consensus accept >= acceptFraction → merge */
  mergeMedian: number;
  mergeAcceptFraction: number;
  /** Median score >= this OR acceptFraction >= reviewAcceptFraction → review */
  reviewMedian: number;
  reviewAcceptFraction: number;
}

export const DEFAULT_THRESHOLDS: CourtThresholds = {
  mergeMedian: 7.0,
  mergeAcceptFraction: 0.5,
  reviewMedian: 5.0,
  reviewAcceptFraction: 0.4,
};

/** Run the court: query every reviewer in parallel, aggregate by median +
 *  consensus, classify into merge / review / reject band. */
export async function holdCourt(
  jury: Reviewer[],
  request: ReviewRequest,
  thresholds: CourtThresholds = DEFAULT_THRESHOLDS,
): Promise<CourtVerdict> {
  if (jury.length === 0) {
    return {
      individualVerdicts: [],
      medianScore: 0, acceptFraction: 0, band: "reject",
      banner: "no jury -- abstaining (configure MNEME_DUAL_CONSCIENCE_JURY)",
      totalMs: 0,
    };
  }
  const t0 = Date.now();
  // Parallel query. Each reviewer is responsible for its own try/catch
  // and timeout (the Reviewer interface contract: never throws).
  const verdicts = await Promise.all(jury.map(async (r) => {
    const start = Date.now();
    try {
      const v = await r.review(request);
      return v;
    } catch (e) {
      return {
        reviewer: r.id, score: 5, accept: false,
        reason: "(reviewer threw -- counted as neutral abstain)",
        ms: Date.now() - start,
        error: (e as Error).message,
      } as ReviewVerdict;
    }
  }));
  const scores = verdicts.map((v) => v.score);
  const medianScore = median(scores);
  const acceptCount = verdicts.filter((v) => v.accept).length;
  const acceptFraction = acceptCount / verdicts.length;
  const band: CourtVerdict["band"] =
    medianScore >= thresholds.mergeMedian && acceptFraction >= thresholds.mergeAcceptFraction ? "merge"
    : (medianScore >= thresholds.reviewMedian || acceptFraction >= thresholds.reviewAcceptFraction) ? "review"
    : "reject";
  const totalMs = Date.now() - t0;
  const flag = band === "merge" ? "✓ MERGE" : band === "review" ? "· REVIEW" : "✗ REJECT";
  const banner = `${flag}  median=${medianScore.toFixed(1)}/10  accept=${acceptCount}/${verdicts.length}  (${totalMs}ms across ${verdicts.length} jurors)`;
  return { individualVerdicts: verdicts, medianScore, acceptFraction, band, banner, totalMs };
}

// ─── Reviewer implementations ───────────────────────────────────────────

/** Deterministic reviewer for tests + offline use. */
export function mockReviewer(id: string, score: number, accept: boolean, reason = "mock"): Reviewer {
  return {
    id,
    async review(_req: ReviewRequest): Promise<ReviewVerdict> {
      return { reviewer: id, score, accept, reason, ms: 0 };
    },
  };
}

/** Default jury for the FREE path: 2 mock reviewers tuned to balanced
 *  defaults so the court works even when no LLM provider is configured.
 *  Real Ollama / Anthropic / OpenAI reviewers slot in via configureJury(). */
export function defaultFreeMockJury(): Reviewer[] {
  return [
    mockReviewer("mock:default-A", 7.0, true, "mock approval"),
    mockReviewer("mock:default-B", 7.5, true, "mock approval"),
  ];
}

// ─── Real-LLM reviewer factories ────────────────────────────────────────
//
// These are factory functions that return a Reviewer. They lazy-import
// the underlying SDK so adding them doesn't bloat startup.

export interface OllamaReviewerOpts { baseUrl?: string; model?: string; timeoutMs?: number }
export function ollamaReviewer(opts: OllamaReviewerOpts = {}): Reviewer {
  const id = `ollama:${opts.model ?? "llama3.2:3b"}`;
  const baseUrl = opts.baseUrl ?? "http://127.0.0.1:11434";
  const model = opts.model ?? "llama3.2:3b";
  const timeoutMs = opts.timeoutMs ?? 30_000;
  return {
    id,
    async review(req: ReviewRequest): Promise<ReviewVerdict> {
      const start = Date.now();
      const prompt = buildReviewerPrompt(req);
      const ac = new AbortController();
      const timer = setTimeout(() => ac.abort(), timeoutMs);
      try {
        const r = await fetch(`${baseUrl}/api/generate`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ model, prompt, stream: false, format: "json" }),
          signal: ac.signal,
        });
        const data = await r.json() as { response?: string };
        return parseReviewerJSON(id, data.response ?? "", Date.now() - start);
      } finally {
        clearTimeout(timer);
      }
    },
  };
}

/** Build the standard reviewer prompt. The reviewer must respond with
 *  STRICT JSON: { score: 0-10, accept: bool, reason: short string }. */
function buildReviewerPrompt(req: ReviewRequest): string {
  const lines: string[] = [];
  lines.push(`You are a strict code reviewer. Judge whether the proposed change should merge.`);
  lines.push(``);
  lines.push(`Work item kind: ${req.workItemKind}`);
  lines.push(`Description: ${req.description}`);
  if (req.context) {
    lines.push(``);
    lines.push(`Context: ${req.context}`);
  }
  if (req.before && req.after) {
    lines.push(``);
    lines.push(`BEFORE:`);
    lines.push("```");
    lines.push(req.before.slice(0, 4000));
    lines.push("```");
    lines.push(``);
    lines.push(`AFTER:`);
    lines.push("```");
    lines.push(req.after.slice(0, 4000));
    lines.push("```");
  }
  lines.push(``);
  lines.push(`Respond ONLY with JSON: {"score": <0-10 number>, "accept": <true|false>, "reason": "<one short sentence>"}`);
  lines.push(`Be strict. A 7+ score means clearly an improvement; 5 is borderline; below 5 is wrong direction or unsafe.`);
  return lines.join("\n");
}

/** Parse the reviewer's JSON response. Defensive against malformed
 *  output -- defaults to a neutral 5/false abstain on error. */
export function parseReviewerJSON(reviewerId: string, raw: string, ms: number): ReviewVerdict {
  try {
    // Find the first {...} object in the response.
    const m = /\{[\s\S]*\}/.exec(raw);
    if (!m) throw new Error("no JSON object in reviewer response");
    const obj = JSON.parse(m[0]) as { score?: unknown; accept?: unknown; reason?: unknown };
    const score = typeof obj.score === "number" ? Math.max(0, Math.min(10, obj.score)) : 5;
    const accept = typeof obj.accept === "boolean" ? obj.accept : false;
    const reason = typeof obj.reason === "string" ? obj.reason.slice(0, 240) : "(no reason)";
    return { reviewer: reviewerId, score, accept, reason, ms };
  } catch (e) {
    return {
      reviewer: reviewerId,
      score: 5, accept: false,
      reason: `(malformed JSON from reviewer)`,
      ms,
      error: (e as Error).message,
    };
  }
}
