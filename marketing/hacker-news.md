# Hacker News — "Show HN" draft

## Title (under 80 chars, optimized for HN front page)

```
Show HN: Mneme – codebase memory layer for AI assistants (recall@3 = 87%)
```

Alternative titles, in order of preference:
1. `Show HN: Mneme – local-first git memory for Claude/Cursor (MCP, MIT)`
2. `Show HN: Mneme – ask your repo "why does this exist?" via MCP`

## URL

```
https://github.com/patsa2561-art/mneme-ai
```

## First comment (post immediately after submission)

> Hi HN — I built this because every AI coding assistant I use is brilliant within its context window and amnesiac outside it. Ask Claude or Cursor "why does this code use a retry?" and it looks at the current file and *guesses*. It doesn't read the PR description from 8 months ago that explains the Stripe bug. It hallucinates a plausible reason — and you ship it.
>
> Mneme builds a permanent, queryable memory of your repo (commits + PR/issue bodies + blame + file changes) and exposes it through:
>
> - A CLI for humans (`mneme ask "..."`)
> - An MCP server for AI clients (Claude Code, Cursor, Continue, Copilot)
> - A correlation engine (phase 3) that joins commits with errors from your observability platform/manual JSON — *that* is the moat: nobody else does this
>
> **Quality is measured, not claimed.** I built an eval harness with a golden-set + recall@k/MRR/nDCG metrics and a benchmark suite. The numbers in the README and STATUS.md are real (`npm run status` regenerates them). On the canonical eval set: recall@3 = 86.7%, MRR = 90% with the reranker, query p50 = 1.2 ms.
>
> **Local-first by default.** Ollama is the default embedder; nothing leaves your machine. OpenAI is opt-in for higher quality (~$0.05 to index a 5k-commit repo). Hash fallback works with zero deps.
>
> Stack: TypeScript monorepo (npm workspaces), better-sqlite3 with FTS5 + BLOB vectors, hybrid retrieval (BM25 + cosine fused via Reciprocal Rank Fusion). MCP via the official SDK. CI on Win/macOS/Linux × Node 20/22.
>
> Honest limitations: needs a git repo with non-trivial history. Repos with `wip`/`fix`/`update` commit messages get poor results — and Mneme tells you so instead of hallucinating. Phase 3 (incident correlation) is engine-complete but adapters for your observability platform are still being wired.
>
> MIT-licensed. Happy to answer questions about the retrieval pipeline, the RRF tuning, or anything else.

## Why this title works on HN

- **"Show HN:"** is the established convention; HN search filters for it.
- **"codebase memory layer"** is concrete, not buzzwordy.
- **"(recall@3 = 87%)"** is a number — devs scan for numbers. Specific numbers get more clicks than vague claims.
- Under 80 chars (HN guideline).

## Pre-flight checklist before submitting

- [ ] Repo has at least 1 demo GIF or screenshot in README
- [ ] STATUS.md is up to date (run `npm run status`)
- [ ] All tests passing (`npm test`)
- [ ] LICENSE file present
- [ ] `npm install -g mneme-ai` works (or instructions to clone + build are bulletproof)
- [ ] Demo video / asciinema embedded somewhere reachable in 1 click
- [ ] You have time to reply to comments for the next 4 hours

## What to do after submitting

1. **Reply to every comment in the first 2 hours**, especially critical ones. The algorithm rewards engagement.
2. **Don't argue defensively.** Acknowledge legitimate critique and turn it into a roadmap item. ("Good point — that's tracked in #42.")
3. **Don't ask friends to upvote.** HN detects this and de-ranks aggressively.
4. **Save the URL of any comment thread that produces a useful idea** — you'll want to reference these in v0.2.

## If it lands on the front page

- Star count typically: 50–500 in 24 hours
- Pin a tweet linking to the HN thread
- Cross-post the discussion link to r/programming with a different framing
- Don't ship anything new during the spike — focus on replies + bug reports
