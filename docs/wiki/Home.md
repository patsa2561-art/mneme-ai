# 🧠 Mneme — the AI brain for your codebase

> *μνήμη — pronounced **NEE-meh** — Greek for "memory"*

Mneme indexes your **git history, PRs, and decisions** into a queryable local memory layer — then exposes it through a CLI and an MCP server. Your AI assistant stops guessing about your repo's past; it reads it.

This wiki is **Mneme's brain map**. Pick the room you need.

═══════════════════════════════════════════════════════════════════════════════

## 🚪 First time here?

| If you want to… | Go to |
|---|---|
| **Stressed by the long command list?** | **[[Cheatsheet]]** — every command, 1 line each |
| Install + try in 60 seconds | **[[Quickstart]]** |
| See the 1-minute pitch | [README on GitHub](https://github.com/patsa2561-art/mneme-ai#readme) |
| Use without paying for any LLM | **[[Quickstart]]** → "the free path" |
| Plug into Claude Code / Cursor / Codex | **[[MCP-Integration]]** |
| Browse every command as a story | **[[Command-Tour]]** |

═══════════════════════════════════════════════════════════════════════════════

## 🧠 The brain (5 lobes)

Mneme's intelligence is split into 5 modules. Each is independently useful and composable.

| Lobe | What it does | Wiki page |
|---|---|---|
| **🗂 Memory layer** | Index → SQLite → retrieval (BM25 + embeddings + RRF). The substrate everything else builds on. | [[Innovations]] |
| **📦 Hierarchical Memory (HTC)** | World-first compression-as-storage. 50K commits fit in one Claude prompt. | [[Hierarchical-Memory]] |
| **🔬 Speculative Reasoning** | Streaming events · Leviathan citation verifier · DDTree · ConstraintPruner · sessions · wisdom-mutant | [[Speculative-Reasoning]] |
| **🛡 Guardian** | 24/7 self-healing daemon — diagnose + auto-fix policy | [[Guardian]] |
| **🔬 Forensic Code Science** | Bayesian author attribution · ENFSI verbal scale · CWE vuln hunt · insider-threat anomaly | [[Forensic-Code-Science]] |

═══════════════════════════════════════════════════════════════════════════════

## 💎 What makes Mneme one of a kind

23 capabilities no maintained, open-source, local-first tool ships today.

→ 🌌 **[[The-Frontier]]** — the full whitespace map (vs. Cody, Greptile, Cursor, Continue, Sweep, Aider, Copilot Workspace)

═══════════════════════════════════════════════════════════════════════════════

## ⚡ Talk to Mneme like a human

Don't memorize 50 commands. Just describe what you want:

```bash
mneme do "find security issues"
mneme do "is the codebase healthy"
mneme do "who knows about auth"
mneme do "should we ship today"
```

→ 🧠 **[[Smart-Dispatcher]]** — how `mneme do` routes intent to the right sub-engines

═══════════════════════════════════════════════════════════════════════════════

## 📚 Command catalog

| Tier | Where | What's there |
|---|---|---|
| **🆕 Cheatsheet** | [[Cheatsheet]] | **every command, one line each — read this first if it's overwhelming** |
| **Tier 1** — essentials | [[Commands-Tier-1]] | `init`, `index`, `status`, `ask`, `why`, `do`, `guard`, `mcp` |
| **Tier 2** — Quant | [[Commands-Tier-2-Quant]] | drawdown · alpha · vix · greeks · black-swan · moneyball · 10 more |
| **Innovations** | [[Innovations]] | 17+ world-firsts, deep-dive each command with output samples |

═══════════════════════════════════════════════════════════════════════════════

## 🔬 The math (for the curious)

| Topic | Wiki page |
|---|---|
| TDWE · RACB · ADS · CGAR scoring formulas | [[Novel-Algorithms]] |
| STR loci · likelihood ratio · ENFSI verbal scale · CWE class taxonomy | [[Forensic-Code-Science]] |
| HTC compression layers · token math · prompt templates | [[Hierarchical-Memory]] |
| Speculative reasoning trace · streaming events · DDTree heap algorithm | [[Speculative-Reasoning]] |

═══════════════════════════════════════════════════════════════════════════════

## 🍳 Practical workflows

→ 🧑‍🍳 **[[Recipes]]** — multi-command workflows for: onboarding, retros, security review, dependency audit, hot-file hunt, deploy gate, post-mortem

═══════════════════════════════════════════════════════════════════════════════

## 🛠 Reference

| Page | What's there |
|---|---|
| [[Installation]] | Every install path explained (npm, npx, source, Docker) |
| [[Configuration]] | `.mneme/config.json`, env vars, embedder choice |
| [[Privacy]] | Where data lives · secret redaction · LLM data flow · audit log |
| [[FAQ]] | Extended answers to common questions |
| [[Troubleshooting]] | Error messages + concrete fixes |
| [[Releases]] | Full version history (v0.8 → latest) |

═══════════════════════════════════════════════════════════════════════════════

## 🌐 Outside this wiki

- 📦 [npm package](https://www.npmjs.com/package/mneme-ai)
- 💻 [GitHub repo](https://github.com/patsa2561-art/mneme-ai)
- 📋 [CHANGELOG](https://github.com/patsa2561-art/mneme-ai/blob/main/CHANGELOG.md)
- 🗺 [ROADMAP](https://github.com/patsa2561-art/mneme-ai/blob/main/ROADMAP.md)
- 🐛 [Open an issue](https://github.com/patsa2561-art/mneme-ai/issues/new)

═══════════════════════════════════════════════════════════════════════════════

> *"AI assistants don't get smarter. They get better context. Mneme is the filter."*
