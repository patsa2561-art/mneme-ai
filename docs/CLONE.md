# 📡 Mneme Clone

**One verb to move your current AI conversation anywhere — another editor, your phone, a second PC.**

You don't paste history. You don't re-explain context. You don't remember command names.

[🇹🇭 ภาษาไทย ↗](./CLONE-th.md)

---

## What is Clone?

When you're working with an AI editor (Claude Code, Cursor, Codex, Cline, Continue, Zed), the conversation lives only in that one window. The moment you switch tools — or devices — context dies.

`mneme clone` captures **the current conversation in real time** and ships a portable "soul prompt" to whichever destination you want. Paste it in the new AI; it picks up where you left off.

Three transports cover every scenario:

| You want to… | Type | What happens |
|---|---|---|
| Open this conversation in another AI on **the same computer** | `mneme clone` | Soul prompt goes to your clipboard. Open the new editor, press Ctrl/Cmd-V. |
| Move it to your **phone or iPad** on the same WiFi | `mneme clone qr` | Local web server + scannable QR. Phone scans → soul auto-copies to phone clipboard. |
| Send to a **different network** (home PC, cellular, colleague) | `mneme clone remote` | Anonymous public URL + QR. Recipient opens the URL. |

---

## Quick start

### 1. Same machine, different AI

```bash
mneme clone
```

```
📡 MNEME CLONE — clipboard
  ✅ written via win-clip  (8,016 bytes · ~1455 tokens)

  Next: open Claude Code / Cursor / Codex in your destination workspace,
        click into the chat box, press Ctrl+V, send.
```

That's it. Open the destination editor, paste, send. The new AI sees the conversation as its own memory.

### 2. Send to your phone (same WiFi)

```bash
mneme clone qr
```

You get:
- Two or three LAN URLs (Mneme picks the right network interface)
- An inline SVG QR an AI agent can render directly in chat
- A token-gated short-lived HTTP server that auto-stops after 10 min idle

Scan the QR with your phone camera. The page that opens auto-copies the soul prompt to your phone clipboard.

### 3. Cross-network handoff

```bash
mneme clone remote
```

Uploads to `dpaste.com` (anonymous, 1-day expiry by default) and returns a short public URL. Open it on any device, copy the soul prompt, paste in your AI.

> ⚠ **PUBLIC paste.** Anyone with the URL can read until it expires. Never use for sessions that contain secrets, API keys, or PII.

---

## Don't memorize the verb

You don't have to type `mneme clone`. The AI agent in your editor reads Mneme's rule set and recognises natural-language intent, in English or Thai:

> *"clone this session"* · *"send brain to another AI"* · *"ส่งสมอง"* · *"ย้ายไปคุยต่อใน Cursor"* · *"continue elsewhere"*
> → fires `mneme clone` automatically

> *"send to my phone"* · *"beam to iPad"* · *"ส่งสมองไปมือถือ"* · *"แสกน QR"*
> → fires `mneme clone qr` automatically

> *"send to my home PC"* · *"phone is on cellular"* · *"ส่งไปคอมที่บ้าน"*
> → fires `mneme clone remote` automatically

The AI surfaces the result in plain language — *"Your conversation is on the clipboard. Open Cursor and paste."* You never see the verb.

---

## How it actually works

`mneme clone` composes three Mneme primitives — but you don't need to know them. For the curious:

1. **`live_session_mirror`** — Mneme reads your AI editor's local conversation file (`~/.claude/projects/<repo>/<id>.jsonl`) directly. No vendor API. No daemon recording. Your own data on your own disk.
2. **`genesplice.compressToSoulPrompt`** — turns the last 30 turns into a ~1500-token portable prompt with voice directives, dictionary, version gate, and HMAC-signed origin.
3. **Transport** — clipboard (OS native), beacon (local HTTP + QR), or relay (anonymous paste).

Everything is local-first. The clipboard and LAN transports never touch the internet.

---

## Options

```
mneme clone [transport]

  transport            clipboard | qr | remote   (default: clipboard)

Options:
  --receiving-vendor   Vendor tailoring: claude / chatgpt / gemini / cursor / cline / codex
                       Phrases the soul prompt for the destination's quirks.
  --last-n <n>         How many recent turns to include (default 30)
  --port <n>           LAN port for `qr` transport (default 7741)
  --json               Machine-readable output
```

---

## Common questions

**Does the new AI need Mneme installed?**
No. The soul prompt is plain text. Any AI that accepts paste works. Mneme on the destination unlocks extra features (memory chain, polygraph verification) but isn't required to resume.

**What does the destination AI actually see?**
A self-contained prompt with: voice directive (how to behave), Mneme dictionary (so it doesn't misinterpret jargon), origin metadata (HMAC-signed), context summary, recent turns, decisions extracted. About 1,500 tokens — fits in any AI's first message.

**My clipboard sync (Phone Link / Universal Clipboard / KDE Connect) is set up — will the clipboard transport reach my phone?**
Yes. `mneme clone` writes to the OS clipboard; your sync provider mirrors it to the phone within seconds. No QR needed.

**Is the LAN URL secure?**
The URL contains a 12-character random token. Without the token, the server returns 404 — port scanners can't see your soul prompt. The server also auto-stops after 10 min idle.

**Can I clone from Cursor / Codex / Cline?**
Today the live mirror reads Claude Code session files. Cursor and Cline write conversations to their own stores; mirror support for those is on the roadmap. For now, clone from a Claude Code window.

---

## Related

- [Mneme README](../README.md)
- [Quickstart (EN)](./QUICKSTART.md) · [Quickstart (TH)](./QUICKSTART-th.md)
