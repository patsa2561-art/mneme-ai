# Hacker News — "Show HN" draft

## Title (under 80 chars, optimized for HN front page)

```
Show HN: Mneme – self-improving codebase memory for AI assistants (MCP, MIT)
```

Alternative titles, in order of preference:
1. `Show HN: Mneme – local-first git memory + 24/7 mutant engine (Ollama)`
2. `Show HN: Mneme – the memory layer your AI assistant doesn't have`
3. `Show HN: Mneme – ask your repo "why does this exist?" via MCP`

## URL

```
https://github.com/patsa2561-art/mneme-ai
```

## First comment (post immediately after submission)

> Hi HN — every AI coding assistant I use is brilliant within its context window and amnesiac outside it. Ask "why does this code use a retry?" and it looks at the current file and *guesses* — it can't read the PR from 8 months ago that explains the Stripe bug. It hallucinates a plausible reason and you ship it.
>
> Mneme builds a permanent, queryable memory of your repo (commits + PR/issue bodies + blame) and exposes it via:
>
> - CLI for humans (`mneme ask "..."`)
> - MCP server for AI clients (Claude Code, Cursor, Continue, Copilot)
> - **Wisdom Mutant Engine** — 24/7 daemon that re-indexes on every commit, learns from your feedback (every `mneme ask` records, every `mneme why` is a positive signal), and auto-tunes search knobs against that feedback. Honest "no context found" instead of low-confidence guesses.
> - Phase 3 incident correlation — joins commits with errors from your observability platform / manual JSON. That's the moat.
>
> **Quality is measured, not claimed.** Eval harness with a 50-question golden set, recall@k/MRR/nDCG metrics, regression-gate in CI. Real numbers in STATUS.md (`npm run status` regenerates them). On the canonical eval set: recall@3 ≈ 87%, hit rate 96%, query p50 ≈ 1.3 ms. Negative-case recall is 100% — the system says "no context found" instead of inventing answers.
>
> **Local-first.** Ollama is the default; nothing leaves your machine. OpenAI optional (~$0.05 for 5k commits). Hash fallback for zero-deps. **`--no-llm` deterministic mode** for air-gapped or regulated environments. **Built-in secret redaction** scrubs AWS/GitHub/Stripe/OpenAI/Anthropic/JWT/PEM patterns before any text reaches a remote embedder.
>
> Stack: TypeScript monorepo, better-sqlite3 with FTS5 + BLOB vectors, hybrid retrieval (BM25 + cosine fused via RRF). 244 tests, CI on Win/macOS/Linux × Node 20/22. Multi-language entity parsing: TS/JS, Python (AST), Go (regex v1).
>
> Honest limitations: needs git history with real commit messages OR run `mneme heal` to synthesize WHY notes from diffs. < 50 commits = preview-quality (the tool tells you so). Phase 3 adapters for big observability vendors are real (Sentry, Datadog, GitHub Actions) but have been load-tested only on small fixtures.
>
> MIT. Threat model + privacy doc in `docs/`. Happy to answer questions about the RRF tuning, the auto-calibrator's grid search, or anything else.

## Why this title works on HN

- **"Show HN:"** is the established convention; HN search filters for it.
- **"codebase memory layer"** is concrete, not buzzwordy.
- **"(recall@3 = 87%)"** is a number — devs scan for numbers. Specific numbers get more clicks than vague claims.
- Under 80 chars (HN guideline).

## Pre-flight checklist before submitting

- [ ] v0.9.0 LIVE on npm (`npm view mneme-ai version`)
- [ ] Demo GIF embedded in README (uncomment line 35)
- [ ] STATUS.md up to date (`npm run status`)
- [ ] All 244+ tests passing (`npm test`)
- [ ] `docs/SECURITY.md` and `docs/PRIVACY.md` linked from README
- [ ] LICENSE file present (MIT)
- [ ] `npm install -g mneme-ai` works on a fresh machine (test on 2nd device!)
- [ ] CHANGELOG.md has v0.9.0 entry
- [ ] At least 1 ⭐ on the repo (avoid empty social proof)
- [ ] You have 4 uninterrupted hours after submission for replies

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
