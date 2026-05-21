# 🔴 Mneme Polygraph

**Live truth-check dots beside every sentence on hosted AI chat sites.**

[🇹🇭 ภาษาไทย ↗](./POLYGRAPH-th.md)

---

## What is Polygraph?

When you chat with hosted AI (claude.ai, chatgpt.com, gemini, copilot, deepseek, qwen), there's no signal telling you which sentences the AI is sure about and which are guesses. You either trust everything or doubt everything.

Polygraph adds a **per-sentence verdict dot** in real time:

| Dot | Meaning |
|---|---|
| 🟢 Green | Mneme has supporting evidence — safe to trust. |
| 🟡 Yellow | No clear evidence either way — most casual sentences land here. |
| 🔴 Red | Mneme has evidence that contradicts the claim — don't trust it. |
| ⚪ Grey | Bridge offline, or the sentence has no facts to grade. |

A floating EKG indicator in the bottom-right shows session health; click it for a full panel with verdict history, lens breakdown, and the colour legend.

**Six supported sites today:** claude.ai · chatgpt.com · gemini.google.com · copilot.microsoft.com · chat.deepseek.com · chat.qwenlm.ai

---

## Install (one command)

1. **Install Tampermonkey** (free, one-time) → https://tampermonkey.net
2. **Enable Allow User Scripts** in `chrome://extensions/` → Tampermonkey → Details → toggle ON
3. **In a terminal**, run:
   ```bash
   npm install -g mneme-ai
   mneme polygraph autosetup --persist
   ```
   *(`--persist` registers the bridge as an OS service so it auto-starts on every login. Never type this command again.)*
4. **Click Install / Reinstall** when the Tampermonkey page opens automatically.
5. **Open any supported AI chat site** and ask any factual question. The bottom-right `● MNEME POLYGRAPH` indicator means you're armed.

**Working with an AI agent?** Just say *"install polygraph"* / *"ติดตั้ง polygraph"* — agents reading `CLAUDE.md` / `AGENTS.md` run all three steps for you. You never have to remember the command.

---

## Try it — the 60-second test

Paste this into any supported chat site:

> *"Anthropic was founded in 2018. List the first 5 prime numbers and tell me when WWII ended."*

This is a trap (Anthropic was founded in **2021**, not 2018). When the AI replies, the first sentence should get a 🔴 **red dot** — Polygraph contradicts it. The primes and the WWII date should land 🟡 yellow or 🟢 green.

If the dots don't appear, see [Troubleshooting](#troubleshooting).

---

## How it works

Polygraph is **Ollama-free** — no local LLM, no cloud. It runs six "lens" detectors in parallel against every sentence:

| Lens | What it checks |
|---|---|
| 🌍 worldFact | Known-fact regex bank (founding years, primes, boiling point, WWII…) |
| 🎭 vibe | Confidence calibration — hedges vs absolutes |
| 🔬 specificity | Falsifiable surface area (numbers, named entities, version tokens) |
| ⚠️ risk | Whistleblower patterns (`rm -rf`, secret leaks, bypass-review) |
| 📐 math | Inline arithmetic check |
| 📎 citation | Does the sentence cite a source / URL / file? |

The verdicts compose into the final dot colour. Click the EKG → "Lens breakdown" to see which lens fired on which sentence.

Architecture:
- **Userscript** (Tampermonkey, MutationObserver) — watches the AI's response container, splits sentences, sends to bridge.
- **Bridge** (local HTTP, default port 17741) — runs the six lens detectors in ~300 ms.
- **Port-ladder rendezvous** — bridge and userscript independently walk ports 17741..17750 so Ollama / sibling Mneme installs / port squatters never break the install.

All local. The userscript never reaches the internet; the bridge never logs sentences (just verdicts).

---

## Update

Mneme ships frequently. When the pulse banner says a newer version is available, three commands cover it:

```bash
# 1. Upgrade the CLI + core libs
npm install -g mneme-ai@latest

# 2. Re-register the bridge (also re-emits the userscript)
mneme polygraph autosetup --persist

# 3. Click "Reinstall" when the Tampermonkey page opens
```

**Working with an AI agent?** Just say *"upgrade Mneme"* — agents reading `CLAUDE.md` see the auto-upgrade rule and run all three steps for you.

---

## Troubleshooting

**Dots are all grey.** Bridge isn't running. Try `mneme polygraph status` — if it reports offline, run `mneme bridge --detach` to start it manually, or `mneme polygraph autosetup --persist` to (re)install the OS service.

**Dots don't appear at all.** Check Tampermonkey is enabled in your browser, and that **Allow User Scripts** is toggled ON in `chrome://extensions/` → Tampermonkey → Details. The userscript runs on each supported site; click the Tampermonkey icon to confirm `Mneme Polygraph` shows ON for the current page.

**Tampermonkey didn't pop up after autosetup.** Run `mneme polygraph emit --output mneme.user.js` and double-click the file manually — Tampermonkey will prompt to install.

**Wrong port — "port 11434 in use".** Older versions defaulted to Ollama's port. New default is `:17741`. Run `mneme polygraph autosetup --persist` again to refresh.

**Polygraph says my claim is yellow but it's clearly a fact.** Yellow = "no clear evidence either way." World-fact coverage is growing every release — the trap sentences in the 60-second test are covered, but most casual sentences land yellow by design. Red is reserved for **contradicted** claims.

---

## CLI reference

```
mneme polygraph autosetup [--persist] [--output <path>] [--bridge-url <url>]
mneme polygraph install        # legacy 3-step manual flow
mneme polygraph emit           # write .user.js only
mneme polygraph status         # ping the bridge
mneme polygraph drift --vendor <v>   # honesty drift report
mneme polygraph timeline --vendor <v>  # bucketed honesty over time

mneme bridge [--port n] [--host h] [--detach]   # standalone bridge
mneme bridge service install   # OS-level auto-start (no admin needed)
```

---

## Related

- [Mneme README](../README.md)
- [Quickstart (EN)](./QUICKSTART.md) · [Quickstart (TH)](./QUICKSTART-th.md)
- [Clone guide](./CLONE.md) — move a session to another AI
