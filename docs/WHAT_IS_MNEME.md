# 🧠 What is Mneme?  (the 1-page positioning you can paste anywhere)

## The 1-sentence pitch

> **Mneme is the memory + accountability layer your AI agent needs — so it stops shipping the same bug twice.**

## The 30-second pitch

Your AI tool (Claude Code / Cursor / Codex / Gemini / Copilot) is brilliant at solving today's problem — and *terrible* at remembering yesterday's. It hallucinates files that don't exist. It reintroduces bugs you fixed 18 months ago. It silently undoes your team's hard-won opinions about how the codebase should look.

Mneme is the layer that fixes this. It runs locally on your machine, signs everything with HMAC, and intercepts AI changes BEFORE they ship. If the AI tries something your team paid for in pain (a "scar"), Mneme blocks it. If the AI hallucinates a file path, Mneme catches it. If the AI's confidence is suspicious, Mneme grades it.

Open source. Free forever. MIT. Works with any AI agent that supports MCP.

## The problem (in one paragraph)

AI gives you free junior engineering at infinite scale. But junior engineers without institutional memory ship the *same* bugs the team already fixed. AI is the same — except it does it 100x faster, has zero accountability, and confidently lies when caught. The cost of "AI accidentally undid our scar" compounds across every release. Mneme is the layer that costs zero to add and saves you that compounding bill.

## The solution (in one paragraph)

Mneme keeps four cryptographically-signed corpora as you work: your **project's scars** (PROJECT SOUL), your **past decisions + outcomes** (REPLICA), **patterns solved across all Mneme users** (HIVE — anonymized hashes only), and **per-vendor measured trustworthiness** (BOUNTY). Every AI-proposed change is gated against these. The result is a regression-risk score (0-1) with concrete mitigations — no LLM call needed for the prediction. ~5ms latency on personal corpora. The longer you use Mneme, the smarter the layer gets.

## Who is Mneme for?

| You are | Mneme gives you |
|---|---|
| 👨‍💻 **Solo developer** with Claude Code / Cursor | A safety net that remembers your scars + catches AI hallucinations before commit. |
| 👥 **Team lead / EM** | A signed audit trail of every AI change + project soul rules your team can't accidentally undo. |
| 🏢 **CTO / CISO** | Court-admissible audit chain + 9-pattern DLP + forge-resistant kill switch. |
| 🎨 **Vibe coder** (Bolt / Lovable / Replit / v0) | Plain-English safety wrapper: ship_it / ship_with_note / wait_review / stop_unsafe + 0-10 confidence. |
| 🌐 **Anyone with multi-vendor AI** | A meta-router that picks the cheapest vendor that meets your measured quality bar. |
| 🚀 **A team that ships things** | Predict regressions BEFORE deploy. Track which AI vendor lies most. Detect AI agents colluding. |

## The 3 biggest reasons Mneme exists

1. **AI doesn't remember your team's scars.** It will reintroduce that lodash dep you ripped out 18 months ago.
2. **AI hallucinates with confidence.** Mneme catches "this file exists" / "this version is installed" claims and verifies them.
3. **You're trapped if you can't measure your AI vendor.** Mneme's BOUNTY ledger gives you the per-task per-vendor falseRate so you can swap vendors based on measured truth, not vibes.

## What Mneme is NOT

- Not a competitor to Claude / ChatGPT / Cursor — it's the layer ON TOP OF them.
- Not a SaaS — runs locally; your data never leaves your machine (unless you explicitly opt-in to share anonymized patterns).
- Not a stock predictor or trading oracle — the ALPHA module is honest about market efficiency; it makes AI's financial claims TRACEABLE, not magic.
- Not a code generator — it judges what other AI generates.
- Not an enterprise product with a $$$/seat license — MIT, free forever, opensource.

## The boring proofs

- **9269+ tests passing**, every release graded by **AURELIAN AUDITOR** (HMAC-signed scorecard; CI blocks any feature scoring <80 on delta / world-class / wisdom / wildness).
- **195+ MCP tools** — works with every MCP-aware AI agent.
- **Live demo**: paste any GitHub / GitLab / Bitbucket / Codeberg URL at https://patsa2561-art.github.io/mneme-ai/ and see Mneme analyse it in your browser.
- **Cosmic shared server** at https://cosmic.mneme-ai.space (Cloudflare-edge, free) for cross-vendor handoff — no setup needed.

## How to install (your AI does it for you)

You don't type CLI commands — you tell your AI agent:

> *"Install Mneme in this project, then bootstrap it."*

The AI agent reads `docs/AI_AGENT_CONTRACT.md`, runs `npx mneme install` + `mneme genesis` + `mneme soul init` on your behalf, and reports back. From then on you talk to your AI normally — Mneme runs invisibly, gating every AI change.

## The links

- **Web demo**: https://patsa2561-art.github.io/mneme-ai/
- **GitHub**: https://github.com/patsa2561-art/mneme-ai
- **npm**: https://www.npmjs.com/package/mneme-ai
- **Cosmic**: https://cosmic.mneme-ai.space

## The 1-line elevator pitch by audience

| Audience | One-liner |
|---|---|
| **HN front page** | "Mneme catches AI hallucinations before deploy. Local-first. Free." |
| **Investor / VC** | "We are the W3C of AI provenance — the trust layer everyone routes through." |
| **CTO** | "Mneme makes your team's AI use auditable + your hard-won opinions enforceable." |
| **Solo dev** | "Mneme remembers your scars so AI doesn't re-ship them." |
| **Vibe coder** | "Mneme stops you from accidentally shipping secrets your AI just generated." |
| **Skeptic** | "If your AI never hallucinates and never ignores your team's wisdom, you don't need Mneme. (Nobody is in that camp.)" |

## The brutally honest version

Mneme has 200+ MCP tools because it's been ~6 months of solo iteration. The product surface is *vast* — which is also the problem: people see the dashboard, see 9 menus, and bounce. **The 1-sentence pitch is the fix.**

Mneme is not "an MCP memory layer". Mneme is **the layer that stops AI from making the same mistake twice**. Everything else is an implementation detail.

When you see "what is Mneme?" — answer the question Mneme actually solves, not the list of features that solve it.

---

*Written 2026-05-15 to crystallize Mneme's positioning for v2.16. Free to copy, paste, modify, mash up. If you sell Mneme to your CTO, send the PR with their feedback.*
