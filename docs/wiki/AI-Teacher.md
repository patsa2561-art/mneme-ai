# The library, not the librarian

> *Every great library has two kinds of people: brilliant minds who borrow books, and a quiet archive that remembers everything.*

═══════════════════════════════════════════════════════════════════════════════

## The framing

Today's AI coding tools — Claude Code, Cursor, Codex, Copilot, Continue — are exceptional **borrowers**. They read fast, reason well, explain clearly. What they cannot do alone:

- 📜 **Remember six years of decisions** — every deprecation, every "we tried that, it broke X"
- 🧬 **Know whose claim to weight more** — author fingerprints, history, trust
- 🛡 **Verify ambiguous commits** — forensic-grade attribution
- 📦 **Carry institutional knowledge in their context window** — compressed enough to fit
- 🔬 **Tell which retrieved fact actually supports their answer** — citation grounding

Mneme is the **archive** that gives them all of this. Not a competitor in the editor — the memory layer underneath.

═══════════════════════════════════════════════════════════════════════════════

## What plugging Mneme in changes

When an AI client (Claude Code, Cursor, etc.) calls Mneme via MCP, the response isn't just data — it carries five teaching properties no other tool ships together:

### 1. Compressed source material (HTC)

50,000 commits → ~1.5M tokens of semantic abstracts → fits in one large-context prompt. The AI now has the entire codebase's institutional knowledge in working memory.

### 2. Verifiability instructions (Leviathan)

Every claim in Mneme's output is **per-claim verified** against evidence. Unverified claims wrapped as `[unverified: ...]` so the AI sees what NOT to propagate. The AI learns: *"this hash exists; this sentence isn't supported by it."*

### 3. Trust-weighted citations

Each commit citation carries:
- **Author trust score** (from history × ENFSI verbal scale)
- **Recency decay** (TDWE)
- **Anomaly flag** (4-axis baseline check)

The AI learns: *"alice's commits in this area are high-trust; weight them. bob's recent burst at 3 AM is anomalous; treat as suspicious."*

### 4. Inverted-pyramid structure (Iris)

The AI receives output in **journalist order**: headline → lede → key facts → details. The AI is guided to weight earlier facts higher. It learns: *"the headline is the verdict; details are nuance."*

### 5. Self-tuning execution (MPE)

When the AI calls Mneme repeatedly, the underlying pipeline **adapts**. Slow stages get more workers. Flaky providers get cooldowns. The AI's experience improves over time without anyone retraining the AI.

═══════════════════════════════════════════════════════════════════════════════

## Why this matters

Most AI tools compete on **who is the smartest student in the room** — bigger model, longer context, faster inference. Same axis, infinite arms race.

Mneme isn't on that axis. Mneme is the layer **underneath** — what every borrower wants the same instant they realize they're missing context. Plug it in once, and every AI you use gets measurably more grounded.

Lift the floor across the whole ecosystem instead of fighting for one chair.

═══════════════════════════════════════════════════════════════════════════════

## A principle, in one sentence

Quoting [Clayton Christensen](https://www.harvardbusiness.org/its-easier-to-hold-to-your-principles-100-of-the-time-than-it-is-to-hold-to-them-98-of-the-time/):

> *"It's easier to hold your principles 100% of the time than it is to hold them 98% of the time."*

Mneme's principles, held at 100%: local-first, free path always works, verifiable-or-refuse, plain English everywhere, and *the archive serves the borrowers — never competes with them.*

═══════════════════════════════════════════════════════════════════════════════

## Related

- 📦 [[Hierarchical-Memory]] — the textbook (compressed memory)
- 🔬 [[Speculative-Reasoning]] — the annotations (verify + trace)
- 🛡 [[Forensic-Code-Science]] — the trust score (ENFSI + 4-axis)
- 📰 [[Super-Pipeline]] — the lesson-delivery engine
- 🌌 [[The-Frontier]] — full whitespace map
