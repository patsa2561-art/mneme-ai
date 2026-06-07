# Mneme — demo recording scripts (shot-by-shot, every keystroke)

Two cuts: a **30-second hero** (the one that sells) and a **2-minute full**. Every command below is
real + verified — do not fake output. **Redact the Telegram token on screen** (use a placeholder or
blur). Record at a large terminal font (18–20pt), dark theme, 1280×720+.

---

## ✅ Pre-flight checklist (do this BEFORE recording — off camera)

1. `npm i -g mneme-ai` (already current).
2. Create a Telegram bot once: message **@BotFather** → `/newbot` → copy the token. Tap **START** on your new bot.
3. `mneme pager autosetup --telegram-token <TOKEN>` → confirm it says configured + you got a test message.
4. Open Telegram on your **phone** (this is the second device on camera).
5. A scratch dir for the "agent" to act in: `mkdir ~/demo && cd ~/demo`.
6. Clear the terminal, set the prompt clean (`PS1='$ '`), close other tabs.
7. Decide framing: **laptop terminal (left) + phone (right)** in one shot is the money frame.

---

## 🥇 THE 30-SECOND HERO — "Approve your AI agent from your phone"

> Goal: one unmistakable wow. No narration needed; on-screen captions carry it.

| Time | On screen (terminal) | Phone | Caption (overlay) |
|---|---|---|---|
| 0:00–0:03 | clean terminal, type: `mneme pager status` ↵ → shows `telegram configured` | — | **"Your AI agent runs. You approve it from your phone."** |
| 0:03–0:08 | type a risky agent command (simulated): `mneme pager request --agent "claude-code" --command "rm -rf ./build"` ↵ | — | **"Agent hits something risky…"** |
| 0:08–0:10 | terminal shows `decision: pending … paged:true` then WAITS (cursor blinks) | 📳 **buzzes** | **"…it asks YOU. Lid can be closed."** |
| 0:10–0:18 | (close the laptop lid here for effect, or keep terminal waiting) | Telegram shows the command + **✅ / ⛔** buttons — tap **⛔ No** | **"Tap from anywhere on earth."** |
| 0:18–0:23 | terminal unblocks → prints `permissionDecision: deny … the agent will not run it` | shows "⛔ Denied" | **"The agent obeys. Signed. No server."** |
| 0:23–0:30 | type `npm i -g mneme-ai` (just show the line) | — | **"`npm i -g mneme-ai` · free, local-first, MIT"** |

**The single frame that sells it:** the laptop terminal *frozen waiting* + the phone buzzing with the
approve/deny buttons. Make sure both are in shot at 0:08–0:18.

---

## 🎬 THE 2-MINUTE FULL — "the neutral trust layer"

**Beat 1 — Approve from your phone (0:00–0:35)** — run the hero demo above, full speed.

**Beat 2 — It refuses to guess (0:35–0:55)** *(honest: the CLI `verify` is tuned for checkable repo
specifics, so on a vague/world claim it returns **UNKNOWN** — and that IS the demo: it won't pretend.)*
```
$ mneme verify "this approach is definitely the fastest"
```
→ **UNKNOWN** — "refuses to auto-accept untested claims." Caption: **"UNKNOWN is a first-class answer — never a confident guess (0% false-assertion)."**
> ⚠️ Do NOT film `mneme verify "WWII ended in 1944"` expecting REFUTED — the CLI engine targets
> code/repo claims, not world-facts, so it returns UNKNOWN. The **world-fact "catch a confident lie"**
> moment is a *separate* cut — the **Browser Polygraph** (truth dots on ChatGPT), where a red dot on a
> hallucination is the wow. Don't conflate the two on camera.

**Beat 3 — Proof, not a promise (0:55–1:25)**
```
$ mneme proof
```
→ the per-agent scorecard (harms prevented · tokens saved). Caption: **"What it did for you — counted."**
```
$ mneme proof verify
```
→ `🔒 proof ledger VERIFIED — hash chain intact`. Caption: **"Signed. Edit one row → it breaks. Verify it yourself."**
*(optional, to prove the last claim live: open the ledger, change a number, re-run `mneme proof verify` → 🔴 BROKEN. Powerful.)*

**Beat 4 — It's measured, not claimed (1:25–1:45)**
```
$ mneme signal --bench
```
→ `precision 1 · recall 1 · F1 1 · 0 misses`. Caption: **"We measure our own detectors. Falsifiable."**

**Close (1:45–2:00)**
```
$ mneme fit
```
→ "You're in Claude Code → fit 100/100". Caption: **"Rides every agent's own architecture."**
End card: **"Mneme — the neutral trust layer for AI. `npm i -g mneme-ai` · owned by no vendor."**

---

## 🎙 If you narrate (voiceover script, ~matches the 2-min)

> "Your AI agent works fast — but you can't watch every move. Mneme lets it ask you, on your phone,
> the instant it hits something risky. *(tap deny)* It obeys — signed, no server, lid closed.
> And Mneme never asserts a falsehood — *(verify)* it says TRUE, FALSE, or honestly UNKNOWN, never a
> confident guess. Everything it does for you is counted and hash-chained — *(proof verify)* you can
> verify it yourself, offline, with no vendor and no Mneme. Even our own detectors are measured, not
> claimed. *(bench)* It rides every agent's architecture. One install. Owned by no AI vendor."

## ⚠️ Honesty on camera (don't get caught overclaiming)
- Show a REAL refute + a REAL true — don't cherry-pick only wins.
- The `proof verify` tamper demo is the most credible 5 seconds you can film — use it.
- Never show a real token/secret. Never imply "100% accurate" — say "never a confident falsehood."
- Keep it to commands that work on a fresh install today (all the above do).
