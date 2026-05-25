# FAQ

═══════════════════════════════════════════════════════════════════════════════

## Privacy / data

### Does Mneme send my code anywhere?

**No.** Default Ollama → nothing leaves your machine. With `--embedder openai` only commit text + PR text are sent — never source code. Phase 2 entity embeddings send signatures (function/class names, kinds, layer-classification), never bodies.

See [Privacy and Security](Privacy-and-Security) for the full threat model.

### Does Mneme phone home?

**No.** No telemetry. No analytics. No accounts. No usage tracking. No version-check ping.

### Can I run it air-gapped?

**Yes.** `--no-llm` mode + hash embedder = zero network. Or pull Ollama models offline.

═══════════════════════════════════════════════════════════════════════════════

## Quality

### My commit messages are bad. Will it still work?

Mneme uses whatever signal exists. Garbage commits + rich PRs = decent answers. Empty both = honest *"no context found"*. Use `mneme heal` to synthesize WHY notes from diffs.

### What's the recall@3?

Currently ~87% on a 50-question golden set. Run `npm run eval` to see live numbers. PRs that lower recall are rejected by CI.

### Why does Mneme return "no context found" sometimes?

That's the **confidence floor** — designed behavior. Better to say "I don't know" than hallucinate. Specifically: if there are zero FTS hits AND top semantic cosine < 0.4, results are filtered out.

═══════════════════════════════════════════════════════════════════════════════

## Performance

### How big a repo can it handle?

Tested on 100k commits / 8GB DB. Beyond that, swap the in-memory cosine for `sqlite-vec` (one config line — see [Architecture](Architecture)).

### How long does indexing take?

Roughly 50 commits/second with Ollama on CPU. 5,000 commits ≈ 90 seconds. 100k ≈ 30 minutes.

### Can I stop and resume `mneme index`?

Yes — it's idempotent. Re-running picks up where it left off (commits with hashes already in the DB are skipped).

═══════════════════════════════════════════════════════════════════════════════

## Compatibility

### Which languages?

- **Phase 1** (commits/PRs): any language — Mneme reads git, not AST.
- **Phase 2** (entity parsing): TypeScript / JavaScript (full), Python (via `python3 -c <ast>`), Go (regex v1).

### Which AI clients?

Anything that speaks MCP: Claude Code, Cursor, Continue, Copilot Chat. See [MCP Integration](MCP-Integration).

### Which git hosts?

GitHub, GitLab, Bitbucket, Gitea, self-hosted, local-only. PR/issue body hydration auto-detects the host.

═══════════════════════════════════════════════════════════════════════════════

## Costs

### What does it cost to run?

- **Ollama path**: $0 forever. Hardware uses ~500MB RAM during embedding.
- **Hash fallback**: $0 forever. Uses ~50MB RAM. Lower quality.
- **OpenAI path**: ~$0.05 to index 5k commits, then ~$0/day for queries.

### Is there a paid tier?

No. The MIT version ships everything. A future Enterprise tier (SSO, SBOM signing, support SLA, on-prem Helm chart) will exist when there's a paying customer asking for it. Not now.

═══════════════════════════════════════════════════════════════════════════════

## Brand / philosophy

### Why "Mneme"?

Μνήμη is the Greek personification of memory. Sometimes counted among the Muses, sister of Lethe (forgetting). The right ancestor for a tool whose job is to remember.

### How is it pronounced?

**`NEE-meh`** — the "M" is silent, like in "mnemonic". Two syllables.

### How does Mneme relate to Sourcegraph / Sentry / [other tools]?

Mneme is local-first, MIT-licensed, AI-assistant-native (MCP), and applies a quant-finance lens (Sprint 5). We deliberately keep the README focused on Mneme's own design rather than side-by-side comparisons — Mneme stands on its own positioning.

═══════════════════════════════════════════════════════════════════════════════

## Wisdom Mutant Engine

### What is `mneme watch`?

A 24/7 daemon that re-indexes on every commit, calibrates search knobs hourly, and self-evals daily. The "always learning" loop the project's mutant promise actually requires.

### Does it work without an LLM?

Yes. Calibration uses grid search + your own positive feedback. No LLM needed. The synthesis step in `mneme ask` falls back to extractive when no LLM is configured.

### Can I disable it?

Yes — just don't run `mneme watch`. Or set `deterministic: true` in `.mneme/config.json` to disable all LLM-touching paths.

═══════════════════════════════════════════════════════════════════════════════

## Quant features (Sprint 5)

### Why apply finance formulas to git?

Same data structure: time series of events, volatility, drawdowns, "insider" patterns, risk-adjusted returns. 50+ years of quant math is sitting unused for codebases. Sprint 5 ports 10 of those formulas.

### Can I trust the Greeks / Kelly / IV math?

Every formula is in source, with unit tests for invariants. Run `mneme backtest` to verify any predictor against your own history. If lift > 1.5×, it has real edge.

### Are these generic across repos?

Greeks (Δ Γ Θ) are universal. Kelly works on any TD list you provide. Drawdown / black-swan / insider-trading require richer data (incidents, multiple authors). On a 1-author 50-commit repo, most of Sprint 5 will say "insufficient data" — by design.
