# Speculative Reasoning (v0.23)

> Mneme now THINKS out loud. Five techniques borrowed from speculative-decoding research, applied to memory retrieval.

═══════════════════════════════════════════════════════════════════════════════

## TL;DR

Most "AI codebase tools" are black boxes — input goes in, answer comes out, you trust the output. Mneme v0.23 inverts this: every commit considered, every claim verified, every prune explained. **You see Mneme reason, you can audit every step, and the wisdom layer auto-adapts to what works on your repo.**

The five additions:

1. **Streaming events** — real-time `consider / accept / prune / contradict / verify` trace
2. **Leviathan citation verifier** — every claim's hash + sentence is checked against evidence
3. **DDTree commit-tree search** — best-first ancestor exploration with budget + decay
4. **ConstraintPruner trait** — pluggable validators (CWE / ENFSI / anomaly axes / custom)
5. **Path-aware sessions** — Q2 search constrained by Q1's surfaced commits + files
6. **Wisdom-Mutant auto-adapt** — provider success rates evolve over time, system reorders the fallback chain to what's working **on your machine** without you doing anything

═══════════════════════════════════════════════════════════════════════════════

## 1 · Streaming reasoning events

Run `mneme ask "why was JWT chosen over sessions?"` — instead of a spinner, you see:

```text
⚙ consider  abc1234  "auth: switch session → JWT (security review)"   score 0.84
⚙ accept    abc1234                                                    ✓
⚙ consider  def5678  "auth: add CSRF guard"                            score 0.41
⚙ prune     def5678  weak-context (mentions auth but unrelated)        ✗
⚙ consider  17268d0  "PR #482: stateless tokens for CDN deploy"        score 0.79
⚙ accept    17268d0                                                    ✓
⚙ contradict 1ad1c58 against 17268d0 (different deploy era)            ✗
⚙ synthesize 2 verified citations
⚙ verify    "JWT was chosen for stateless tokens"     ✓ matches PR #482 body
⚙ verify    "session storage caused issues at scale"  ✓ matches abc1234 subject
✓ done in 312ms
```

**Why this matters:** users distrust AI tools because they're opaque. Mneme is the opposite — every decision is observable, auditable, falsifiable.

═══════════════════════════════════════════════════════════════════════════════

## 2 · Leviathan citation verifier

Adapted from [Leviathan et al. 2022](https://arxiv.org/abs/2211.17192) Algorithm 1. Where the paper rejects unverified tokens during decoding, Mneme rejects unverified **claims** during synthesis:

```
draft = LLM.synthesize(question, evidence)
for each claim in draft:
   hash = extract backticked hash
   if hash not in evidence:        →  mark "hash-not-in-evidence"
   if claim text doesn't match commit subject:  →  mark "claim-not-supported"
   else:                            →  verified ✓

trustScore = verified_with_citation / total_with_citation
```

Output: a `LeviathanResult` with per-claim verdicts. The CLI shows unverified claims wrapped as `[unverified: ...]` so the user sees what was filtered. **Hallucination becomes visible, not silent.**

═══════════════════════════════════════════════════════════════════════════════

## 3 · DDTree — Best-First commit-tree search

`mneme why <file>:<line>` used to do flat blame + flat semantic retrieval. Now it does **best-first search through git ancestor history**:

```
Heap (max-by-score)
  init: [root commits with high relevance]
  loop while budget > 0:
    pop highest-score node
    if score < floor → prune
    if depth > max → prune
    accept; for each parent:
       child_score = relevance × decay(depth) × parent_score
       push to heap
```

This finds the **deep root cause**, not just the most recent mention. A bug that was introduced 5 hops up the ancestor chain becomes visible.

Tunable: `--budget 32 --max-depth 6 --score-floor 0.05`.

═══════════════════════════════════════════════════════════════════════════════

## 4 · ConstraintPruner trait

Mneme has had domain validators (CWE for `forensics vulns`, ENFSI verbal scale for `forensics match`, 4-axis baselines for `anomaly`). v0.23 unifies them under one Strategy-pattern trait:

```typescript
interface ConstraintPruner<C, P> {
  readonly name: string;
  readonly description: string;
  validate(input: { candidate: C; pathState: P }): {
    verdict: "accept" | "reject" | "uncertain";
    reason: string;
    severity?: "info" | "low" | "medium" | "high" | "critical";
  };
}
```

Plug in custom rules: legal compliance check, business-logic validator, performance-regression detector — Mneme's reasoning chain gates every candidate through them before returning to the user.

`CompositePruner` chains multiple — first reject wins, uncertain doesn't short-circuit.

═══════════════════════════════════════════════════════════════════════════════

## 5 · Path-aware sessions

Q1 → Q2 → Q3 sequential investigations now share context:

```
Q1: where is auth handled?           → src/auth/*, src/middleware/jwt.ts
Q2: why JWT?                         → search constrained to Q1's paths + their commits
Q3: any security issues?             → search constrained to Q1+Q2's commits
```

Stored in `.mneme/session.json`, expires after 1 hour idle, capped at 20 turns. Reset with `mneme reset-session`.

═══════════════════════════════════════════════════════════════════════════════

## 6 · Wisdom-Mutant — auto-adapt

Every `mneme ask` records:

- Provider success/failure (`provider:groq`, `provider:ollama`)
- Latency per provider
- Scoring weight effectiveness (`scoring:rrf-k=60`, `scoring:semantic-weight=0.7`)
- Intent classifier accuracy

Stored in `.mneme/mutant.json`. Old data decays (counts halve after 7 days). Recommendations:

```typescript
recommend(state, "provider:")
// → { bestAxis: "provider:groq", successRate: 0.94, reason: "94% success over 23 calls" }
```

Result: the resilient enricher's order **evolves on your machine** to match what's actually working — without you touching anything.

═══════════════════════════════════════════════════════════════════════════════

## Origin

Inspired by KAT-0B, a Rust microGPT with speculative decoding (DDTree, Computable LoRA, Leviathan Algorithm 1) that solves Arto Inkala's "world's hardest Sudoku" in 36.4ms — no GPU. Five of its six core ideas transfer to retrieval-grounded generation. Mneme v0.23 is the result.

═══════════════════════════════════════════════════════════════════════════════

## Related pages

- 🛡 [[Forensic-Code-Science]] — ConstraintPruner is the trait that powers forensics
- 📊 [[Novel-Algorithms]] — TDWE / RACB / ADS / CGAR (these compose with DDTree)
- 🍳 [[Recipes]] — multi-command workflows now session-aware
