# 🏛 KERYX — the herald: one gate, every chat

> **Telegram works behind NAT with zero server** (the laptop long-polls out). But **LINE,
> Slack, Discord, WhatsApp are webhook-based** — they push to a public endpoint a laptop
> behind NAT can't expose. **KERYX** is the dumb, signed relay that fixes this for *every*
> chat at once — a genius wisdom-gate like the Telegram pager, but open to any provider.

## The idea (one picture)

```
ANY chat  ──webhook──▶  KERYX relay (public · your DO droplet · gephyra serve)
(LINE / Slack /          ▲   │
 Discord / WhatsApp)      │   │  signed envelope (summary + hash only)
                         │   ▼
        local Mneme daemon ──outbound WS/SSE──┘   (the laptop reaches OUT — no public IP, behind NAT)
```

The relay is **deliberately dumb**: it can *route* an envelope but never *forge* one, never
read your code, never replay. The brain stays on **your** machine — exactly like the Telegram
pager — only now any chat platform can reach it.

## The four guarantees (protocol — `keryxGauntlet = 100`, shipped in `@mneme-ai/core/keryx`)

1. **PRIVACY** — an envelope carries only a human *summary* + a sha256 *command-hash*. The raw
   command/secret **never** crosses the relay. (`envelopeLeaksRaw` proves it.)
2. **UNFORGEABLE** — every envelope is signed with the daemon's key; the relay (which never
   holds that key) **cannot fabricate** an approval. Tamper the payload → verify fails.
3. **REPLAY-PROOF** — nonce + TTL: a captured envelope is useless after its window.
4. **CHANNEL-AGNOSTIC** — the *same* signed envelope works over LINE / Slack / Discord /
   Telegram. The transport is dumb; the signature is the truth.

`mneme keryx demo` shows a signed ask→answer round-trip; `mneme keryx verify <file> --secret …`
verifies an envelope offline.

## How it's different from a hosted remote-control

A normal bot puts the brain in the cloud. KERYX keeps the brain **local** and uses the relay
only as a **signed switchboard** — so even though there's now a public endpoint (needed for
webhook providers), it can't read your code, can't forge an approval, and can't replay one.
You get LINE/Slack/Discord reach *without* surrendering the privacy model.

## Connect your chat — pick one, minimal steps 🎉

Your AI sends the **ask outbound** straight to the chat (push — works behind NAT). Only a
**reply** is a webhook, and that's the one thing the tiny KERYX relay catches for you.

### ⭐ Telegram — zero relay, works right now
The simplest path; nothing to deploy. Just:
1. Telegram → **[@BotFather](https://t.me/BotFather)** → `/newbot` → copy the token.
2. Tell your AI: *"set up phone approvals, token: …"* → it runs `mneme pager autosetup`. **Done.**

### 🟩 LINE · 🟪 Slack · 🟦 Discord · 🟢 WhatsApp — one relay, then one webhook each
You host the relay once (on a small box / your DO droplet) — it's a dumb, signed switchboard:

1. **Run the relay** (one command, public URL):
   ```bash
   mneme gephyra serve --port 17742        # then expose it (a tunnel or your droplet's IP)
   ```
2. **Make the chat app + grab its token** (≈2 min each):
   | Provider | where | token |
   |---|---|---|
   | **LINE** | [developers.line.biz](https://developers.line.biz) → Messaging API channel | Channel access token |
   | **Slack** | [api.slack.com/apps](https://api.slack.com/apps) → Interactivity on | Bot token `xoxb-…` |
   | **Discord** | [discord.com/developers](https://discord.com/developers/applications) → Bot + Interactions | Bot token |
   | **WhatsApp** | [developers.facebook.com](https://developers.facebook.com) → WhatsApp Cloud API | Access token |
3. **Point that app's webhook** at your relay: `https://<your-relay>/keryx/webhook/<provider>`
   (`/keryx/webhook/line`, `/slack`, `/discord`, `/whatsapp`).
4. **Give Mneme the token** and you're live — your AI pushes asks to that chat, you tap, the
   reply flows back through the relay.

> The buttons your AI sends carry a tiny `keryx:<id>:<answer>` tag, so a reply from **any**
> provider is understood the same way — that's why one relay covers them all.

## Status (honest — no overclaim)

| Piece | State |
|---|---|
| **Protocol** (signed envelope · privacy · replay-proof · channel-agnostic) | ✅ shipped + measured (`keryxGauntlet=100`) |
| **Relay inbound** (webhook → parse → per-daemon queue → drain) | ✅ shipped + system-tested for LINE/Slack/Discord/WhatsApp button replies |
| **Telegram** (full loop, no relay) | ✅ live-proven |
| **Per-provider outbound send** (push the ask to LINE/Slack/Discord/WhatsApp) | 🔜 rolling out — needs your provider token to validate live |

> **Trust model (honest):** the relay is *your* server, semi-trusted like Telegram's API. It
> **can't read your code** (only a summary + hash ever leaves the machine) and **can't alter
> the ask** (it's signed). It faithfully relays the reply — the same trust you already place in
> Telegram's servers. Zero-trust-relay for the *answer* is not claimed.
