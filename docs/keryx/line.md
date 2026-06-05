# 🟩 Connect LINE to KERYX

**You need just 2 values: `channelId` + `channelSecret`.** Mneme mints the access token itself,
and broadcasts to your bot's friends (so you don't even need a user id).

## 1. Make a Messaging API channel (~3 min)
1. Go to **<a href="https://developers.line.biz/console/" target="_blank" rel="noopener">developers.line.biz/console</a>** → create a *Provider* → *Create a Messaging API channel*.
2. Open the channel → **Basic settings** tab → copy **Channel ID** and **Channel secret**.
3. **Messaging API** tab → scan the **QR code** with the LINE app → **Add friend** (so the bot can message you).

## 2. ⚠️ Turn ON "Use webhook" (the step everyone misses)
Still in **developers.line.biz** → your channel → **Messaging API** tab → **Webhook settings** →
toggle **"Use webhook" = ON**. *(If it stays off, taps never reach the relay — `active:false`.)*

## 3. Point the webhook at YOUR relay
In the same **Webhook settings**, set the **Webhook URL** to:
```
https://<your-relay>/keryx/webhook/line
```
(your own relay from the <a href="README.md" target="_blank" rel="noopener">relay setup</a> — not anyone else's). Hit **Verify** → should be Success.

## 4. Config + test
`.mneme/keryx/providers.json`:
```json
{ "line": { "channelId": "20xxxxxxxx", "channelSecret": "xxxxxxxx" } }
```
```bash
mneme keryx test-send line     # a buttons message should appear in your LINE chat with the bot
```
Tap a button → it reaches your relay → `mneme keryx bridge` delivers it to your agent. Done. 🎉

## Notes (honest)
- The minted token is short-lived (~30 days) — Mneme re-mints automatically from id+secret.
- No `to`? It **broadcasts** to all the bot's friends (perfect for a personal bot). To target one
  person, add `"to": "U…"` (your user id, from Basic settings → *Your user ID*).
- LINE can't edit/recall a sent message → when you answer elsewhere, KERYX posts a short
  "answered elsewhere" follow-up instead (a late tap is safely ignored — first answer wins).
