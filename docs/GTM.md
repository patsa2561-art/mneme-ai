# Mneme — Go-to-Market playbook (honest, solo-dev-realistic)

> Rule for every claim here: if it isn't measured in-repo or true today, it doesn't ship in the copy.
> No fake metrics, no "10,000 users", no projections dressed as facts.

---

## 1. The Wedge — lead with ONE thing, not 988 tools

The #1 GTM risk is the 988-tool firehose: a newcomer bounces. **Sell one sharp wow; the rest is depth
they discover later.** Two wedges for two motions:

### 🥇 Primary (developer / HN / X launch): **Cosmic Pager**
*"Approve your AI agent's risky actions from your phone — laptop lid closed."*
- **Why it wins:** instantly understandable, novel, demoable in 30s, and devs *feel* the pain it solves
  (babysitting an agent). No server (the laptop long-polls Telegram behind NAT). One screenshot sells it.
- **The demo that converts:** lid closes → agent hits `rm -rf` → phone buzzes → tap ⛔ → agent stops. Live.

### 🥈 Secondary (broad / viral / non-dev): **Browser Polygraph**
*"Truth dots beside every sentence on ChatGPT / Gemini / Claude.ai."*
- **Why it spreads:** every AI-chat user is the TAM; a screenshot of a *red dot on a confident lie* is
  inherently shareable. One command + a Tampermonkey click.

> Everything else (memory, HA relay, agent-fit, live-proof, X-Ray) is **act two** — the depth that
> earns retention + the CEO/enterprise conversation. Don't lead with it.

## 2. Positioning (the honest moat)

**One-liner:** *Mneme is the neutral trust + memory layer for AI agents — it never asserts a falsehood
(prove-or-unknown), remembers across vendors, and proves what every agent did. Local-first, signed,
owned by no AI vendor.*

The defensible truth (not "1000× smarter"): **a model vendor cannot credibly build a neutral
cross-vendor trust layer — it grades its own homework.** Mneme can, because it belongs to none of them.
That position is the moat.

## 3. Who, in order (ICP sequence)

1. **Devs running coding agents** (Claude Code / Cursor / Cline) — reachable on HN/X/Reddit, feel the
   pain, install from npm in seconds. **Start here.**
2. **AI-chat power users** — via the Polygraph (viral loop).
3. **Teams / leads** — once a dev adopts the pager, the team wants the signed audit (`mneme proof` / `agentcert`).
4. **CEO / compliance / regulated** — the accountability layer (offline-verifiable), longest cycle, highest value.

## 4. Launch sequence (solo-dev realistic)

- **Week 0 — polish the wedge:** the pager 60-sec onboarding must be flawless (it is — autosetup +
  zero-config). Record a 30-sec screen capture of the lid-closed-approve demo.
- **Week 1 — Show HN:** *"Show HN: Approve your AI coding agent from your phone (lid closed, no server)."*
  Link the 30-sec demo + the npm one-liner. Be in the thread all day, honest about limits.
- **Week 1 — X/Twitter:** the demo GIF + the one-liner. Tag the agent communities (Cursor/Cline/Claude Code).
- **Week 2 — Polygraph drop:** *"I built truth-dots for ChatGPT"* + a screenshot of a caught hallucination.
- **Week 3 — Product Hunt:** bundle both wedges under the "neutral trust layer" story.
- **Ongoing:** dogfood publicly — post your own `mneme proof` scorecard (it's signed, so it's credible).

## 5. Pricing (honest tiers)

- **Free — Local (forever):** the CLI + MCP + pager (Telegram) + verify + memory. Single machine. No server.
  *(This is most of the value. Free is the funnel, not a crippled demo.)*
- **Pro — Hosted relay ($/mo):** the multi-provider relay (LINE/Slack/Discord/WhatsApp) + HA, so a
  team doesn't run their own droplet. This is the natural paid line (it's real infra you operate).
- **Enterprise — Accountability ($$$):** signed audit/attestation at scale, on-prem relay, SSO, the
  offline-verifiable compliance trail (`canon` / `agentcert` / `axia`).

Charge for **operated infra + compliance**, never for the local truth/memory core (that's the moat-builder).

## 6. The 2-minute demo (reproducible, all verified)

1. `npm i -g mneme-ai` → `mneme pager autosetup --telegram-token <t>` → close lid → trigger an agent
   action → approve on phone. *(the wow)*
2. `mneme verify "WWII ended in 1944"` → REFUTED with evidence. *(prove-or-unknown)*
3. `mneme proof` → the signed per-agent scorecard → `mneme proof verify` → 🔒 chain intact. *(measured + signed)*
4. `mneme signal --bench` → precision/recall 1.0 on a labeled corpus. *(it's measured, not claimed)*

## 7. Landing copy (drop-in)

> # Your AI works. Mneme makes it trustworthy.
> Approve risky agent actions from your phone. Catch hallucinations before they reach you. Prove what
> every agent did — signed, offline-verifiable, owned by no AI vendor.
> `npm i -g mneme-ai`
>
> **Approve from your phone** · lid closed, no server — [30s demo]
> **Never asserts a falsehood** · prove-or-unknown (TRUE / FALSE / UNKNOWN), measured
> **Proof, not a promise** · every assist counted + hash-chained — verify it yourself, offline

## 8. DIAKRISIS — say / don't say

| ✅ Say (true, measured) | ❌ Don't say (unprovable / hype) |
|---|---|
| "never asserts a falsehood (prove-or-unknown)" | "always right / 100% accurate" |
| "neutral layer no vendor can own" | "1000× smarter than other tools" |
| "every assist counted + signed (verify offline)" | invented user counts / revenue |
| "works with Claude Code / Cursor / … (see `mneme fit`)" | "works perfectly inside every model" |
| "HA relay verified 2-node" | "infinitely scalable / zero-downtime guaranteed" |

The honesty *is* the brand: a trust tool that overclaims is dead on arrival. Underclaim, then
over-deliver — and let the signed proof do the talking.
