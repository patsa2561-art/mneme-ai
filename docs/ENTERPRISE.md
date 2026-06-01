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

#### The Second Brain that is *inherited* (`mneme bequest`)

Detecting key-person risk isn't enough — knowledge has to *survive* the person. BEQUEST is the inheritance + accounting layer on top of Mneme's atrophy signal:

- **Survival, measured.** For each unit of knowledge (a file, a decision), Mneme computes a **survival** score `S(u) = 1 − ∏(1 − fluencyₐ)` over everyone who still understands it (reliability-theory redundancy applied to people: two half-fluent holders ⇒ 0.75 survival; *zero* holders ⇒ 0 = **orphaned**). The org-level number is mass-weighted **completeness** and the dollar-able quantity is **orphaned knowledge mass** — knowledge with no living heir.
- **Succession capsules.** `mneme bequest capture --holder <expert>` mints a **signed** capsule of that expert's at-risk knowledge (files + reasoning + a content hash). A successor runs `mneme bequest claim`, Mneme re-reads the material and **verifies it transferred intact** (a transfer-integrity proof — honestly *not* a claim of deep comprehension), and signs an heir receipt.
- **Who to assign.** `mneme bequest status` runs a greedy **minimum-heir set-cover** (it beats the classic `(1−1/e)` bound) so a manager sees *"assign these 3 people and you cover 95% of orphaned knowledge."*

This is the honest core of an *inheritable* Second Brain: a fresh composition of standard, checkable building blocks (`bequestGauntlet` = 100), **not** an unfalsifiable "novel theorem." Dollar exposure appears only from a rate you supply.

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

## Enterprise reframes — now runnable (`mneme exec`)

The same proven engines, framed for the decision a buyer is making, each a real CLI verb that calls the underlying git/ledger signal. Nothing here is a new claim or a forecast: present-tense signals from real history, and **dollar figures appear only when you supply your own rate** (always labelled "your rate × measured signal"). Every report is NOTARY-signed.

| Command | Enterprise frame | The honest signal it computes |
|---|---|---|
| `mneme exec keyperson [--replacement-cost N]` | **Key-Person Dependency & Flight Risk** | files with **no live expert** (bus-factor = 1) + knowledge concentration, from the atrophy/Ebbinghaus model over git history — not a prediction of who will quit |
| `mneme exec talent [--top N]` | **Talent Mapping** | who actually collaborates with whom (shared files + synchrony + carry-on), from git traces — org-chart truth, not self-report |
| `mneme exec governance [--debt-cost N]` | **Governance / Tech-Debt Liability** | open + stale **promises** mined from commit/PR text and tracked through git history |
| `mneme exec burn [--price-per-1k N]` | **Realized Value (asset side)** | input-context tokens Mneme has **actually** saved (the signed ledger) → USD at *your* vendor price |
| `mneme exec roi --team N --per-dev M [--price-per-1k P]` | **ROI Projection** (Pay-per-Token-Saved) | the **measured** per-reduction saving rate × *your* team/usage/price — a transparent projection (proven monotonic, zero-bounded, dollar-identity-exact over a 5,000-case sweep), never a business forecast |
| `mneme exec mcp-audit [--budget N]` | **Agent MCP Attack Surface** (Pillar 3) | the MCP servers wired into your agents, per-server risk, and the transitive bypass budget — the governed-boundary check (exits non-zero over budget) |

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
