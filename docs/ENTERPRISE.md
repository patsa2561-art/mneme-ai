# Mneme for the Enterprise — Trust, Sovereignty, Cost

> **Read this first (the honesty contract).** Mneme is sold on what it can *prove*, not on what sounds good. Every number it reports is **measured and signed** (Ed25519 / HMAC), verifiable offline by your own risk officer. Where a value depends on your environment (e.g. cost), Mneme uses **your** vendor's price, never an invented one. Where something *cannot* be proven, Mneme says so — see [*What Mneme does NOT claim*](#what-mneme-does-not-claim). This is the moat: a vendor-neutral, local-first trust boundary you can audit, not a black box you must believe.

Mneme is **local-first** (it runs on your machine / your VPC, not ours), **vendor-neutral** (Claude / GPT / Gemini / Grok / Codex / a local model all cross the same boundary), and **MIT-licensed** (no lock-in). It bolts onto the agents your teams already use.

---

## The four pillars

### 1. 🛡 Absolute Trust Layer — *"every agent verifies before it acts"*

An agent that can call tools can do damage. Mneme sits in front as a **verify-before-act** boundary:

- **Truth gate** — a factual claim an agent is about to assert (a version, a number, an API signature) is checked; `REFUTED` is corrected before it reaches a human or another agent, `UNKNOWN` is surfaced honestly rather than guessed.
- **Cross-vendor consensus** — when a claim is high-stakes and a single model could be wrong, Mneme convenes an independent multi-vendor panel (no single vendor owns the verdict).
- **Command gating** — destructive shell actions are risk-classified and (for irreversible ones) require human co-sign.
- **Signed audit trail** — every verdict, every crossing, every gated command leaves a tamper-evident, **offline-verifiable** receipt (the NOTARY / FLIGHT RECORDER spine). A court, an insurer, or a CISO can verify the log *without trusting Mneme*.

### 2. 🔒 Sovereign / Air-Gapped AI — *"our code & secrets never leak to the model, with proof"*

This is the **SOVEREIGN EGRESS GUARD** (`mneme egress` / `mneme.egress.guard`) — the gem of the enterprise tier. Before any local context (source, logs, config) crosses to a hosted model or another agent, it crosses a deterministic boundary with three layers:

1. **Pattern redaction** — known secret classes (AWS / GitHub / OpenAI / Anthropic / xAI / Slack / PEM private keys / JWT / national-ID / card) are matched and removed from the outbound payload.
2. **Honeytoken tripwire** — you plant deterministic **canary** tokens (`mneme egress seed-canary`) in decoy configs. If a canary *ever* appears in an outbound payload, that is an exfiltration signal → instant **BLOCK** + signed alert. A canary can only be there if something read where it shouldn't — so this is provable, near-zero-false-positive exfil detection.
3. **Bloom secret-membership** — your real secrets are fingerprinted into a one-way **Bloom filter** that **never stores the secret**. Outbound tokens are tested against it, catching a custom key that matches *no* regex — with **no false negatives** (a registered secret always tests positive, so nothing slips) at a small, tunable false-positive rate, O(1) per token.

The result is a verdict (`ALLOW` / `REDACT` / `BLOCK`), the **safe redacted payload** to send instead of the raw one, and an **Ed25519 egress certificate that binds only the payload's hash** (never the payload or any secret) — so a risk officer can audit *what crossed and that nothing secret did*, offline. `mneme egress scan` exits non-zero on `BLOCK`, so it drops straight into CI / a pre-send hook.

> This is the honest core of "air-gapped / sovereign AI": a provable boundary you control. It is **not** a claim that any model is "unhackable," and it does not touch the OS kernel or a GPU's memory.

### 3. 🌐 Standard MCP boundary — *"one governed surface for all our agents"*

Mneme is a local-first **MCP server** every agent connects to, plus **capability passports** (short-lived, scoped, signed tokens that gate sensitive tool calls). Instead of N agents each wired to N tools with N security postures, you get **one** governed, audited surface — vendor-neutral and self-hostable.

### 4. 💰 Value-based cost — *"pay only for the tokens you actually save"*

Mneme does deterministic local work that shrinks what your agent sends to the model — **DISTILL** (compress a verbose error+diff to its causal brief), **LOOPGUARD** (stop a thrash before it burns retries), **NKL** (skip a proven dead-end) — and meters each **measured** reduction into a **signed, append-only ledger** whose aggregate is a commutative monoid (proven over a 1,000,000-case sweep). `mneme savings` reports the cumulative input-tokens saved, and the USD figure uses **your** vendor's price-per-1k. Falsifiable, not marketing → [`BUSINESS-MODEL.md`](BUSINESS-MODEL.md).

---

## Enterprise reframes of existing capabilities

The same engines, named for the decision a buyer is making. Nothing here is a new claim — it is the existing, tested capability framed for the org chart.

| Engine | Enterprise frame | The honest read |
|---|---|---|
| Knowledge-atrophy clock | **Key-Person Dependency & Flight Risk** | which areas of the codebase only one person still understands — a real signal from git history, not a prediction of who will quit |
| Cultural-alpha / stigmergy | **Talent Mapping** | who actually collaborates with whom, derived from commit traces |
| Promise-debt / governance | **Governance Gatekeeper / Tech-Debt Liability** | decisions compiled into runnable checkers that gate future commits; a signed record of which were violated |
| Visual knowledge map | **Capital Burn vs Asset Value** | a present-tense, signed snapshot of system state — a status surface, not a forecast |

---

## What Mneme does NOT claim

DIAKRISIS — discernment — is a feature, not a disclaimer. Mneme deliberately refuses the things that *sound* enterprise but cannot be proven:

- ❌ It does **not** make any model "unhackable" or guarantee zero hallucination. It makes a model's claims **checkable** and a payload's secrets **redactable, with proof**.
- ❌ The egress guard does **not** read kernel memory, inject into a GPU, or intercept network cables. It is a deterministic content boundary you place in front of egress.
- ❌ Token figures are a **labelled `≈chars/4` estimate** of *input* context (not a vendor tokenizer, no claim about the model's internal reasoning); USD uses a price **you** supply.
- ❌ The "flight-risk" / "liability" frames are **present-tense signals from real history**, not fortune-telling about the future.
- ❌ Mneme never auto-upgrades or self-installs, and it does no dark-web crawling, unauthorized access, or "decryption." Upgrades are fully manual and the boundary only ever sees what you hand it.

If a capability can't be measured and signed, Mneme returns `UNKNOWN` rather than a confident guess. That is the product.

---

## Try the trust boundary in 60 seconds

```bash
# plant an exfiltration tripwire once
mneme egress seed-canary --label prod

# scan an outbound payload (stdin / --file / --text); exit 2 on BLOCK
echo "deploy with AKIA1234567890ABCDEF" | mneme egress scan
#   ✂️  EGRESS REDACT — 1 secret(s) redacted · signed certificate (binds payload hash …)

# what has Mneme saved you so far (USD at your vendor's price)
mneme savings --price-per-1k 0.003
```

For the full primitive catalog see [`FUNCTIONS-EN.md`](FUNCTIONS-EN.md) · for the cost model [`BUSINESS-MODEL.md`](BUSINESS-MODEL.md) · for the savant philosophy [`ALETHEIA.md`](ALETHEIA.md).
