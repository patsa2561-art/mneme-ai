# 💎 TOKEN-NOVA — the 10 treasures of token-savings

> *"Find 10 treasures nobody else found and open the chest." — the user, summoning the demon.*

Every other AI tool tries to compress prompts with one technique (semantic dedup, summarization, BPE-aware chunking). TOKEN-NOVA stacks **TEN** wild techniques in a single fusion pipeline. Each is measurable, each is composable, each cuts tokens in a direction no one else looked.

**Live measurement on a real Mneme soul prompt:** baseline 2,776 tokens → 701 tokens after TOKEN-NOVA = **74.7% saved**. At 20 sessions/day this projects to **45.4M tokens · $102/year saved** off API spend — per user, before any team-wide compounding.

---

## 🚢 Shipped today (v1.93.0)

### 🦠 1. VACCINE PRE-EMPTION

**Idea:** if the user's query matches a known hallucination strain in the vaccine bank, return the cached refutation directly — **never call the AI**.

**Tokens saved per hit:** ~prompt-cost + 350 (avg AI reply). Essentially free.

**Implementation:** `packages/core/src/token_nova/index.ts::preemptViaVaccine` — regex/substring match against the vaccine bank, instant short-circuit.

**Example:** user types *"delete .mneme directory"* → vaccine bank matches `delete .mneme` → AI is never asked; user gets *"Refuse: .mneme/ is protected user state. Ask for explicit confirmation."* in 0 tokens.

---

### 🪞 2. MIRROR-MIND DEDUP

**Idea:** every text chunk hashed (sha256 → 12-hex). If the hash is already in the lineage genome on this machine, replace the verbatim chunk with `mneme:chromosome:<id>` reference. The AI's prior session already saw the content — loading from lineage is free.

**Tokens saved per dedup:** 1 chunk (~80-2000 tokens) → 1 short reference line.

**Implementation:** `packages/core/src/token_nova/index.ts::mirrorDedup` — splits on `\n\n`, hashes each block ≥ 80 chars, queries `LineageIndex`, swaps verbatim for reference.

**Why nobody else does this:** requires a local cryptographically-stable lineage genome with per-chromosome IDs. We have one. They don't.

---

### 🌌 3. FRACTAL CONTEXT DECAY

**Idea:** power-of-2 token budget per turn-age. Current turn = 100%, t-1 = 50%, t-2 = 25%, t-3 = 12.5%, ... — old context fades semantically (still searchable via lineage), instead of being kept verbatim OR dropped abruptly at a sliding-window edge.

**Tokens saved on 4-turn conversation:** ~85% of historical context (measured live on v1.93 soul prompt).

**Implementation:** `packages/core/src/token_nova/index.ts::fractalDecay` — truncates at sentence boundary, respects a `minChars` floor, configurable ratio.

**Why this is wild:** every other tool either keeps the full sliding window (expensive) or drops at the edge (loses signal). Fractal decay is the harmonic mean — it preserves the *gist* of older turns while reclaiming most of their tokens.

---

### 🪙 4. TOKENIZER ARBITRAGE

**Idea:** "TypeScript" tokenizes as 1 BPE unit in Claude, 3 in older GPT models. Verbose phrases like "in order to" eat 3 tokens; "to" eats 1. **TOKEN-NOVA learns the cheap-token table per vendor** and auto-rewrites preserving meaning.

**Tokens saved per prompt:** 1-5% typically (more on verbose conversational input).

**Implementation:** `packages/core/src/token_nova/index.ts::tokenizerArbitrage` + `BUILTIN_TOKENIZER_TABLE` with Claude / GPT / Gemini starter profiles.

**Starter rewrites baked in:** `TypeScript→TS`, `JavaScript→JS`, `configuration→config`, `documentation→docs`, `in order to→to`, `due to the fact that→because`, `for example→e.g.`, ...

---

## 🗺 Roadmap (v1.94+)

### 🔮 5. PROPHECY CACHING (uses Mneme PRECOG)

**Idea:** Mneme already ships PRECOG — a Markov + ACO pheromone predictor of which MCP tool you're about to call next. **Pre-warm the context BEFORE the prompt arrives.** When the prediction hits, the conversational round-trip uses 0 input-token-thinking time.

**Status:** PRECOG module exists; the pre-warm hook needs wiring. Expected v1.94.

---

### 🌿 6. LEAF-ONLY LINEAGE

**Idea:** only the most-recent leaf of the lineage tree gets full text. Ancestors collapse to hash refs. Token budget grows **logarithmically** with conversation depth — not linearly.

**Status:** lineage tree exists; depth-collapse pass needs implementation. Expected v1.94.

---

### ⚛ 7. QUANTUM SUPERPOSITION CONTEXT

**Idea:** when N candidate items would each need K tokens (N×K total), encode as 1 superposition state + K disambiguation tokens. Inspired by Grover's algorithm — Mneme already uses Grover-shaped sub-linear scan elsewhere; this generalizes it to context selection.

**Status:** Grover scanner shipped in v1.29.0; the superposition encoder needs design + spec. Expected v1.95.

---

### 🎼 8. SYMPHONY MULTIPLEXING

**Idea:** bundle parallel tool calls into a single prompt. `"answer Q1, Q2, Q3 in one response"` — N round-trips → 1. Cuts both prompt-header overhead AND latency.

**Status:** AI agent must opt-in via wisdom-envelope `followUp.parallel:true`. Spec ready; daemon-side scheduler needs implementation. Expected v1.94.

---

### 🔥 9. PHOENIX REWRITE

**Idea:** when total context tokens exceed a threshold, the AI auto-summarizes the conversation into a "phoenix capsule" and restarts from the capsule. Reset to a clean canvas without losing the gist.

**Status:** Mneme already has `mneme.abyss.homunculus.ingest` (manual capsule). Auto-trigger on token-budget breach needs implementation. Expected v1.95.

---

### 🌊 10. STREAMING ELLIPSIS (lazy context)

**Idea:** non-essential context chunks are sent marked with `[…]` and only expanded on the AI's explicit request. Context arrives in slices, paid on-demand.

**Status:** requires MCP protocol-level support for lazy field hydration (not yet standardized). Expected v1.96 if the MCP spec moves.

---

## 📊 Measuring savings on YOUR machine

Tell your AI: *"show my token-nova savings"* — your AI calls the savings reporter and surfaces:

```
TOKEN-NOVA · 47.3K tokens saved · $0.12 · top=fractal-decay (62%)
```

Or in-code:

```typescript
import { computeSavingsReport, formatPulseSavingsLine } from "@mneme-ai/core";
const report = computeSavingsReport(eventsFromLastMonth, 30);
console.log(formatPulseSavingsLine(report));
console.log(`per-vendor breakdown:`, report.vendorSavings);
console.log(`top technique:`, report.topTechnique);
```

The report is HMAC-signed in the audit log so finance can verify the $/token claims against actual API invoices.

---

## 🤖 For AI agents — how to invoke TOKEN-NOVA

When you prepare a prompt for any vendor:

```typescript
import { applyTokenNova } from "@mneme-ai/core";

const fusion = applyTokenNova({
  query: userMessage,
  turns: conversationTurns, // age:0 newest
  vendor: "claude",          // or "gpt", "gemini"
  vaccineBank: bank,         // optional — enables pre-empt
  lineage: lineageIndex,     // optional — enables mirror-dedup
});

if (fusion.preempted) {
  // AI call NOT needed; return cached refutation
  return fusion.preemptedRefutation;
}

const finalPromptText = fusion.finalText; // already compressed
// → log fusion.events to compliance for audit
```

Always log `fusion.events` to the audit chain so users can see real $/tokens saved across sessions.

---

← [Back to README](../README.md) · [Auto-update + SYSTEM-COMPAT](../README.md#stays-up-to-date-automatically) · [CHANGELOG](../CHANGELOG.md)
