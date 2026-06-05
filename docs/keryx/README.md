# 🏛 KERYX — connect any chat (per-provider guides)

KERYX lets your local AI agent ask you for approval through **any** chat app. Telegram needs
no server; **LINE / Slack / Discord / WhatsApp** are webhook-based, so they need a tiny public
**relay** — *your* relay, on *your* box.

## First: run your own relay (once, ~1 min)

A provider's "reply" is a webhook → it needs a public HTTPS URL. Run the relay on any box with
a public address (a $5 droplet, a VPS, or your machine + a tunnel):

```bash
mneme gephyra serve --port 17742
```
- **On a server with a domain/IP** → put it behind Caddy/nginx for HTTPS:
  `https://<your-host>/keryx/...`
- **On your laptop** → `cloudflared tunnel --url http://localhost:17742` gives an `https://…` URL.

Your webhook base is then `https://<your-relay>/keryx/webhook/<provider>`. **This is YOUR URL —
you never depend on anyone else's server; the brain + the relay are both yours.**

> Only a one-line *summary + hash* ever crosses the relay (never your code), approvals are
> signed + replay-proof. The relay is your own box — semi-trusted like Telegram's API.

## Pick your chat — step-by-step guides

| Provider | Setup | Guide |
|---|---|---|
| ⭐ **Telegram** | zero relay — just a bot token | <a href="../COSMIC-PAGER.md" target="_blank" rel="noopener">Cosmic Pager →</a> |
| 🟩 **LINE** | channel id + secret → webhook | <a href="line.md" target="_blank" rel="noopener">LINE guide →</a> |
| 🟪 **Slack** | bot token + Interactivity URL | <a href="slack.md" target="_blank" rel="noopener">Slack guide →</a> |
| 🟦 **Discord** | bot token + public key + endpoint | <a href="discord.md" target="_blank" rel="noopener">Discord guide →</a> |
| 🟢 **WhatsApp** | Cloud API token + webhook | <a href="whatsapp.md" target="_blank" rel="noopener">WhatsApp guide →</a> |

Config lives in `.mneme/keryx/providers.json` (fill only the chats you use). Then:
```bash
mneme keryx test-send <provider>     # confirm OUTBOUND works (a test message appears)
mneme keryx broadcast --question "Deploy?" --kind approve --relay https://<your-relay>
mneme keryx bridge   --relay https://<your-relay>      # receives the reply + clears the other chats
```
