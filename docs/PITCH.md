# Mneme — the neutral trust, memory & accountability layer for AI agents

> One line: **Mneme rides every AI agent's own architecture and makes each action provable** —
> it never asserts a falsehood (prove-or-unknown), it remembers across vendors, and it counts the
> value it delivered on every turn. Local-first, signed, owned by no AI vendor.

Every claim below is **measured + signed in-repo** (a gauntlet or a live verification) — not a slogan.
Where something is a limit, it says so (DIAKRISIS).

---

## The one structural advantage (why no vendor can copy it)

A model vendor's "trust layer" is self-serving — it grades its own homework. **Mneme is neutral:** it
is owned by no vendor, runs **local-first**, and every verdict is **Ed25519-signed + verifiable
offline** with no Mneme and no vendor in the loop. That is a *position*, not a feature — a vendor
structurally cannot occupy it. This is the honest reading of "no one else does this": not "1000× smarter",
but **the only cross-vendor layer every agent can share** because it belongs to none of them.

## The honest "100%"

Not "always right" (impossible). The real, measured 100% property: **0% false-assertion** — the savant
returns **TRUE / FALSE / UNKNOWN** and *abstains* rather than guess. A flagged UNKNOWN is a logged win
(the agent did not assert a falsehood). Falsifiable: `mneme savant gauntlet_public`.

---

## For each audience

| You are… | What Mneme gives you | Proof |
|---|---|---|
| **CEO / owner** | A signed, offline-verifiable record of what every AI agent did + a measured value scorecard (harms prevented, tokens saved) you can show a board/auditor/insurer | `mneme proof` · `mneme axia` · `mneme canon` (offline-verifiable) |
| **Developer** | Phone-approval for risky agent actions (lid closed), provable git/commit provenance, a relay that scales (HA) | Cosmic Pager · `mneme attest` · Keryx (2-node + LB + Redis, verified) |
| **Any AI-chat user** | Truth dots beside each AI sentence in the browser; verify any factual claim | Browser Polygraph · `mneme verify` |
| **Every agent** (Claude Code / Cursor / Cline / Codex / Gemini / Grok / …) | Mneme auto-fits each agent's native surface (MCP / hook / rules / browser) + a live per-turn signal | `mneme fit` (Claude Code FULL 100 · web LIMITED 8 — honest) |

## Live, every action

While you chat with your agent, Mneme works underneath: each MCP tool call is measured at one dispatch
point — a refuted claim → *hallucination caught*, a blocked secret → *leak blocked*, a gated command →
*command gated*, saved context → *tokens saved* — recorded against that agent. Open `mneme proof` to see
it accumulate. **The value is counted, not claimed.**

## Production-grade (verified this cycle)

- **Multi-provider approval** (Telegram + LINE/Slack/Discord/WhatsApp) — zero-config pairing: send one
  code to your bot, it links. First tap wins, the rest clear. Stress-proven over **100,000** chaotic
  cross-provider tap streams.
- **Security**: per-daemon key auth (no approval theft / no routing hijack), DoS rate-limit, key
  rotation — each verified live on the relay.
- **HA**: store-pluggable relay (FileStore single-node / RedisStore shared) — **2 nodes behind a
  load-balancer over shared Redis (AOF), verified end-to-end** (node A's webhook → node B's drain).
- **Operation Grant**: an agent runs a privileged batch under the human gate with **one** informed
  approval (scoped + TTL + use-bounded + signed) — not a bypass; off-plan still pages.

## The limits we state plainly

- Mneme does **not** run inside a hosted model — a browser-only chat integrates via a userscript bridge (LIMITED).
- "HA" verified here is process + node + shared-Redis on a host; **true multi-host** needs a 2nd machine (an infra step).
- The value ledger counts only what is **routed through Mneme** — it is honest about its own scope.

---

*Every capability here ships in `mneme-ai` on npm, each backed by an in-repo gauntlet scoring 100 and,
where it touches the world, a live verification. Trust stops being "believe the vendor" and becomes
"verify anyone."*
