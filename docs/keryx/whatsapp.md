# 🟢 Connect WhatsApp to KERYX (Cloud API)

> ✅ **Relay-tested:** Meta verifies the webhook with a `GET ?hub.challenge=…` (the relay
> auto-echoes it) and delivers button taps as a nested `interactive.button_reply.id` (the relay
> parses it) — both verified live end-to-end. Follow the steps and it connects.

## 1. Set up WhatsApp Cloud API (~5 min)
1. **<a href="https://developers.facebook.com/apps" target="_blank" rel="noopener">developers.facebook.com/apps</a>** → *Create app* → add the **WhatsApp** product.
2. **WhatsApp → API Setup** → copy the **temporary access token** + the **Phone number ID**, and add **your phone number** as a recipient (verify it).

## 2. Set the webhook
1. **WhatsApp → Configuration** → *Callback URL* =
   ```
   https://<your-relay>/keryx/webhook/whatsapp
   ```
   (your own relay — see the <a href="README.md" target="_blank" rel="noopener">relay setup</a>). *Verify token* = any string you choose.
2. Click **Verify and save** — Meta sends a `GET ?hub.challenge=…`; the relay auto-echoes it → ✓.
3. Under *Webhook fields* → **subscribe to `messages`**.

## 3. Config + test
`.mneme/keryx/providers.json`:
```json
{ "whatsapp": { "token": "<access token>", "phoneId": "<phone number id>", "to": "<your number, e.g. 66xxxxxxxxx>" } }
```
```bash
mneme keryx test-send whatsapp   # a message with reply buttons appears in WhatsApp
```
Tap a button → Meta posts it to your relay (nested `interactive.button_reply.id`, parsed
automatically) → `mneme keryx bridge` delivers it. Done. 🎉

## Notes (honest)
- The Cloud API *temporary* token expires in ~24h — for real use, generate a **permanent**
  System User token (Business Settings → System Users).
- WhatsApp can't edit a sent message → answering elsewhere posts an "answered elsewhere"
  follow-up; a late tap is safely ignored (first answer wins).
