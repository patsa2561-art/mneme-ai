# ⚡ FLASH INTELLIGENCE — anti-hallucination Core (v1.99)

> *"Not trained to be skeptical. Engineered to be."*

Vanilla AIs see "[Super rare]" printed in a seller listing → confidently say *"yes it's rare"* → **hallucination born from marketing copy**. FLASH refuses. The Veracity-Velocity Singularity:

```
V_eff = ( Σ E_i · W_i / ln(H + e) ) × Φ_qx
```

| Variable | What it means |
|---|---|
| **E_i** | Empirical evidence (each piece supplied to the formula) |
| **W_i** | Source weight (verified-third-party=0.95 · expert-database=0.85 · image-OCR=0.35 · **seller-listing=0.20** · marketing-copy=0.15 · AI-guess=0.10) |
| **H** | Hallucination factor (grounding adds penalty when source is seller-listing context) |
| **Φ_qx** | User paranoia multiplier (default 1.0; recommend 2.0 for commercial sources) |

**Verdict thresholds:** ≥0.75 AFFIRM · ≥0.40 CAUTIOUS · ≥0.15 DOUBTFUL · <0.15 REFUTE.

---

## Live verified — the user's exact "Super rare CAPCOM" hallucination case

Input: image containing `[Super rare] CAPCOM Capcom Character Trump Street Fighter Mega Man ฿1,086.49 (tax included) Shipping included Buy Now on Buyee`.

```
▶ STEP 1 — GROUNDING
   context: seller-listing
   rarity claims: ["Super rare"]
   commerce signals: ["Buy Now", "Shipping", "1,086.49", "Product Description"]
   third-party proofs: (none)
   suggested source weight: 0.20

▶ STEP 2 — VERACITY
   V_eff = 0.206  →  verdict = DOUBTFUL
   weighted support: 0.160 · H-penalty: 1.551 · Φ_qx: 2.0

▶ STEP 3 — DEVIL'S ADVOCATE
   top refutation: "this Capcom Trump card deck is common / mass-produced"
   refutation V_eff: 0.052 (pressure -0.155 → original preserved at DOUBTFUL)

▶ STEP 4 — RESPONSE TEMPLATE
   "Cannot confirm 'this Capcom Trump card deck is super rare' — the only sources
    are marketing-tier (seller listing / promotional copy). V_eff below 0.40.
    I'd need verified-third-party data (auction history, production count,
    expert database) to confirm."
```

**Same claim WITH expert-database + verified-third-party evidence added** → V_eff = **1.089** → **AFFIRM**.

The math correctly refuses marketing copy and correctly affirms verified rarity. Vanilla AIs do neither — they pattern-match the surface text either way.

---

## Four stacked modules

[`packages/core/src/flash/`](../packages/core/src/flash/)

1. **veracity.ts** — the V_eff formula + verdicts + response templates.
2. **devils_advocate.ts** — Recursive Self-Verification with 5 deterministic refutation generators (negation · source-attack · specificity-flip · burden-shift · outlier). NOT LLM-based — LLMs rationalize their own claims.
3. **grounding.ts** — Hyper-Contextual Grounding. Pattern-matches commerce signals, rarity claims, and third-party proofs to classify source context (seller-listing · expert-review · user-statement · neutral-text).
4. **predictive.ts** — Prompt-Q-Latency Engine. Markov-chain predicts user's next likely question, pre-warms context.

Plus the master **flash.ts** — single `runFlash({claim, contextText, baseHallucinationFactor, phi_qx})` call composes all four.

---

## For AI agents

```typescript
import { runFlash } from "@mneme-ai/core";

const r = runFlash({
  claim: "this item is super rare",
  contextText: ocrTextOrUserMessage,
  baseHallucinationFactor: 0,
  phi_qx: 2.0,                   // 2.0 for commercial sources
});

if (r.verdict === "DOUBTFUL" || r.verdict === "REFUTE") {
  // DO NOT assert the claim as fact. Use r.template as reply start.
  return r.template;
}
```

24 unit tests cover all 4 modules + the user's exact CAPCOM case. See [`packages/core/src/flash/flash.test.ts`](../packages/core/src/flash/flash.test.ts).

---

## Why this is the disruption

Prompt engineering exists because AIs hallucinate. FLASH turns hallucination detection into deterministic math:

> *V_eff is a formula. A vibe is not.*

Vendors that adopt FLASH stop selling "carefully prompted" workflows and start selling "math-grounded answers." Users that have FLASH (via Mneme) stop accepting marketing-copy verdicts and start demanding third-party evidence. The whole prompt-engineering industry shifts toward verifiable reasoning.

---

← [Back to README](../README.md) · [MNEME PASSPORT](PASSPORT.md) · [AI agent contract](AI_AGENT_CONTRACT.md)
