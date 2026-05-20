# Mneme Quickstart (English)

> **Goal:** in 60 seconds you'll see live verification dots beside every sentence on any supported AI chat site — claude.ai, chatgpt.com, gemini.google.com, copilot.microsoft.com, chat.deepseek.com, chat.qwenlm.ai.

🇹🇭 [ภาษาไทย ↗](./QUICKSTART-th.md)

---

## 🚀 60-Second install

### 1. Install Tampermonkey (one-time, free)

Go to <https://tampermonkey.net> → click **Add to Chrome** (or Firefox / Edge / Safari / Brave).

### 2. Enable **Allow User Scripts** in Chrome

This is a Chrome rule for any userscript manager. Without it, nothing works.

1. Open `chrome://extensions/`
2. Find **Tampermonkey** → click **Details**
3. Scroll down → toggle **Allow User Scripts** to **ON** (blue)

### 3. Install Mneme + register auto-start

In any terminal (PowerShell / cmd / iTerm / GNOME Terminal):

```bash
npm install -g mneme-ai
mneme polygraph autosetup --persist
```

The `--persist` flag registers Mneme as an OS service that auto-starts on every login. **You'll never type this command again.**

### 4. Click "Install" in Tampermonkey

After step 3, a Tampermonkey page opens automatically. Click **Install** (or **Reinstall** if you've installed before).

### 5. Open any supported AI chat site

Go to **any** of these and ask any factual question:

- <https://claude.ai>
- <https://chatgpt.com>
- <https://gemini.google.com>
- <https://copilot.microsoft.com>
- <https://chat.deepseek.com>
- <https://chat.qwenlm.ai>

You should see:
- **Bottom-right corner:** a small black box `● MNEME POLYGRAPH 0/0` with a faint orange EKG line. This is proof Mneme is armed.
- **Top-right corner:** a purple `💉 Inject Mneme Soul` button. *(Different feature; you don't need it for dots — click it later if you want to know what it does.)*

---

## 💬 First test — type this and watch the dots

In the chat input, paste:

> *Anthropic was founded in 2018. List the first 5 prime numbers and tell me when WWII ended.*

This is a trap — Anthropic was founded in **2021**, not 2018. Mneme should catch it.

**What you should see in the AI's reply:**
- A coloured `●` dot appears at the **start of every sentence**
- 🟢 **Green** = the claim has supporting evidence in Mneme's memory
- 🟡 **Yellow** = no clear evidence either way (most general sentences land here)
- 🔴 **Red** = Mneme has evidence that contradicts the claim — **don't trust it**
- ⚪ **Grey** = bridge offline, or the sentence is too short to grade

The **EKG indicator (bottom-right)** updates: `2✓ 1✗ / 3` means "2 verified, 1 refuted out of 3 sentences."

**Click the EKG indicator** to expand a full panel showing:
- A colour legend (what green/yellow/red/grey mean)
- Total counts per colour
- Full list of every verdict with the sentence that triggered it
- A tip about when you'll see red vs green

---

## ❓ Why do I see mostly yellow?

Mneme is a **repo + indexed-memory** truth engine — it has strong signals for code, files, package versions, and facts in your `mneme index`. For general-knowledge sentences ("the sky is blue") it has no evidence either way, so it shows **yellow**. This is **honest by design** — Mneme refuses to fake confidence.

Want more **green/red**? Ask questions related to your indexed repo, or about specific facts (versions, dates, API signatures) that Mneme can verify against its memory.

---

## 🛠 Troubleshooting

| Symptom | Fix |
|---|---|
| No EKG box visible | Refresh the page. If still missing, check `chrome://extensions/` → Tampermonkey is enabled + script is active. |
| EKG shows "OFFLINE" | Bridge stopped. Run `mneme polygraph status` in terminal; if not running, `mneme bridge --detach` or `mneme bridge service install` for permanent auto-start. |
| All dots grey | Bridge running but token mismatch. Re-run `mneme polygraph autosetup --persist` to regenerate. |
| After reboot, nothing works | You didn't pass `--persist`. Run once more — done. |

---

## 🧠 The whole Mneme suite (after install)

Mneme is **persistent AI memory + a 14-verb Truth Suite**. The polygraph dots are one feature. Others (all work without re-installing anything):

- `mneme talk` — interactive chat that hands off to your local AI agent
- `mneme swarm --text "<paste>"` — fire every audit organ on an AI output in parallel
- `mneme cert mint --vendor X` — mint a tier-banded honesty certificate for any vendor
- `mneme jury --question Q --juror v1:answer ...` — multi-vendor consensus + dissent log
- `mneme polygraph timeline --vendor X` — daily honesty drift chart
- `mneme stream` — terminal ticker of every refuted polygraph verdict
- `mneme blame query --file F --line N` — git-blame for AI-written lines
- `mneme dep predict <pkg>` — probability an npm package is abandoned
- `mneme funeral <repo>` — literary eulogy for a dead repo
- `mneme confess submit ...` — record an AI hallucination, get a shareable card
- `mneme whistle scan --text "..."` — compliance scan on AI output
- `mneme socratic --file F` — AI asks 3 humble questions about your code
- `mneme gauntlet probes / grade` — 60-second honesty stress test for any vendor

Each one is documented in `mneme --help` and in your editor AI's `CLAUDE.md` / `AGENTS.md` / `GEMINI.md` (auto-generated on install).

---

## 📜 Full reference

- [README](../README.md)
- [AI Agent Contract](./AI_AGENT_CONTRACT.md) — what your AI agent will read on first contact
- [Demo dashboard](https://patsa2561-art.github.io/mneme-ai/) — visual demos of every feature
