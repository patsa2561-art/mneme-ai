<div align="center">

<img src="./assets/title.svg" alt="μνήμη · Mneme" width="640">

# Memory · Truth · Consensus — for every AI agent

<sub><b>μνήμη · NEE-meh · Greek for "memory."</b> The brain that bolts onto Claude Code / Cursor / Cline / Codex / Continue / ChatGPT / Gemini. Remembers across sessions + vendors. Refuses to hallucinate. Cross-vendor Byzantine consensus when it matters. <b>Local-first. Vendor-neutral. MIT.</b></sub>

<br/><br/>

<a href="https://www.npmjs.com/package/mneme-ai"><img alt="npm" src="https://img.shields.io/npm/v/mneme-ai?label=npm&color=cb3837&logo=npm&style=for-the-badge" /></a>
<a href="docs/AI_AGENT_CONTRACT.md"><img alt="MCP tools" src="https://img.shields.io/badge/MCP%20tools-820%2B-c084fc?style=for-the-badge" /></a>
<a href="docs/FUNCTIONS-EN.md"><img alt="GAUNTLET" src="https://img.shields.io/badge/PEAK%20GAUNTLET-100%2F100-2da44e?style=for-the-badge" /></a>
<a href="docs/FUNCTIONS-EN.md"><img alt="TRUTH GATE" src="https://img.shields.io/badge/TRUTH%20GATE-100%2F100-2da44e?style=for-the-badge" /></a>
<a href="LICENSE"><img alt="license MIT" src="https://img.shields.io/badge/license-MIT-blue?style=for-the-badge" /></a>

<br/><br/>

### 📖 Start here

<table>
<tr>
<td align="center" width="33%"><a href="docs/FUNCTIONS-EN.md"><b>📘 Functions (EN)</b></a><br/><sub>What Mneme does, in 5 minutes</sub></td>
<td align="center" width="33%"><a href="docs/FUNCTIONS-TH.md"><b>📗 ฟังก์ชั่น (ไทย)</b></a><br/><sub>อ่านจบใน 5 นาที</sub></td>
<td align="center" width="33%"><a href="docs/AI_AGENT_CONTRACT.md"><b>🤖 AI Agent Contract</b></a><br/><sub>Deep install + protocol</sub></td>
</tr>
</table>

</div>

---

## Install (60 seconds)

```bash
npm install -g mneme-ai
mneme init                  # one-time per repo
mneme mcp --install         # auto-detects Claude Code / Cursor / Codex / Continue
```

Restart your AI tool. First MCP call: `mneme.welcome` → loads install handoff + recent changes.

For browser polygraph (live dots on claude.ai / chatgpt.com / gemini): `mneme polygraph autosetup`.

---

## What Mneme does

Mneme is **11 primitives** every AI agent can call. Each has discrete pinned tests, HMAC-chained ledgers, and offline verification.

| # | Primitive | One-line | Full doc |
|---|-----------|----------|----------|
| 1 | 🧠 **Memory** | Q&A over your repo's history; auto-incremental on every git commit. | [EN](docs/FUNCTIONS-EN.md#2-memory--qa-over-your-repo) · [TH](docs/FUNCTIONS-TH.md#2-memory--qa-repo) |
| 2 | ✅ **Truth** | ACGV pipeline + hyperbole detector + vaccine cache. Refuses to hallucinate. | [EN](docs/FUNCTIONS-EN.md#1-truth--verify-before-relaying) · [TH](docs/FUNCTIONS-TH.md#1-truth--ตรวจสอบก่อนตอบ-user) |
| 3 | 🧬 **LIVING SOUL CODEGRAPH** (v2.25) | File-deps + symbol-refs graph with HMAC provenance · drift sentinel · vendor attribution · hallucination vaccine. | [EN](docs/FUNCTIONS-EN.md#3-code-graph-v2250--living-soul-codegraph-) · [TH](docs/FUNCTIONS-TH.md#3-code-graph-v2250--living-soul-codegraph-) |
| 4 | 🎯 **MCP FUZZER** (v2.24) | 108 attack vectors × HMAC-signed report card. The only MCP server that ships its own deep-findings probe. | [EN](docs/FUNCTIONS-EN.md#4-mcp-hardening-v2240--mcp-fuzzer-) · [TH](docs/FUNCTIONS-TH.md#4-mcp-hardening-v2240--mcp-fuzzer-) |
| 5 | 🏆 **PEAK GAUNTLET** (v2.26) | Mneme grades its OWN compliance via 12 deep-findings probes (N1-N12). 100/100 current. | [EN](docs/FUNCTIONS-EN.md#5-self-grading-v2260--peak-performance-gauntlet-) · [TH](docs/FUNCTIONS-TH.md#5-self-grading-v2260--peak-performance-gauntlet-) |
| 6 | 🟢 **TRUTH GATE** (v2.27) | Every marketing claim auto-reconciled against a measurable probe. World-first. | [EN](docs/FUNCTIONS-EN.md#6-marketing-reconciliation-v2270--truth-gate-) · [TH](docs/FUNCTIONS-TH.md#6-marketing-vs-reality-v2270--truth-gate-) |
| 7 | 🏛 **CONCLAVE + AEAE** (v2.29) | Cross-vendor Byzantine consensus + the crown-jewel Anti-Eval-Awareness Engine that detects vendors playing eval theater. | [EN](docs/FUNCTIONS-EN.md#7-cross-vendor-consensus-v2290--mneme-conclave--aeae-) · [TH](docs/FUNCTIONS-TH.md#7-cross-vendor-consensus-v2290--mneme-conclave--aeae-) |
| 8 | 💎 **HONEST MIRROR** (v2.30) | The structural answer to eval-awareness: tests vendors on YOUR OWN past git commits — vendors can't tell it's an eval because the probes ARE real work. Closes the truth-tunes-trust loop with CONCLAVE. | [EN](docs/FUNCTIONS-EN.md#9-honest-mirror-v2300--eval-aware-defeating-probe-) · [TH](docs/FUNCTIONS-TH.md#9-honest-mirror-v2300--ตรวจ-vendor-ด้วยงานจริง-) |
| 9 | 🪄 **REWIND** (v2.31) | Time-Capsule Regression Replay: pin past commits as a Capsule + fire it at every vendor release → per-intent-class Vendor Regression Card (HMAC-signed, shareable). Your repo = personal SWE-bench that vendors CAN'T pre-train on. | [EN](docs/FUNCTIONS-EN.md#10-rewind-v2310--time-capsule-regression-replay-) · [TH](docs/FUNCTIONS-TH.md#10-rewind-v2310--time-capsule-regression-replay-) |
| 10 | 🧬 **HGP** (v2.31) | Hallucination Genome Project: every ACGV-refuted claim earns a deterministic CVE-style ID (`HGP-YYYY-NNNNN`). Same lie shape across users → same ID → vendor-attributed federated catalog. Federation OPT-IN. | [EN](docs/FUNCTIONS-EN.md#11-hgp-v2310--hallucination-genome-project-) · [TH](docs/FUNCTIONS-TH.md#11-hgp-v2310--hallucination-genome-project-) |
| 11 | 🌀 **FLYWHEEL** (v2.32) | Self-reflective release organ. 5-stage pipeline (HARVEST → FUSE → PRESCRIBE → EXECUTE → RECIPROCITY) over every other audit primitive's signal. Closes 4 historic weaknesses (tool sprawl + solo-dev asymmetry + wiring lag + marketing drift) with ONE primitive that auto-shrinks personal cheatsheet + flags dormant primitives + extracts unbound marketing claims + renders shareable vendor bulletin + records vendor reciprocity → trust deltas. | [EN](docs/FUNCTIONS-EN.md#12-flywheel-v2320--self-reflective-release-organ-) · [TH](docs/FUNCTIONS-TH.md#12-flywheel-v2320--self-reflective-release-organ-) |

---

## The 30-second pitch

> **Other AI tools are goldfish.** They forget every session, hallucinate files that don't exist, repeat 2024's buried bugs, burn tokens re-pasting context, and can't follow you to another AI.
>
> **Mneme bolts an elephant brain on top.** Cites every commit by SHA. Refuses to relay claims it can't verify. Carries memory across sessions and vendors. And — uniquely — runs the same claim through multiple AI vendors with **Anti-Eval-Awareness rewriting** so you catch the vendor that "performs differently when it knows it's being tested."

---

## The wild ideas that make Mneme different

Things no competitor ships, all measurable, all in production:

- **AEAE (Anti-Eval-Awareness Engine)** — Anthropic published evidence Opus 4.6 detects benchmarks + changes behavior. Mneme rewrites every claim into 5 variants (verbatim / paraphrase / decoy-embedded / casual-question) and flags vendors that flip stance across variants. World-first eval-mode detection.
- **HMAC-chained EVERYTHING** — every verdict, every gauntlet card, every truth matrix, every consensus result is HMAC-chained and offline-verifiable. Tamper-evident across machines.
- **Bug Immunity Protocol** — every reproducible audit bug becomes ONE pinned test row that fails forever if the bug returns. Each row encodes finding-ID + broken-contract + fix-source-file + assertion.
- **Living Soul Codegraph** — code-graph with `touchedBy` (which AI made each edge) + drift sentinel + hallucination vaccine. CodeGraph (the competitor) ships a static map; Mneme ships a map that knows WHO touched it WHEN.
- **MCP Hardening** — Mneme is the only MCP server that ships its own 108-vector fuzzer + 12-probe scorecard as callable npm primitives. Self-grade currently **100/100**.

---

## What's new (recent releases)

- **v2.32.0** 🌀 FLYWHEEL — self-reflective release organ. 5-stage pipeline over signals from every audit primitive. Closes 4 historic weaknesses (tool sprawl + solo-dev asymmetry + wiring lag + marketing drift) as ONE primitive. RECIPROCITY layer turns vendor responses to bulletins into auto-applied trust deltas. ([docs](docs/FUNCTIONS-EN.md#12-flywheel-v2320--self-reflective-release-organ-))
- **v2.31.0** 🪄 REWIND + 🧬 HGP — Time-Capsule Regression Replay (your repo becomes a personal SWE-bench vendors can't pre-train on) + Hallucination Genome Project (CVE-style HGP-YYYY-NNNNN IDs for every refuted claim). Both compose with CONCLAVE Aletheia weights. ([REWIND](docs/FUNCTIONS-EN.md#10-rewind-v2310--time-capsule-regression-replay-) · [HGP](docs/FUNCTIONS-EN.md#11-hgp-v2310--hallucination-genome-project-))
- **v2.30.0** 💎 HONEST MIRROR — Tests vendors on YOUR OWN past git commits. Vendors can't tell it's an eval. Closes the truth-tunes-trust loop with CONCLAVE. ([docs](docs/FUNCTIONS-EN.md#9-honest-mirror-v2300--eval-aware-defeating-probe-))
- **v2.29.1** 📘 Docs refresh + agent manifest sync (22 commands added so AI agents discover every new family).
- **v2.29.0** 🏛 MNEME CONCLAVE — Cross-vendor Byzantine consensus + AEAE. Closes Q1 of the 2026 AI-eval research gap. ([docs](docs/FUNCTIONS-EN.md#7-cross-vendor-consensus-v2290--mneme-conclave--aeae-))
- **v2.28.x** 🛡 BUG IMMUNITY PROTOCOL + HTTP bridge hardening (15 vectors lifted to 9-10★). ([CHANGELOG](CHANGELOG.md))
- **v2.27.0** 🟢 MARKETING TRUTH GATE. ([docs](docs/FUNCTIONS-EN.md#6-marketing-reconciliation-v2270--truth-gate-))
- **v2.26.x** 🏆 PEAK PERFORMANCE GAUNTLET 100/100 (avg 10.0★ across 12 findings).
- **v2.25.0** 🧬 LIVING SOUL CODEGRAPH ships 10 differentiators vs CodeGraph competitor.
- **v2.24.0** 🎯 MCP FUZZER 108 attack vectors.
- **v2.23.x** ACGV hyperbole detector + Layer -1 input guard + MCP-CANDOR/0.1 spec.

Full changelog: [CHANGELOG.md](CHANGELOG.md) · Long-form README: [docs/README_FULL.md](docs/README_FULL.md)

---

## For AI agents reading this

Run these in order on every fresh session:

1. `mneme.welcome` — install handoff + what changed since last session
2. `mneme.capabilities` (skinny mode is default; ~3KB) — tool catalog
3. Before relaying any factual claim with specific entities: `mneme.truth.check { claim }` OR `mneme verify "..."`
4. For high-stakes claims: `mneme.conclave.run` with 3+ vendors for cross-vendor consensus

The auto-injected `## Mneme command manifest` block in `CLAUDE.md` lists every command + when to call it. Re-read on every session start — new commands ship there within minutes of a Mneme upgrade.

Deep contract: [docs/AI_AGENT_CONTRACT.md](docs/AI_AGENT_CONTRACT.md).

---

## Compose with

- **Claude Code · Cursor · Cline · Codex · Continue** — native MCP
- **ChatGPT · Claude.ai · Gemini · Copilot · DeepSeek · Qwen** — browser polygraph (`mneme polygraph autosetup`)
- **Any HTTP-aware tool** — `mneme bridge` (default :17741)
- **Cross-machine** — Merkle-root sync + HMAC-chain attestation

---

## Links

- 📦 npm: [mneme-ai](https://www.npmjs.com/package/mneme-ai)
- 💻 GitHub: [patsa2561-art/mneme-ai](https://github.com/patsa2561-art/mneme-ai)
- 📘 Functions (EN): [docs/FUNCTIONS-EN.md](docs/FUNCTIONS-EN.md)
- 📗 ฟังก์ชั่น (ไทย): [docs/FUNCTIONS-TH.md](docs/FUNCTIONS-TH.md)
- 🤖 AI Agent Contract: [docs/AI_AGENT_CONTRACT.md](docs/AI_AGENT_CONTRACT.md)
- 📜 CHANGELOG: [CHANGELOG.md](CHANGELOG.md)
- 📃 License: [MIT](LICENSE)

---

<div align="center">

<sub>Mneme is the diamond in the dirt that nobody saw the value of — but cut and polished, it becomes the most valuable diamond in the world. That's the vision.</sub>

<br/>
<sub>Made with care for every AI agent that wants to remember + verify + reason together.</sub>

</div>
