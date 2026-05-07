# Mneme as the Teacher of AI

> *AI is genius. Mneme is the master that teaches the genius.*

═══════════════════════════════════════════════════════════════════════════════

## The framing

Today's AI coding tools (Claude Code, Cursor, Codex, GitHub Copilot, Continue) are **brilliant students**. They have:

- ⚡ Massive parallelism (they read fast)
- 🧠 Trained reasoning (they think well)
- 💬 Natural language (they explain clearly)

But what they DON'T have on their own:

- 📜 **Your repo's 6-year decision log** as committed memory
- 🧬 **Author fingerprints** to know whose claim to weight more
- 🛡 **Forensic-grade attribution** to verify ambiguous commits
- 📦 **Compressed institutional knowledge** that fits in their context window
- 🔬 **Pedagogical guidance** on how to USE what they retrieve

Mneme is **the master teacher** that gives the AI:
1. The right **textbook** (HTC's compressed memory layer)
2. The right **annotations** (Leviathan-verified claims, ENFSI-grade attribution)
3. The right **lesson plan** (Iris's journalist-pyramid structure)
4. The right **homework feedback** (wisdom-mutant adaptation)

═══════════════════════════════════════════════════════════════════════════════

## What "teaching" means concretely

When an AI client (Claude Code, Cursor, etc.) calls Mneme via MCP, the response isn't just data — it's a **lesson**. Each Mneme response carries:

### 1. Compressed source material (HTC, v0.24)

50,000 commits → 1.5M tokens of semantic abstracts → fits in one Sonnet prompt. The AI now has the entire codebase's institutional knowledge in working memory.

### 2. Verifiability instructions (Leviathan, v0.23)

Every claim in Mneme's output is **per-claim verified** against evidence. Unverified claims wrapped as `[unverified: ...]` so the AI sees what to NOT propagate. The AI learns: "this hash exists; this sentence isn't supported by it."

### 3. Trust-weighted citations (forensic primitives)

Each commit citation carries:
- **Author trust score** (from history × ENFSI verbal scale)
- **Recency decay** (TDWE)
- **Anomaly flag** (4-axis baseline check)

The AI learns: "alice's commits in this area are high-trust; weight them. bob's recent burst at 3 AM is anomalous; treat as suspicious."

### 4. Inverted-pyramid structure (Iris, v0.25)

The AI receives output in **journalist order**: headline → lede → key facts → details. The AI is GUIDED to weight earlier facts higher. It learns: "the headline is the verdict; details are nuance."

### 5. Self-tuning execution (MPE, v0.26)

When the AI calls Mneme repeatedly, the underlying pipeline **adapts**. Slow stages get more workers. Flaky providers get cooldowns. The AI's experience improves over time without anyone retraining the AI.

═══════════════════════════════════════════════════════════════════════════════

## The composition (what makes this novel)

No tool today does ALL of this. Most stop at one layer:

| Tool | Source | Verify | Trust | Pyramid | Adapt |
|---|---|---|---|---|---|
| Sourcegraph Cody | raw code | ❌ | ❌ | ❌ | ❌ |
| Greptile | code + index | ❌ | ❌ | ❌ | ❌ |
| Cursor | open files | ❌ | ❌ | ❌ | ❌ |
| Continue | open files + RAG | ❌ | ❌ | ❌ | ❌ |
| Sweep / Aider | per-PR | partial | ❌ | ❌ | ❌ |
| Copilot Workspace | proprietary | ❌ | ❌ | ❌ | ❌ |
| **Mneme v0.26** | ✅ HTC compressed | ✅ Leviathan | ✅ ENFSI + 4-axis | ✅ Iris | ✅ MPE |

═══════════════════════════════════════════════════════════════════════════════

## Why this framing matters

Most AI tools position themselves as **better students** — better-trained models, bigger contexts, faster inference. They compete on the same axis.

Mneme positions on a **different axis**: **quality of teaching**. We don't compete with the AI; we make whatever AI you choose **measurably better**.

Practical consequence: every Mneme release **lifts every AI tool** that integrates via MCP. We're a force multiplier across the entire ecosystem, not a participant in any one tool's competition.

═══════════════════════════════════════════════════════════════════════════════

## What's next

The teaching gets richer with each release:

- **v0.27 (planned):** *Pedagogical replay* — Mneme records which lessons were "absorbed" by the AI (i.e., which retrieved commits the AI cited correctly in its final answer). Failed lessons re-served with more context.
- **v0.28 (planned):** *Adversarial verification* — Mneme generates contradictions to its own answers and tests whether the AI catches them. Trust score earned, not assumed.
- **v0.29 (planned):** *Curriculum mode* — Mneme delivers commits in pedagogically-ordered batches: prerequisites first, advanced material last.

═══════════════════════════════════════════════════════════════════════════════

## Inspiration

Quoting [Clayton Christensen](https://www.harvardbusiness.org/its-easier-to-hold-to-your-principles-100-of-the-time-than-it-is-to-hold-to-them-98-of-the-time/):

> *"It's easier to hold your principles 100% of the time than it is to hold them 98% of the time."*

Mneme's principles are non-negotiable: local-first, free path always works, verifiable-or-refuse, plain-English everywhere, and **AI is the student; we are the teacher**. Every release reinforces them.

═══════════════════════════════════════════════════════════════════════════════

## Related

- 📦 [[Hierarchical-Memory]] — the textbook (compressed memory)
- 🔬 [[Speculative-Reasoning]] — the annotations (verify + trace)
- 🛡 [[Forensic-Code-Science]] — the trust score (ENFSI + 4-axis)
- 📰 [[Super-Pipeline]] — the lesson-delivery engine
- 🌌 [[The-Frontier]] — full whitespace map vs. competitors
