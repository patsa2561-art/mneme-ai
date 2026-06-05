# 🟪 Connect Slack to KERYX

> ✅ **Relay-tested:** Slack sends button taps as `application/x-www-form-urlencoded` (`payload=…`);
> the KERYX relay auto-decodes that and routes the reply — verified live end-to-end. You only
> need to create the app + paste two values; follow the steps and it connects.

## 1. Make a Slack app (~3 min)
1. **<a href="https://api.slack.com/apps" target="_blank" rel="noopener">api.slack.com/apps</a>** → *Create New App* → *From scratch* → pick your workspace.
2. **OAuth & Permissions** → *Scopes* → *Bot Token Scopes* → add **`chat:write`** → scroll up → *Install to Workspace* → copy the **Bot User OAuth Token** (`xoxb-…`).
3. **Interactivity & Shortcuts** → toggle **On** → *Request URL* =
   ```
   https://<your-relay>/keryx/webhook/slack
   ```
   → **Save** (your own relay from the <a href="README.md" target="_blank" rel="noopener">relay setup</a>).
4. Invite the bot to a channel (`/invite @yourbot`) and copy that channel's id (`C…` — channel
   details → bottom).

## 2. Config + test
`.mneme/keryx/providers.json`:
```json
{ "slack": { "token": "xoxb-…", "channel": "C…" } }
```
```bash
mneme keryx test-send slack    # a message with Approve/Deny buttons appears in the channel
```
Tap a button → reaches your relay (Slack posts the action; KERYX auto-decodes Slack's
`application/x-www-form-urlencoded` body) → `mneme keryx bridge` delivers it. Done. 🎉

## Notes
- Slack messages **can** be edited, so when you answer elsewhere KERYX cleanly updates the Slack
  message ("✅ answered on …") and removes the buttons.
- Keep the bot token secret (it's `xoxb-…`); re-install rotates it.
