# 🧬 Cross-vendor brain transfer

> **Your conversation follows you. Any AI. Any device. Any time.**

You start in Cursor on your PC, switch to ChatGPT in your browser, finish on Gemini on your phone — your AI knows everything from the start, because Mneme carries the brain across.

**One sentence does it all.** You never pick the transport. Say the outcome — your AI picks the best path automatically.

---

## 🗣 Just say what you want — in any words

| What you want | Say something like |
|---|---|
| Same computer, different AI | *"send my brain to my other AI"* |
| Phone / tablet / 2nd laptop | *"send my brain to another device"* / *"give me a code"* |
| Across the internet | *"send my brain over the internet"* / *"share via private link"* |
| Same WiFi as another device | *"open the LAN bridge"* |
| Offline / USB transfer | *"pack my brain as a file"* |
| Bring conversation BACK | *"send my brain back to my desktop"* |

Fuzzy matching handles typos, paraphrasing, Thai-English mixing.

---

## 🔄 Parent ↔ Child architecture

Mneme lives on **ONE machine** (the **parent** — your main PC). Every AI tool you use is a **child** that talks to the parent via MCP or paste.

```
[PARENT — your main PC]              [CHILDREN — anywhere]
  Mneme installed (npm)               Cursor laptop · Claude mobile · Gemini web
  Owns the brain (.mneme/)            Read the brain via MCP or paste
  Pushes new features                 No install, no upgrade needed
        ↓
   npm install -g mneme-ai@latest  ← upgrade ONLY on the parent
        ↓
   All children inherit on next connection
```

- **Want a new feature on Cursor / mobile / iPad?** Upgrade Mneme on parent. Children inherit on next connect.
- **You do NOT install Mneme on the mobile app.** Mobile AI just reads your paste; can't have Mneme.

---

## 🪞 Bringing the conversation BACK (child → parent)

When you work in a child AI (mobile / web) and want the result back on the parent:

1. Tell the child AI: *"send my brain back to my main PC"*.
2. The child emits a `# HOMUNCULUS RETURN` block — structured summary of decisions / reasoning / next-actions.
3. You paste it into the parent (Cursor / Claude Code).
4. Parent's Mneme parses it via `mneme.abyss.homunculus.ingest` and merges it.

No backchannel. The user is the courier; the format is typed.

---

## 🌈 RAINBOW handoff matrix — every scenario, honest coverage

Pick the one that fits — your AI auto-recommends.

| Channel | Network needed | Taps on phone | Live? | Wild factor |
|---|---|---|:--:|---|
| 🅰 **LAN HTTP server** | same WiFi | 1 | ✅ | Web Share API |
| 🅱 **data: URL bridge** | any internet | 1 | ⚠ deprecated v1.90 | HTML lived in QR (Chrome blocked) |
| 🅲 **dpaste raw** | any internet | 4 | ✅ | always-works fallback |
| 🔥 **Cloudflared tunnel + PHOENIX watchdog** | any | 1 | ✅ v1.92 | auto-respawn + SSE URL push |
| 🧬 **SAME-SHELL** localhost | none | 0 (auto-copy) | ✅ v1.92 | same-machine, no QR |
| 🪃 **BOOMERANG return-pad** | LAN/tunnel | 2 paste ops | ✅ v1.92 | Web AI → editor AI loop |
| 💾 **Wanderer .mwt USB** | none — offline | n/a | ✅ | total air-gap |
| 🔊 **ggwave audio** | none — through air | 1 | ⏳ v1.93 | multi-recipient via speaker |
| 📡 **WebRTC P2P** | any | 1 | ⏳ v1.93 | true peer-to-peer |

---

## 🧬 Same-machine clone — fastest path (v1.92 SAME-SHELL)

You're on **one machine**. You've been chatting with Claude Code / Cursor / Codex. You want to switch to ChatGPT / Gemini / Claude in your **browser** — same machine, no QR needed.

> **Tell your AI:** *"clone my brain to a browser AI on this PC"* — your AI runs `mneme.rainbow.show_local`. A browser tab opens at `localhost:7741/local`. Brain is **already on your clipboard**. Click ChatGPT (or Gemini / Claude / Perplexity), paste, done.

| Step | What happens | Time |
|---|---|---|
| 1 | Browser tab opens automatically | ~200ms |
| 2 | Soul prompt auto-copies to clipboard on page load | instant |
| 3 | You click any AI button → opens that AI in a new tab | 1 click |
| 4 | You press Ctrl+V (Cmd+V on Mac) | 1 keystroke |

**No QR. No tunnel. No public URL. No 404 risk.** The page never leaves your machine.

---

## 🛑 The STOP button — what does it actually do?

The page served on PC + mobile has a red **STOP** button at top-right.

| You... | What happens |
|---|---|
| **Press STOP** | Local LAN server shuts down. Public tunnel (if any) is killed. The QR will 404 from now on. |
| **Don't press STOP** | Server keeps running until you close that terminal or reboot. Local-only — not exposed to the internet unless you started a tunnel. Public tunnels self-expire after ~30 min idle. |
| **Close the browser by accident** | Just say to your AI: *"show handoff again"*. A new page is generated with a fresh URL. Old QR is dead, new QR replaces it. |

---

## 🔥 PHOENIX — tunnel watchdog (v1.92)

Cloudflare quick-tunnels are ephemeral — they die randomly (process exit, idle ~30 min, edge garbage-collection). With PHOENIX:

- LAN server probes the tunnel every 30 seconds.
- If the URL goes dead, **cloudflared respawns automatically**.
- New URL is **pushed live to the page on your phone via Server-Sent Events** — the QR re-renders without you reloading.

Wizard mode. The user never confesses the URL died.

---

## 🪃 BOOMERANG — Brain → Web AI → back to you (v1.92)

Web AIs (ChatGPT.com / Gemini.com) read your soul prompt but **can't call Mneme MCP tools**. Honest. So how do they help?

The soul prompt embeds a **HOMUNCULUS RETURN contract** — the Web AI is asked to emit a structured block of decisions / reasoning / next-actions at the end. You paste that block into the **return-pad** on the same page (or directly to your editor AI). It POSTs to `/return` → lands in `.mneme/inbox/homunculus-return.jsonl` → Mneme MCP daemon picks it up → your editor AI sees it on the next pulse:

```
[BOOMERANG abc123] from gemini-2.5-pro → claude-opus-4-7 (d:2 r:1 n:3)
```

— and offers to ingest + execute.

**Web AI = brain. Editor AI = hands. You = courier (2 paste ops, no install on either side).**

---

## 🦎 Don't have git? It's OPTIONAL

Mneme has 7 transports for cross-device handover. **Only one uses git.** Every other path works without git, GitHub, or push permission.

| Use case | Uses git? | Default? |
|---|---|---|
| Same machine (SAME-SHELL) | ❌ no | ✅ ready |
| Phone / tablet (mobile AI app) | ❌ no | ✅ ready |
| Same WiFi (AURA owner-only) | ❌ no | ✅ ready |
| Public tunnel (PHOENIX-watched) | ❌ no | ✅ ready |
| Anonymous paste relay (encrypted) | ❌ no | ✅ ready |
| Offline / USB (Wanderer `.mwt`) | ❌ no | ✅ ready |
| Personal GitHub Gist | optional | manual |
| `mneme spore` (continuous git sync) | ✅ yes | **🔒 OPT-IN only after v1.86** |

---

## 🎬 30-second recap

```
┌─ PARENT (the pole) ─────────────────────────────────────────┐
│  Your main PC. Mneme installed once: npx mneme-ai init      │
│  Brain lives in .mneme/ on this disk. Owns everything.      │
└──────┬──────────────┬─────────────────┬─────────────────────┘
       │              │                 │
   ROPE: MCP       ROPE: paste      ROPE: QR scan
       │              │                 │
┌──────▼──┐    ┌──────▼──────┐   ┌──────▼─────────────┐
│ CHILDREN│    │  CHILDREN   │   │  CHILDREN          │
│ (editor)│    │  (web AI)   │   │  (mobile / tablet) │
│ Cursor  │    │ chatgpt.com │   │ Gemini app / iPad  │
│ Codex   │    │ gemini web  │   │ Claude app /Android│
│ Cline   │    │ claude.ai   │   │ ChatGPT app/iPhone │
└─────────┘    └─────────────┘   └────────────────────┘
   ▲                ▲                    ▲
   └────────────────┴────────────────────┘
        When parent upgrades, every child inherits
        on its NEXT connection.
```

---

← [Back to README](../README.md) · [Full archived README](README_FULL.md) · [CHANGELOG](../CHANGELOG.md)
