# 🟦 Connect Discord to KERYX

Discord is the strictest: its Interactions endpoint **must verify an Ed25519 signature** and
answer a verification PING. KERYX does both for you — you just supply the **Public Key**.

## 1. Make a Discord app + bot (~4 min)
1. **<a href="https://discord.com/developers/applications" target="_blank" rel="noopener">discord.com/developers/applications</a>** → *New Application*.
2. **General Information** → copy the **Public Key**.
3. **Bot** → *Reset Token* → copy the **bot token**.
4. **OAuth2 → URL Generator** → scopes `bot` + `applications.commands`, permission *Send Messages*
   → open the URL → add the bot to your server. Copy your channel id (right-click channel → *Copy ID*; enable Developer Mode if needed).

## 2. Tell the relay your public key
On the box running your relay, set the env var **before** starting it:
```bash
export KERYX_DISCORD_PUBLIC_KEY=<your app Public Key>
mneme gephyra serve --port 17742
```
(KERYX uses it to verify Discord's signature — required, or Discord refuses the endpoint.)

## 3. Set the Interactions endpoint
**General Information** → **Interactions Endpoint URL** =
```
https://<your-relay>/keryx/webhook/discord
```
→ **Save** (Discord sends a signed PING; the relay verifies + PONGs → it saves successfully).

## 4. Config + test
`.mneme/keryx/providers.json`:
```json
{ "discord": { "token": "<bot token>", "channel": "<channel id>" } }
```
```bash
mneme keryx test-send discord   # a message with Approve/Deny buttons appears in the channel
```
Tap a button → the relay verifies the signature, records the answer, and replies **type 7** so
the buttons vanish and you never see a red *"interaction failed"*. `mneme keryx bridge` delivers
it to your agent. Done. 🎉
