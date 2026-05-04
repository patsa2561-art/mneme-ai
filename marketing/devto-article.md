# Dev.to article — long-form

> Dev.to rewards depth, code examples, and lessons learned. 1,500–2,500 words is the sweet spot.

## Title

```
How I built a memory layer for AI coding assistants — the retrieval pipeline behind Mneme
```

## Tags

```
ai, javascript, typescript, opensource
```

## Cover image

Use the demo GIF (or a screenshot of `mneme ask` output) — Dev.to articles with cover images get 2-3x the views.

---

## Article body

# How I built a memory layer for AI coding assistants — the retrieval pipeline behind Mneme

A few months ago I noticed that every AI coding assistant I used was brilliant within its context window and amnesiac outside it.

I'd ask Claude or Cursor: *"why does this code use a retry around `stripe.charges.create`?"*

And it would look at the current file and **guess**. It didn't read the PR description from 8 months ago that explained the Stripe webhook bug. It didn't see the incident report that triggered the fix. It hallucinated a plausible reason — and I, in my hurry, would ship it.

This wasn't a model problem. The model was doing exactly what it was trained to do: produce a continuation that reads like a good answer. When the model lacks the actual context, the only way to produce a good answer is to invent context that fits.

The fix isn't a smarter model. It's giving the model the actual context.

So I built **Mneme** — a CLI + MCP server that builds a permanent, queryable memory of a git repository. Think of it as a RAG layer specifically for git history. This article is about the retrieval design.

## The corpus

Source code answers the question of *what* the program does. Git answers the question of *why*. Mneme indexes:

- Commit subjects and bodies
- Pull request titles and descriptions
- Issue bodies (referenced via patterns like `#42` or `GH-7`)
- Per-file `git blame` data
- File-level changes (additions/deletions per commit)

Each commit becomes a node; each chunk (subject, body, PR description) becomes a vector + an FTS row. The whole memory lives in a single SQLite file at `.mneme/mneme.db` inside your repo.

## The retrieval pipeline

The pipeline runs in three stages:

```
question → embed → vector top-K
              │
              ├──→ FTS top-K (BM25)
              │
              ▼
         RRF fusion (k=60)  →  group by commit  →  citations
```

### Stage 1: Lexical (BM25 via SQLite FTS5)

```typescript
const stmt = db.prepare(`
  SELECT c.id, c.commit_hash, c.text, c.kind,
         bm25(chunks_fts) AS bm25
  FROM chunks_fts
  JOIN chunks c ON c.id = chunks_fts.id
  WHERE chunks_fts MATCH ?
  ORDER BY bm25 ASC
  LIMIT ?
`);
```

BM25 is the unsung hero of code search. Code uses specific tokens — function names, error types, ticket IDs, library names — that dense embeddings systematically under-weight. A query like `"SENTRY-1287"` will get perfect results from BM25 and disappointing results from a vanilla cosine search.

### Stage 2: Semantic (vector cosine)

I considered three embedding providers and settled on a swap-able interface:

```typescript
export interface EmbeddingProvider {
  readonly name: string;
  readonly dimensions: number;
  embed(texts: string[]): Promise<Float32Array[]>;
}
```

Default is Ollama with `nomic-embed-text` (768 dims, free, local). OpenAI's `text-embedding-3-small` is opt-in. Both produce embeddings I store as `BLOB` columns next to the FTS rows.

For the cosine search itself I went the simple route — load all vectors into memory, score every candidate. Profiles cleanly under 1M chunks. For larger repos there's a documented migration path to `sqlite-vec`.

### Stage 3: Reciprocal Rank Fusion

This is where most hybrid systems trip. You have BM25 scores (unbounded, depends on corpus statistics) and cosine similarities (bounded `[-1, 1]`). Weighted sums of these never align — you tune `α * bm25 + (1-α) * cos` and the right `α` shifts every time the corpus changes.

**Reciprocal Rank Fusion sidesteps the scale problem entirely** by ignoring scores and using ranks:

```typescript
function rrf(rank: number, k = 60): number {
  return 1 / (k + rank);
}

// For each result, sum its RRF contribution from every list it appears in:
const fused = new Map();
for (const r of bm25Results) {
  upsert(fused, r.chunk, lexicalWeight * rrf(r.rank));
}
for (const r of vectorResults) {
  upsert(fused, r.chunk, semanticWeight * rrf(r.rank));
}
```

The constant `k = 60` is the TREC default and a great starting point — it's also the lower bound for the [paper that introduced RRF](https://plg.uwaterloo.ca/~gvcormac/cormacksigir09-rrf.pdf).

## The reranker

First-stage retrieval should optimize **recall** — make sure the right answer is *somewhere* in the top 50. The reranker then optimizes **precision** — pick the top 3 from those 50.

I shipped a deliberately simple `QueryDensityReranker`:

```typescript
const density = countOverlap(queryTerms, docTokens) / queryTerms.size;
const score = α * originalScore + (1 - α) * density;
```

It's not a cross-encoder. It's just "how many query terms appear in this candidate, after stopword removal." On my eval set this lifted **precision@3 by +2.2 percentage points** — a free win, no extra deps, sub-millisecond. Cross-encoders are coming in v0.2 but the bar to beat is now nontrivial.

## Measuring quality

The single most important thing I built was the **eval harness**:

```bash
npm run eval
```

It runs each variant against a 15-question golden set on a deterministic fixture repo and reports recall@1, recall@3, recall@10, MRR, nDCG@10, and per-category metrics:

```
Variant      recall@1   recall@3   MRR        nDCG@10
─────────── ────────── ────────── ────────── ──────────
baseline     86.7%      80.0%      88.3%      87.4%
lex-only     86.7%      86.7%      88.9%      87.8%
sem-heavy    86.7%      80.0%      88.3%      87.4%
balanced     86.7%      80.0%      88.3%      87.4%
reranked     86.7%      86.7%      90.0%      88.7%   ← winner
```

CI runs this on every PR. Any regression on any core metric blocks merge. This is what separates toys from tools — the moment quality becomes a regression metric, every change is forced to defend itself.

Surprises from the harness:

1. **lex-only beat sem-heavy** on the hash-fallback embedder. The hash trick produces vectors that are too noisy for the semantic signal to dominate. With Ollama or OpenAI this flips. The harness made this visible without me guessing.
2. **The reranker improved recall@3** from 80% → 86.7%. I expected it to lift precision but not recall — turns out by surfacing the right candidate from the top-30 instead of top-10, it also rescued some cases.
3. **The "negative" category** (questions with no expected answer) reliably scored 0% — and that's correct. Mneme should return nothing for those, and the eval harness should reward the silence.

## The bug the math caught

While building the temporal correlation engine (phase 3, joining commits with incidents), I had this scoring formula:

```typescript
const weight = clamp01(temporal * 0.6 + overlap * 0.5);
```

The unit test caught it: any reasonably good match got `weight = 1.0`, and the engine couldn't rank anything that saturated. The fix was a **convex combination** with weights that sum to 1:

```typescript
const overlapWeight = 0.4;
const temporalWeight = 1 - overlapWeight;  // 0.6
const weight = clamp01(temporal * temporalWeight + overlap * overlapWeight);
```

Now `max possible = 0.6 + 0.4 = 1.0`, and the engine differentiates monotonically in both inputs.

This is the kind of bug that is invisible without tests. Most retrieval failures are math failures wearing the costume of intelligence. Choose your formulas with care.

## What's next

Phase 1 (archaeology) is shipped. Phase 2 (semantic clones) and Phase 3 (incident correlation — joining commits with Sentry/Datadog) have engine code in place; the adapters land in v0.2. Phase 4 (D3 temporal graph) is sketched.

Repo, code, eval methodology, all metrics: **https://github.com/patsa2561-art/mneme-ai**

MIT, TypeScript, local-first (Ollama default). MCP-compatible — drop it into Claude Code, Cursor, Continue, or any MCP-speaking client.

---

*If you want a daily dose of code-archaeology philosophy, the CLI ships [thirteen meditations](https://github.com/patsa2561-art/mneme-ai/blob/main/MEDITATIONS.md) on memory, retrieval, and what AI assistants forget. Run `mneme wisdom` for today's.*

```bash
$ mneme wisdom

  ╭───────────────────────────────────────────╮
  │  meditation 4 of 13                       │
  ╰───────────────────────────────────────────╯

  On Hallucination

  When an AI assistant cannot see why a piece of code exists, it does
  not say so. It guesses. The guess sounds plausible because plausibility
  is what language models optimize.

  Hallucination is not a bug in the model. It is the absence of context,
  dressed up as confidence.

  — An AI without memory is a confident liar by default.
```

---

## Why this works on Dev.to

- Long-form (1,500+ words) — Dev.to favors depth
- Code examples are real, runnable
- "Lessons learned" section is what dev readers come for
- Closing CTA ties to the unique `mneme wisdom` differentiator
- Title is search-optimized for "AI coding assistants"

## Tag strategy

- `#ai` — broad reach
- `#javascript` — broader than typescript on dev.to
- `#typescript` — your actual stack
- `#opensource` — engages the OSS-positive crowd

## Distribution

- Cross-post to your personal blog if you have one (canonical URL setting on Dev.to handles this)
- Share the URL in the Reddit and Twitter threads as the long-form follow-up
