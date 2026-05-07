# The Frontier — what makes Mneme one of a kind

> After researching the landscape of git, code-search, and AI-coding tools, every capability below occupies whitespace where **no maintained, open-source, local-first tool ships it today.**
>
> **v0.36 update — five new Originals push the count from 23 to 28.** See the dedicated [[Originals]] page for deep-dives + sample output.

═══════════════════════════════════════════════════════════════════════════════

## 17 world-firsts (v0.17 baseline)

| # | Capability | Mneme command |
|---|---|---|
| 1 | Author social graph with semantic edges | ✅ `network` |
| 2 | Semantic clustering of commit messages *(NLP)* | ✅ `cluster` |
| 3 | Predictive co-edit detection | ✅ `oracle` |
| 4 | Exportable, history-derived developer fingerprint | ✅ `dna` |
| 5 | Engineering management dashboard | ✅ `manage` |
| 6 | Universal codebase export *(bundled artifact)* | ✅ `bundle` |
| 7 | File evolution narrated as eras | ✅ `time-machine` |
| 8 | Codebase narrative documentary | ✅ `chronicle` |
| 9 | Predictive regret risk grounded in YOUR repo | ✅ `premortem` |
| 10 | Multi-signal ghost-code detection | ✅ `ghost` |
| 11 | Maintained codebase graph data layer | ✅ `constellation` |
| 12 | Topical drift over time *(feature/refactor/firefight)* | ✅ `drift` |
| 13 | **Audit-grade Q&A — explicit hallucination guard** | ✅ `ask --audit` |
| 14 | **Bayesian author attribution with ENFSI verbal scale** | ✅ `forensics match/attribute` |
| 15 | **CWE-aligned vulnerability hunt across history** | ✅ `forensics vulns` |
| 16 | **Insider-threat anomaly detection per author baseline** | ✅ `forensics anomaly` |
| 17 | **24/7 self-healing daemon with auto-fix policy** | ✅ `guardian` |

═══════════════════════════════════════════════════════════════════════════════

## 6 more added in v0.20 → v0.24

| # | Capability | Mneme command |
|---|---|---|
| 18 | **Smart natural-language dispatcher** — describe intent, Mneme picks tools | ✅ `do "find security issues"` |
| 19 | **Pre-commit always-on guard** — blocks secrets + vulns before push | ✅ `guard --install` |
| 20 | **Self-healing free-LLM fallback chain** — provider-health-aware cooldowns | ✅ `ask` (auto via ResilientEnricher) |
| 21 | **Streaming reasoning trace** — see `consider/accept/prune/verify` in real time | ✅ `ask --stream` |
| 22 | **Best-first commit-ancestor tree search** — DDTree-style budget exploration | ✅ `why` (DDTree-routed) |
| 23 | **Compression-as-storage memory layer** — 50K commits fit in one Claude prompt | ✅ `htc-build` + `htc-stats` |

═══════════════════════════════════════════════════════════════════════════════

## 5 Originals shipped in v0.36 — see [[Originals]] for deep-dive

| # | Capability | Mneme command |
|---|---|---|
| 24 | **TODO debt as a per-author flow ledger** — incurred minus settled, age-compounded | ✅ `karma` |
| 25 | **20-axis repo MRI with z-scores against typical OSS** — outliers surface in one glance | ✅ `repo-mri` (alias `mri`) |
| 26 | **Counterfactual line palimpsest** — what did this single line lock in downstream? | ✅ `palimpsest --counterfactual` |
| 27 | **Author-voice fingerprint + voice-templating rewriter** — stylometric, deterministic | ✅ `cognitive-twin` (alias `twin`) |
| 28 | **Dual-jury PR review** — prosecution + defense + verdict, all grounded in real history | ✅ `conscience --dual-jury` |

═══════════════════════════════════════════════════════════════════════════════

## How we know it's still whitespace

For every row above, we cross-checked against the most plausible competitors:

- **Sourcegraph Cody / Greptile** — code retrieval, but no per-author DNA, no ENFSI attribution, no hierarchical compression
- **Cursor / Continue / Cline** — context window of open files, no persistent codebase memory layer
- **Sweep / Aider / Devin** — operate on PRs / one task; no long-memory for the codebase
- **GitHub Copilot Workspace** — agentic but proprietary, no persistent compressed memory, no forensic primitives
- **Codeium / Tabnine / Supermaven** — IDE-side code completion only

If you find a maintained tool that ships any row above, [open an issue](https://github.com/patsa2561-art/mneme-ai/issues/new) — we'd genuinely like to add a comparison column.

═══════════════════════════════════════════════════════════════════════════════

## Honest scope

Mneme is **not** a code-completion tool, **not** a chat agent, **not** an IDE plugin. It's a **memory layer** that:

1. Indexes your git history into local SQLite
2. Pre-compresses it for LLM consumption (HTC, v0.24)
3. Exposes it via CLI + MCP server

Pair it with Claude Code / Cursor / Codex / Continue / Cline / Zed — those tools become smarter because they finally see your 6 years of decisions, not just the open files.

═══════════════════════════════════════════════════════════════════════════════

## Related

- 🆕 [[Originals]] — the five world-firsts shipped in v0.36
- 🌟 [[Innovations]] — deep-dive each command with output samples
- 📐 [[Novel-Algorithms]] — TDWE / RACB / ADS / CGAR scoring math
- 🔬 [[Forensic-Code-Science]] — STR loci, likelihood ratio, ENFSI verbal scale
- 📦 [[Hierarchical-Memory]] — compression-as-storage architecture
- ⚙ [[Speculative-Reasoning]] — streaming events + Leviathan citation verifier
- 🛡 [[Guardian]] — the 24/7 self-healing daemon
