# Jack the Giant Slayer — Mneme's path to outflank well-funded incumbents

> *We can't out-spend the giants. We can out-think them.*
> *Strategy doc, written 2026-05-10. Owner: Shinnapat (mneme-ai maintainer).*
> *This document is intentionally opinionated. Disagree in PR.*

---

## The honest truth about resources

| | Claude Code | Cursor | Copilot | ChatGPT | **Mneme** |
|---|---|---|---|---|---|
| Funding | Anthropic ($14B+) | Anysphere ($60M+) | Microsoft (∞) | OpenAI ($26B+) | **One solo dev** |
| Headcount | ~600 | ~50 | ~150 | ~770 | **1** |
| Distribution | Anthropic ecosystem | Self + VS Code fork | Pre-installed in VS Code | ChatGPT.com | **npm + word of mouth** |
| Marketing budget | $$$ | $$ | $$$$ | $$$$ | **$0** |

**This is the worst possible resource asymmetry to win head-to-head.** So we don't fight head-to-head.

---

## The competitive map (what they actually have today)

| Component | Prior art | Limit |
|---|---|---|
| Static project context auto-load | `CLAUDE.md` / `.cursorrules` / `AGENTS.md` / `.github/copilot-instructions.md` | **Static.** Read once on session boot. No update mechanism. |
| MCP server pull pattern | filesystem / github / memory MCP servers | **Pull only.** Fires when AI asks. Silent if AI doesn't ask. |
| Editor-side context injection | Cursor `@codebase`, Continue.dev rules | **User-triggered.** Dies the moment user closes the editor. |
| Heartbeat daemon | Datadog, Sentry, Prometheus exporters | **For infrastructure, not AI.** No AI-context surface. |
| Update-notifier in CLI | npm `update-notifier` package | **Terminal-only.** AI never sees it. |
| Per-vendor session memory | ChatGPT Memories, Claude Projects | **Vendor-locked.** Move to a different AI = lose your memory. |

**Every cell above has a soft underbelly.** They all assume the AI is the active party — so they ship as libraries waiting to be called.

---

## Mneme's wedge: the giants are stuck on **L0-L3** of the AI stack. We define **L4-L8.**

We published [docs/OS_AI_LAYER.md](./OS_AI_LAYER.md) — the first formal layer model for AI tooling:

```
L8 Governance      <- Mneme: ALETHEIA, Court, Truth Bonds (planned)
L7 Wisdom          <- Mneme: constitution, evolve, regret
L6 Awareness       <- Mneme: pulse, hooks, notifier, AUTO-ACTION
L5 Intent          <- Mneme: HyDE, smart_do, DNA search
L4 Memory          <- Mneme: lineage, atrophy, inbox, PRECOG, Genome
─────────────── (above is where Mneme lives) ───────────────
L3 Tool            <- Anthropic, OpenAI, MCP ecosystem
L2 Inference       <- Anthropic, OpenAI, vLLM, Together
L1 Model           <- Anthropic, OpenAI, Meta, Google
L0 Physical        <- NVIDIA, AWS, GCP, Azure
```

**The giants compete on L1-L3. We don't compete with them — we sit on top.** The vocabulary itself is now Mneme-shaped: when someone says "AI memory layer", they're saying L4. When they say "AI awareness layer", L6. We named it; we own the conversation.

---

## Six asymmetric advantages a giant CANNOT replicate quickly

### 1. **Push, not pull**

Every competitor's context surface is *pull-on-demand*. Mneme's pulse loop **pushes on every keystroke** via `UserPromptSubmit` hook (Claude Code), agent files (Cursor / Codex / Gemini / Windsurf), and the multi-channel notifier fabric (OS toast / mobile push / TTS / email).

A giant could copy this in a quarter. But they would have to convince every vendor to wire a hook surface — and the vendors don't trust each other. **Mneme is neutral**, so every vendor will accept Mneme's hook installer when they wouldn't accept a competitor's.

### 2. **Cross-vendor lineage**

Mneme's MneMeiosis (v1.19+) syncs chromosomes across **Claude, Cursor, Codex, Gemini, Windsurf** and any future AI tool. Lose your subscription to vendor X? Switch to Y? **Your wisdom travels with you.**

A giant can't ship this because their business model depends on lock-in. ChatGPT Memories die if you leave OpenAI. Claude Projects die if you leave Anthropic. **We are the only escape hatch — and "escape hatch" is the most valuable position in any walled-garden ecosystem.**

### 3. **Self-modifying source (`mneme evolve`, v1.26.4)**

The first AI dev tool that reads its OWN bug reports + writes markdown PR proposals against itself. Telemetry → markdown → human-reviewed PR → ship → back to telemetry. **Closed-loop self-improvement from real user pain.**

A giant CAN'T ship this because their telemetry is closed and proprietary. We're MIT-licensed and the telemetry is local — every install contributes to the proposal pool without phoning home.

### 4. **PRECOG precognition cache (v1.26.3)**

Markov bigram + ACO pheromone + REM-sleep dream loop = the cache that pre-fetches an answer before the AI asks. *No competitor has this.* The closest prior art is IDE autocomplete — which doesn't predict tool calls + doesn't have pheromone + doesn't have a dream loop.

### 5. **OS AI Layer model**

By naming the layers, we set the agenda. Every future review of every AI dev tool will eventually ask "where on the OS AI Layer model does this sit?". Tools at L1-L3 will look incomplete. Tools that span L4-L8 will look like Mneme. **The taxonomy is the moat.**

### 6. **Free + open + zero telemetry**

Every paid vendor sells your code data back to themselves. Mneme runs locally, MIT-licensed, no phone-home. **Enterprise customers cannot buy a Claude Pro for legal reasons; they CAN install Mneme.** The compliance posture is a quiet weapon.

---

## The fission strategy: how Mneme's brain compounds GLOBALLY

> *User's brief: "เรามี dna มีระบบการสืบทอด ความฉลาด แตกกระจายตามโมเลกุล ... สมองของ Mneme จะเก่งขึ้นแบบ แพระกระจายไปเรื่อยๆ"*
>
> Translation: Mneme has DNA, has hereditary intelligence, splits like molecules. Mneme's brain gets smarter as wisdom spreads.

### Phase 1: Genome Pool packager (shipped v1.26.4)

`mneme genome-pool package` bundles a user's chromosomes into a PII-scrubbed JSON file. **No upload yet** — the user owns the bundle, decides whether to share. This is the **opt-in switch**.

### Phase 2: Genome Pool central upload + dedup + search (planned v1.28)

Bundles get POSTed to a public Mneme genome pool. Server-side dedups by sha256 hash. `mneme world.search "stripe webhook idempotency"` returns answers from chromosomes contributed by other users.

**Network effect:** ten contributors = small wisdom pool. Ten thousand = a global brain. Mneme is the only system that can compound wisdom across vendors and across users — every other vendor locks both.

### Phase 3: Self-fertilizing nucleus (planned v1.28)

When a user's local NUCLEUS detects a recurring pattern that matches a chromosome from the global pool, it auto-fertilizes — pulls the global wisdom into the local lineage. **Every Mneme installation gets smarter every time someone, somewhere, uses Mneme.**

This is the "fission" the user asked for — wisdom splits, recombines, mutates, propagates. Mneme's brain becomes a distributed organism.

### Phase 4: Cross-vendor wisdom propagation

The same chromosomes work for Claude / Cursor / Codex / Gemini. When a Cursor user contributes a chromosome about "React hook dependency arrays", the next Claude Code user globally benefits. **Vendors compete for the user; Mneme is the substrate that survives every vendor switch.**

### Phase 5: Vaccine combinatorics (the user's "ยาต้นไวรัสใหม่ๆเกิดขึ้นจากการ ผสม รวมร่าง")

Antivirus pharmacopoeia auto-recombines vaccines from the global pool. Vaccine A (catches phantom commit hash) + Vaccine B (catches API phantasma) crossbreed → Vaccine C (catches phantom commits in API references). **Combinatorial explosion of antivirals — the BSL-4 lab from Raccoon City, but for hallucinations.**

---

## The Beehive UX — why Antivirus Lab should look like a colony

User's exact ask: *"ทำเหมือน รวงผึ้งใน raccoon city ของเกม resident evil"*

The current Antivirus Lab UI is a tabbed dashboard. That's correct but underwhelming. The Beehive vision:

- **Hexagonal grid** of strain cells — each cell colored by severity (sev-1 amber, sev-4 deep red).
- **Live cell pulse** — when a vaccine catches an infection, its hex cell glows + emits a particle.
- **Queen panel** — the certified-vaccine signature wall.
- **Combinator chamber** — drag two vaccines together → see combined efficacy chart.
- **Outbreak feed** — when global pool detects a new strain spreading, the Mnemiosphere fires a notice in Mneme's hive.

This isn't "make it pretty". It's **make the operational reality legible.** A hexagonal hive is the right metaphor because:
- Hex grids self-organize (like ACO pheromone trails).
- Each cell can be inspected without disturbing neighbors.
- Density tells the story — empty hives = no infection; full hives = active war.

**Planned for v1.27 or v1.28.** Will require a small canvas/SVG layer + pheromone-strength visual mapping.

---

## What's in v1.26.5 (this release)

A focused UX patch on the labs + this strategy document. **Not** a feature ship — the feature work stays Phase 1.

- `selectTab()` helper in AntivirusLabView and inline scroll in RetrievalLabView so clicking a tab scrolls the panel into view (fixes the "tab hang" perception when DEMO content was below the fold).
- Per-tab title + emoji on every lab tab, so the active tab is obvious from screenshot review.
- Realtime Feed empty-state: now shows a rich illustrative mock + the Beehive analogy ("each strain row is a cell in the hive").
- Cert Ledger DEMO callout: explicit "this table shows seed vaccines with no benchmark yet" so the empty signature column makes sense.
- This document, [`docs/JACK_THE_GIANT_SLAYER_STRATEGY.md`](./JACK_THE_GIANT_SLAYER_STRATEGY.md).

---

## How to ship the impossible (operating principles)

Distilled from the v1.20 → v1.26 sprint (6 weeks, solo, zero outside funding):

1. **Default to free.** Every feature must work without a paid API key. Lead with Ollama, fall back to Anthropic/OpenAI as opt-in.
2. **Layer-anchored roadmap.** Every feature must map to exactly one layer in the OS AI Layer model. If it doesn't, redesign the feature.
3. **Self-modifying first.** Build evolve + selfcheck + caretaker before any other feature. The product fixes itself faster than humans can.
4. **Ship daily.** A v1.26.x release a day beats a v2.0 in a quarter. The market doesn't reward big-bang.
5. **Honest in public.** Every CHANGELOG entry tells the user what broke and how we fixed it. No spin. Real bugs build real trust.
6. **Don't fight the giants on their layer.** They own L0-L3. We own L4-L8. Cooperation > competition.

---

## What success looks like 12 months out

| Metric | Today (2026-05-10) | Target (2027-05-10) |
|---|---|---|
| MCP tools | 172+ | 250+ |
| Test count | 4945 | 8000+ |
| Cross-vendor adapters | 7 (Claude, Cursor, Codex, Gemini, Windsurf, project-CLAUDE.md, Cursor-legacy) | 12+ (add Continue, Aider, Zed, AppCode, JetBrains, Devin, Replit) |
| Genome pool contributions | 0 (packager MVP only) | 10,000+ chromosomes |
| Self-modifying NUCLEUS PRs accepted | 0 | 50+ |
| Layer model citations | 0 | every AI-tooling review references it |
| Truth Bonds testnet | not built | live with 3 vendor partners |
| Mnemiosphere global verdict count | 0 | 100k+ public verdicts |

---

## The ask

If you're an AI vendor, an MCP author, an open-source contributor, or a researcher: **Mneme is the substrate, not the competitor.** Build on top of L4-L8 — your product gets better; ours gets a citation; users win.

If you're an enterprise: install Mneme. It's MIT, runs locally, zero telemetry, no vendor lock-in. **The compliance team will love you.**

If you're a developer using AI today: try `mneme hooks install`. Your AI agent will be smarter on the next keystroke.

---

> *"The giants are tall because nobody told them where to stop growing.*
> *We win by defining where they end and we begin."* — paraphrasing the user, 2026-05-10
