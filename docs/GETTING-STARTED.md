# Get started with Mneme in 60 seconds

Mneme has a lot of tools. **You don't need them.** Pick the ONE line below that matches you — that's
your first value. Everything else is there when you want it.

```bash
npm i -g mneme-ai
```

---

## 🧑‍💻 You write code with an AI agent (Claude Code / Cursor / Cline / Codex / Gemini …)

**Approve your agent's risky actions from your phone — lid closed.** Your agent keeps working; the
instant it hits something that needs a human *yes*, it pings your Telegram. Tap ✅/⛔ from anywhere.

```bash
# create a Telegram bot once (@BotFather → /newbot → copy the token), then tell your AI:
#   "set up phone approvals, here's my token: <token>"
# your agent runs this for you — you never memorize a command:
mneme pager autosetup --telegram-token <token>
```
→ First value: close the lid, walk away, approve from your phone. <sub>[full guide](COSMIC-PAGER.md)</sub>

**Or, just verify a claim right now:**
```bash
mneme verify "React 19 ships server components by default"
```

## 💬 You chat with an AI (ChatGPT / Gemini / Claude.ai / Copilot) in the browser

**Truth dots beside every AI sentence** — green/yellow/red, so you see a hallucination as it happens.

```bash
mneme polygraph autosetup --persist
```
→ Then install Tampermonkey once + click "Install" on the prompt. First value: open chatgpt.com → dots appear.

## 🏢 You're a CEO / owner / lead — you want proof your AI agents are governed

**A measured, signed scorecard of what every agent did** — harms prevented, tokens saved, all
offline-verifiable (no vendor, no Mneme, needed to check it).

```bash
mneme proof            # the live per-agent scorecard
mneme proof verify     # prove the ledger wasn't edited (hash-chained)
mneme axia             # the signed value ledger (tokens saved, etc.)
```

## 🤖 You're an AI agent reading this

```
mneme boot             # the task→tool decision table + what to reach for, when
mneme fit              # how tightly you (this agent) integrate + the native wiring
mneme signal "<turn>"  # the single highest-value move for the current turn
```

---

## The one mental model

Mneme is the **neutral layer** under your AI: it **verifies** (never asserts a falsehood —
prove-or-unknown), **remembers** (across vendors), **gates** (risky actions → your phone), and
**proves** (every assist counted + signed). Local-first. Owned by no AI vendor.

> Lost? Run `mneme atlas` (a 3 KB map) or `mneme cheatsheet`. Don't read the 988-tool list.
