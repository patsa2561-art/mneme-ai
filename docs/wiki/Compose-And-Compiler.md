# `mneme compose` — natural-language → molecule plan

> v0.41 ships the molecule **compiler**: a planner that turns a free-form intent ("find SQL injection in payment files") into a concrete pipeline of registered atoms / molecules from the [[Periodic-Table]]. The plan is cached, cost-estimated, and auditable before execution. AI tools through MCP read the plan as JSON.

═══════════════════════════════════════════════════════════════════════════════

## Why

`mneme do "<query>"` already exists — it's a smart dispatcher that picks one of the existing 75 commands. `mneme compose` is the next layer: instead of choosing one command, it **assembles a custom pipeline** from the periodic table. AI tools no longer need to memorise the command bag; they read the catalog at runtime and let the compiler figure out a plan.

═══════════════════════════════════════════════════════════════════════════════

## Two modes

```bash
# Rule-based (default, no LLM, sub-millisecond)
mneme compose "find SQL injection in payment files"

# LLM-augmented (opt-in, uses the configured enricher)
mneme compose "find SQL injection in payment files" --llm

# Machine-readable for AI / MCP
mneme compose "..." --json
```

### Rule-based pipeline (always available)

1. **Tokenise** the intent + extract verb + domain signals.
2. **Score every catalog manifest** against the signals (tag overlap × token overlap, with a kind-bias so molecules and compounds rank above raw elements).
3. **Assemble a plan**: pick the highest-scoring molecule (or compound) as the trunk; pull in 1-2 supporting atoms that share tags.
4. **Cost-estimate** the plan as `sum(ms_p50)` across steps.

### LLM refinement (opt-in)

When `--llm` is passed, the rule-based plan becomes a *seed*. The configured enricher (Ollama / Groq / OpenAI / etc.) is asked to refine it: drop irrelevant steps, re-order, fill in `args`. The LLM sees the full catalog so it can swap in primitives the rule-based scorer missed. If the LLM returns malformed JSON or is unavailable, the rule-based seed is used unchanged.

═══════════════════════════════════════════════════════════════════════════════

## Output shape

```json
{
  "intent": "find SQL injection in payment files",
  "steps": [
    { "id": "stack.profile", "args": {}, "why": "detect tech stack" },
    { "id": "git.log", "args": { "maxCommits": 500 }, "why": "scan history" },
    { "id": "score.bayesian.tech-aware", "args": {}, "why": "filter false positives" }
  ],
  "estimatedMsP50": 70.0,
  "source": "rule-based",
  "trace": [
    "trunk: stack.profile (score 5.0)",
    "support: git.log (score 5.0)"
  ]
}
```

═══════════════════════════════════════════════════════════════════════════════

## The molecule cache

Every plan is stored at `.mneme/molecule-cache.json` keyed by a SHA-256 of the canonicalised intent (lowercase + collapsed whitespace). Re-running the same intent reuses the stored plan in microseconds — no LLM call, no scoring loop. Each cache entry tracks `hits`, `firstSeen`, `lastSeen`. The v0.42 Second-Brain layer will read this file to **promote frequently-used plans into named commands** (e.g. a plan with 50+ hits gets a one-liner alias auto-generated).

```bash
mneme compose "..." --no-cache    # force a fresh plan
```

═══════════════════════════════════════════════════════════════════════════════

## Honest scope

- **v0.41 ships the planner.** `mneme compose` shows the plan; it does **NOT** yet execute it. For now you copy the step ids into individual command invocations.
- **v0.42 ships execution.** The plan becomes runnable as a single `mneme compose --execute "..."` call.
- **v0.42 also ships promotion.** Cached plans with frequent hits get auto-promoted into named commands.

═══════════════════════════════════════════════════════════════════════════════

## Related

- 🧪 [[Periodic-Table]] — the catalog of primitives the compiler chooses from
- 🧠 [[Smart-Dispatcher]] — `mneme do` (predecessor; picks one existing command)
- 🤖 [[MCP-Integration]] — how AI tools see Mneme's catalog at runtime
