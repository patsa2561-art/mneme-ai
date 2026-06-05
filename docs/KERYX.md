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

## One agent, every chat — answer ONCE, it clears everywhere ✅

**Q: If one AI agent is connected to Telegram + LINE + Slack + Discord + WhatsApp and it asks
you, does the question go to all of them — and if I tap on one, do the others clear?**

**A: Yes to both.** An ask **fans out to every connected provider at once** (`mneme keryx
broadcast`). The **first answer wins** (the answer id is one-time), and the question is
**cleared on every other provider**:

| Provider | how it clears |
|---|---|
| **Telegram · Slack · Discord** | the message is **edited** — buttons vanish, replaced by *"✅ answered on \<provider\>"* |
| **LINE · WhatsApp** | no edit/recall API → a **follow-up** *"answered elsewhere"* is posted; a late tap is **safely ignored** (first-wins dedup) |

`mneme keryx bridge` runs the loop: it drains the relay, marks the first answer, and clears
the rest. *(Proven end-to-end: a Discord tap → Telegram & Slack edited, LINE notified, the
duplicate ignored.)*

## ✅ The relay handles each provider's quirk for you

You don't have to fight the per-platform webhook formats — the relay normalizes them:
**Slack** sends `application/x-www-form-urlencoded` (`payload=…`) → auto-decoded · **Discord**
sends a `PING` to verify the endpoint → auto-answered with `PONG` · **WhatsApp/Meta** verifies
with a `GET ?hub.challenge=…` → auto-echoed. (All tested.) The button you send carries
`keryx:<id>:<answer>`, so a tap from any of them is understood identically.

## Test it per provider (after `mneme keryx providers` shows it connected)

**Step 0 — make your relay public (once).** On your DO droplet: `mneme gephyra serve --port 17742`
→ your relay is `http://<droplet-ip>:17742`. (Local box? `cloudflared tunnel --url http://localhost:17742`
gives an `https://…` URL.) Use that as `<relay>` below.

### 🟪 Slack (easiest)
1. **api.slack.com/apps** → *Create New App* → *From scratch*.
2. *OAuth & Permissions* → add bot scope **`chat:write`** → *Install to Workspace* → copy **`xoxb-…`**.
3. *Interactivity & Shortcuts* → toggle **On** → *Request URL* = `<relay>/keryx/webhook/slack` → Save.
4. Invite the bot to a channel; copy that channel's id (`C…`).
5. `.mneme/keryx/providers.json`: `{ "slack": {"token":"xoxb-…","channel":"C…"} }`

### 🟦 Discord
1. **discord.com/developers** → *New Application* → *Bot* → *Reset Token* → copy. Also copy the **Public Key** (General Information).
2. Invite the bot to your server (OAuth2 URL, scopes `bot` + `applications.commands`, perm *Send Messages*).
3. **On the relay, set** `KERYX_DISCORD_PUBLIC_KEY=<public key>` (so the relay can verify Discord's Ed25519 signature — required, else Discord refuses the endpoint).
4. *General Information* → **Interactions Endpoint URL** = `<relay>/keryx/webhook/discord` → Save (the relay verifies the signature, auto-PONGs the test, and answers a button tap with *type 7* so the user never sees a red "interaction failed").
5. Copy your channel id. Config: `{ "discord": {"token":"…","channel":"<channelId>"} }`

### 🟩 LINE
1. **developers.line.biz** → a *Messaging API* channel → copy **Channel access token**.
2. *Webhook URL* = `<relay>/keryx/webhook/line` → enable *Use webhook*.
3. Add the bot as a friend; get your user id (`U…`). Config: `{ "line": {"token":"…","to":"U…"} }`

### 🟢 WhatsApp (Cloud API)
1. **developers.facebook.com** → app → *WhatsApp* → copy the **temporary access token** + **phone-number id**.
2. *Configuration* → Webhook *Callback URL* = `<relay>/keryx/webhook/whatsapp`, set any *Verify token* → Verify (the relay auto-echoes the challenge) → subscribe to **messages**.
3. Config: `{ "whatsapp": {"token":"…","phoneId":"…","to":"<your number, e.g. 66…>"} }`

### ✅ Pre-stage check (do this before any live demo)
Validate each provider's OUTBOUND send with YOUR token first — so nothing surprises you on stage:
```bash
mneme keryx test-send slack      # (or discord / line / whatsapp) → a test message should appear in that chat
```
If it lands, you're good. If it fails, it prints exactly why (bad token / channel / id) — fix before the demo.

### Then, for any of them:

```bash
mneme keryx broadcast --question "Deploy to prod?" --kind approve --relay https://<your-relay>
mneme keryx bridge   --relay https://<your-relay>      # in another terminal — receives + clears
```
- **Slack:** make a Slack app, enable **Interactivity**, set the Request URL to
  `https://<relay>/keryx/webhook/slack`, install to your workspace, put the bot token + channel
  in `.mneme/keryx/providers.json`. Tap a button → it resolves + the other chats clear.
- **Discord:** create a bot + an Interactions Endpoint URL `…/keryx/webhook/discord`; bot token
  + channel id in the config. Tap a button.
- **LINE:** Messaging API channel → webhook `…/keryx/webhook/line`; channel access token + your
  user id. Tap a template button.
- **WhatsApp:** Cloud API → webhook `…/keryx/webhook/whatsapp`; access token + phone-number id +
  your number. Tap an interactive button.

`.mneme/keryx/providers.json` (only fill the chats you use):
```json
{ "slack": {"token":"xoxb-…","channel":"C…"},
  "discord": {"token":"…","channel":"…"},
  "line": {"token":"…","to":"U…"},
  "whatsapp": {"token":"…","phoneId":"…","to":"…"} }
```

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
