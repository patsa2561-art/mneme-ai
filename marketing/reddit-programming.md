# Reddit — r/programming draft

> r/programming hates marketing. Lead with the technical interest, not the product. The product can be the answer at the bottom.

## Title

```
The retrieval pipeline behind a "why does this code exist?" tool: BM25 + cosine fused with Reciprocal Rank Fusion
```

Alternative titles:
1. `Why I gave up on pure-vector search for a code-archaeology tool (and what worked)`
2. `Built an MCP server that lets Claude/Cursor query git history. Here's the retrieval design.`

## Body

> A few months ago I got tired of asking AI coding assistants "why does this function use a retry?" and getting plausible-sounding fiction back. The model can't see the PR from 8 months ago that explains the Stripe bug — it just guesses.
>
> I built a tool called Mneme that builds a queryable memory of a git repo (commits + PR bodies + blame) and serves it through an MCP server so Claude/Cursor/Continue can query it.
>
> The interesting part isn't the product — it's the retrieval pipeline. Some lessons:
>
> **1. Pure vector search underperforms hybrid for code.** Commit messages have specific tokens (function names, error types, ticket IDs) that dense embeddings under-weight. BM25 nails these. Cosine catches the semantic neighbors. Neither alone is enough.
>
> **2. Reciprocal Rank Fusion (RRF) beats score normalization.** I tried weighted sums of BM25 scores + cosine similarity. The scales never align — BM25 is unbounded, cosine is [-1, 1]. RRF is `1 / (k + rank)` per list, summed across lists. The constant `k = 60` (TREC default) is a great starting point.
>
> **3. A reranker matters more than people think.** First-stage retrieval is tuned for recall (cast wide). A simple query-density reranker — "how many query terms appear in this candidate" — lifted precision@3 by +2.2 percentage points on my eval set. Cross-encoders would do more but at higher latency.
>
> **4. The temporal correlation engine for incidents needs convex combinations, not weighted sums with clamps.** I had a scoring formula `clamp01(temporal * 0.6 + overlap * 0.5)` that saturated to 1.0 for any reasonably matching pair, destroying ranking. Switched to `temporal * 0.6 + overlap * 0.4` (sums to 1, no clamp needed). Tests caught it.
>
> Eval harness was the highest-leverage thing I built. 15-question golden set + recall@k/MRR/nDCG metrics. Every commit on main runs against it in CI; any regression blocks merge. Recall@3 = 86.7%, MRR = 90% with reranker.
>
> Code, eval methodology, all metrics: https://github.com/patsa2561-art/mneme-ai
>
> MIT, TypeScript, local-first (Ollama default).

## Why this works on r/programming

- Leads with technical insight (RRF, hybrid retrieval, convex combinations)
- The product mention is at the bottom, almost an aside
- Includes specific numbers and trade-offs other engineers can argue about
- Invites disagreement (which drives engagement)

## What NOT to do

- ❌ Don't post if you don't have time to reply for 4 hours
- ❌ Don't title it "I built X" — r/programming hates that
- ❌ Don't include screenshots of the README (they look like marketing)
- ❌ Don't reply defensively to "this already exists" comments — acknowledge differences honestly

## Reply patterns

If someone says **"this is just RAG"**:
> Yes, it's RAG. The interesting part is the corpus — git history + PR bodies + incident reports — not the retriever. Most RAG-on-code projects index source files and miss the WHY entirely.

If someone says **"Sourcegraph already does this"**:
> Sourcegraph indexes source. It doesn't index PR/issue bodies as first-class objects, doesn't fuse with git blame, and doesn't speak MCP. Different layer of the stack.

If someone says **"why not just grep git log?"**:
> Because semantic queries fail there. `git log --grep "stripe"` finds commits mentioning Stripe. It doesn't find the commit that fixed a bug *caused by* Stripe behavior, in a body that doesn't include the word "stripe." That's what embeddings are for.
