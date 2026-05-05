# Submission 6 — Dev.to / Hashnode / Medium article

**Why this one is the highest-leverage move of all five:** a single article, ranked by Google for the right keywords, brings in users for *months* without you doing anything. The MCP registry PR brings spike traffic; a good article brings sustainable traffic.

═══════════════════════════════════════════════════════════════════════════════

## Where to post

Post on **Dev.to first** (highest SEO authority), then cross-post:
1. **Dev.to** — primary  → https://dev.to/new
2. **Hashnode** — same content, set canonical URL to Dev.to → https://hashnode.com/draft
3. **Medium** — same content, canonical to Dev.to → https://medium.com/new-story

═══════════════════════════════════════════════════════════════════════════════

## Title (pick one)

1. *(Recommended — strong hook)*
   ```
   I gave Claude Code a memory of my repo. Here's what happened, and what I learned about hybrid retrieval.
   ```

2. *(Alternative — technical)*
   ```
   Building a memory layer for AI coding assistants: hybrid retrieval, MCP, and the moment Claude stopped guessing
   ```

3. *(Alternative — story)*
   ```
   Your AI coding assistant has zero memory of your codebase. So I built one.
   ```

═══════════════════════════════════════════════════════════════════════════════

## Tags (Dev.to allows 4)

```
ai, opensource, typescript, productivity
```

(or: `ai, mcp, opensource, devops`)

═══════════════════════════════════════════════════════════════════════════════

## Cover image

Use the μ ASCII art from your GitHub profile, or a clean code-on-dark-background screenshot of `mneme premortem` or `mneme time-machine` output.

If you don't have one ready, the article still publishes fine without a cover.

═══════════════════════════════════════════════════════════════════════════════

## Article body — paste this in Dev.to editor

```markdown
> *"Why does this auth flow use JWT instead of sessions?"*
>
> My AI coding assistant gave a confident, well-formatted, completely generic answer. The actual reason was buried in a 2024-08 commit referencing an incident in our pager. The AI never saw it.

Every conversation I had with my AI assistant started from zero. The codebase had hundreds of commits, dozens of architectural decisions, a graveyard of *"we tried X, it broke prod, we switched to Y"* — and none of that context was reachable from inside the IDE.

So I built **Mneme** — an open-source memory layer that gives AI coding assistants persistent, queryable access to a codebase's history.

This post is about three things:

1. **What hybrid retrieval actually means** when you build it for code (not for documents)
2. **Why confidence scoring matters more than answer quality** — and how I made the AI shut up when it didn't know
3. **What MCP unlocks** when you stop treating AI as a chat interface and start treating it as a tool user

If you're building anything similar, I hope the war stories help.

---

## The architecture in one paragraph

Mneme indexes your git history + code structure into a local SQLite database with FTS5 + a vector column. When the AI asks a question, two retrievers run in parallel: **BM25** over commit messages / PR text / code, and **cosine similarity** over embedding vectors of the same. Their results get fused via **Reciprocal Rank Fusion** (k=60) into a single ranking. A confidence classifier looks at the top-1 score *and the gap to top-2/3* to decide whether to answer or refuse. Only then does an LLM see the top-K hits, with explicit citations, to produce the final answer.

The whole thing runs locally by default. Embeddings via Ollama (offline) or OpenAI (your key). MIT licensed. Exposed to AI clients via the **Model Context Protocol**.

---

## Lesson 1: BM25 alone misses the point. Cosine alone misses the words.

The instinct when building "AI search over a repo" is to reach straight for embeddings. Just chunk everything, embed it, and use cosine similarity. Done.

In practice, that fails on the queries developers actually ask:

- *"Why does the webhook handler retry 3 times?"* → you want a commit that **mentions "retry"** verbatim, not a semantically similar but unrelated paragraph.
- *"How does our auth work?"* → you want a structural understanding, not just keyword matches.

The BM25 + cosine fusion, ranked through RRF, gets this right because:

- **BM25** wins when queries contain rare keywords (variable names, error codes, commit hashes).
- **Cosine** wins when queries are conceptual ("how does X work").
- **RRF** combines the two without needing to calibrate scores between fundamentally different scales.

The fusion code is ~30 lines. Most of the work is choosing the right things to embed (commit subjects, PR titles, code identifiers — *not* full diffs).

---

## Lesson 2: Confidence > correctness

Most retrieval systems will *always* return something — even when "something" is noise. That is the worst possible failure mode. The user trusts the answer because the system gave one.

I added a confidence classifier with two signals:

1. **Static floor** — top-1 score must clear a configurable threshold (FTS hits + cosine).
2. **Adaptive gap** — top-1 must be meaningfully better than top-2 and top-3.

If both fail, Mneme refuses to answer:

> *"I don't have strong context for this. The closest matches were [X, Y, Z] — those don't look directly relevant. You may want to ask differently or check if the relevant history exists in this repo."*

This refusal is the single most valuable feature in the whole tool. An AI assistant that *knows when it doesn't know* is useful. One that confidently fabricates is dangerous.

---

## Lesson 3: MCP changes the whole interaction model

I started with a CLI: `mneme ask "..."` returns an answer. Useful, but you have to leave the AI conversation to use it.

Then I exposed the same tools through an **MCP server**. Now Claude Code, Cursor, Continue, and Codex CLI can call `mneme_ask`, `mneme_why`, `mneme_search_commits` directly during their reasoning loop.

The user-experience difference is enormous. Before:

> **Me:** Why does this auth code use JWT?
> **AI:** *"Probably because JWT is stateless and scalable in distributed systems..."* *(generic guess)*

After (with Mneme as MCP):

> **Me:** Why does this auth code use JWT?
> **AI:** *(calls `mneme_ask "auth JWT"`)*
> **AI:** *"Per commit a3f9b21 from 2024-08, you switched from sessions to JWT after the rate-limit incident referenced in #482. The retry logic at line 47 was added in the hotfix that followed."*

Same model. Same prompt. Different reasoning, because the AI now has memory.

---

## Three commands that surprised me

I built fifteen "killer" commands, but three turned out to be more useful than I expected:

### `mneme premortem "<intent>"`

Before you write any code, ask: *"how often has this kind of change been regretted in this repo?"*. Mneme finds similar past attempts via token-overlap similarity, walks forward in time looking for revert / hotfix / incident signals, and returns a regret probability.

> *"7 of 9 similar past attempts ended badly (78%). Top risk: cache invalidation regression — happened 3× before."*

It cites the actual commits. This is *not* generic AI advice. It's grounded prediction from your own failure history.

### `mneme time-machine <file>`

Groups a file's commits into **eras** — birth, rewrite, evolution, firefight, polish, plateau, twilight — instead of dumping a flat log. Each era has a label pulled from the most informative commit message.

You read 8 epochs and you understand the file's life. Reading 200 commits would have given you nothing.

### `mneme ghost`

Surfaces *ghost code* — files that haunt the repo without doing anything. Combines staleness, low-touch ratio, and TODO density into a single ghostliness score. Catches half-finished features and stale TODOs that survived through every later edit.

---

## What I learned about building dev tools

A few things that would have saved me time:

1. **Tokenizer choice matters more than embedding choice.** I lost a week to FTS5's default `porter unicode61` tokenizer not handling CJK / Thai / Arabic. Migrating the index to `trigram` was painful but unavoidable.

2. **Schema-versioned migrations save your life.** Every time the schema changed, the upgrade path could have nuked users' indexes. Versioned migrations + idempotent backfills meant zero data loss across 11 releases.

3. **Property-based testing > unit tests for retrieval.** I run 16 properties × 10,000 cases each (160k generated cases per CI run) via `fast-check`. Caught three edge cases that hand-written tests missed.

4. **Confidence scoring is the killer feature, not retrieval quality.** The first version had 95th-percentile retrieval and 0% trust. The next version had 90th-percentile retrieval and 100% trust because it refused when uncertain. The drop in raw quality was a win.

---

## Try it

```bash
npx mneme-ai init
npx mneme-ai ask "why does X exist?"
```

Or just tell your AI assistant:

> *"Install Mneme as an MCP server for this repository so you can query my git history and codebase memory."*

Claude Code, Cursor, Codex CLI, Continue — they'll figure out the config file for their environment and wire it up.

GitHub: https://github.com/patsa2561-art/mneme-ai
npm: https://www.npmjs.com/package/mneme-ai

---

## What's next

I'm working on:

- **Doppelganger mode** — channel a contributor's coding style after they leave the team
- **Echo detector** — catch the moment you're about to repeat a mistake you've already made twice
- **Codebase visualization** — interactive 3D view of your repo as a galaxy of files

If any of this resonates, I'd love issues, PRs, or just feedback. This is a solo project — adversarial users are the most valuable thing I can have right now.

Thanks for reading.
```

═══════════════════════════════════════════════════════════════════════════════

## Cross-post (after Dev.to publishes)

### Hashnode

1. https://hashnode.com/draft
2. Paste same content
3. Open the post settings → **"Original article URL"** → paste your Dev.to link
4. Publish

### Medium

1. https://medium.com/new-story
2. Paste same content
3. After publishing → settings → **"Add a canonical link"** → paste Dev.to URL
4. This avoids duplicate-content SEO penalty

═══════════════════════════════════════════════════════════════════════════════

## Why this article will rank

It targets long-tail Google queries:
- "memory layer for AI coding assistant"
- "MCP server typescript example"
- "hybrid retrieval BM25 cosine"
- "give Claude Code memory of repo"
- "AI codebase context git history"

Each of those has near-zero competition right now. One ranked Dev.to post can drive 100-500 visitors / month for *years*.
