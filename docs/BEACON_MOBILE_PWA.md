# 📱 Mneme Mobile Companion (PWA) — design spec

**Why**: The current BEACON QR flow puts the soul prompt on a phone browser, but the last-mile (Copy → switch app → Paste → Send) is still 3-4 manual taps. Worse: the LAN URL is `http://192.168.x.x:7741/...`, and modern mobile browsers gate `navigator.clipboard.writeText` behind HTTPS (secure context). Real-world test: the **Copy button silently fails** on some phones.

**Goal**: turn cross-device handoff into **1 tap on the phone**. Install once. Forever after, scan a QR → tap "Resume" → the soul is in the destination AI app already.

---

## Architecture

```
┌──────────────┐                    ┌──────────────────┐
│  PC (Mneme)  │  ── LAN URL + QR ──→ │  Phone (PWA)     │
│              │                    │                  │
│ mneme clone qr                    │  Mneme Companion │
│              │                    │  installed once  │
│              │  ← service worker  │                  │
│              │     fetch          │                  │
└──────────────┘                    │  Share API ───→  ┌──────────────┐
                                    │                  │  Gemini app  │
                                    │                  │  ChatGPT app │
                                    │                  │  Claude app  │
                                    └──────────────────┘└──────────────┘
```

The PWA is the **trust + share-target layer**. It solves three pain points the current QR flow has:

1. **HTTPS gate** — the PWA itself is served from `https://mneme.dev/companion/` (one-time install). When it fetches the LAN URL, the **service worker** is allowed to bridge HTTP fetches because it runs in the PWA's HTTPS origin context. Clipboard write works.
2. **Native share target** — registers as an Android/iOS share target. From inside the PWA, one tap → OS share sheet → "Send to Gemini" → soul lands in Gemini chat box pre-filled.
3. **Persistent across sessions** — installed once on the phone home screen. User scans a QR → PWA opens (already installed) → tap "Resume" → done. No browser tab juggling.

---

## User flow (after first-time install)

1. PC: `mneme clone qr`
2. Phone: open camera, scan QR
3. PWA opens (because the URL is registered to it via `protocol_handlers` / deep-link intent)
4. PWA fetches the LAN URL via service worker, decodes the soul prompt
5. PWA shows a single button: **"Send to [Gemini / ChatGPT / Claude]"** (vendor inferred from soul phenotype)
6. User taps → OS share sheet → user picks target app → soul auto-pasted into that app's chat box → user taps Send

**Total phone taps after install: 2** (scan + share-pick). Down from today's 4+ with current BEACON.

---

## What it's NOT

- ❌ NOT a native iOS/Android app — those need App Store / Play Store approval (8-12 week review cycle and per-platform code). PWA ships in 2 weeks, works on both, installs without store approval.
- ❌ NOT a replacement for clipboard — still uses clipboard as the universal fallback. The "Share" button is the magic UX; clipboard is the backstop.
- ❌ NOT a server — the PWA is served from a single static HTML+JS bundle on GitHub Pages or Cloudflare Pages. No backend. No user accounts. No data leaves the user's phone after the LAN fetch.

---

## Three big technical decisions

### 1. Service worker HTTPS bridge

A service worker registered on `https://mneme.dev/companion/` can fetch `http://192.168.1.x:7741/...` because the **request** originates from a secure context (the PWA itself). The response is delivered to the PWA's JS, which can then call `navigator.clipboard.writeText()` — **no HTTPS gate on the LAN endpoint required**.

This is the killer architectural insight. The current "open LAN URL in mobile browser" flow can never reach 1-tap because the page itself isn't HTTPS. A PWA acting as a trusted client of the LAN endpoint sidesteps the entire issue.

### 2. Web Share API (Level 2) for native handoff

```js
await navigator.share({
  title: "Mneme brain",
  text: soulPromptText,
});
```

Web Share Level 2 is supported in:
- Android Chrome 75+ (released 2019)
- iOS Safari 12.2+ (released 2019)
- Edge mobile
- Samsung Internet

Pre-filled share text is delivered to whichever app the user picks. Gemini app, ChatGPT app, Claude app all accept shared text → it lands in the chat box ready to send.

### 3. Single-file PWA

The PWA is one HTML file (~30KB), one service worker JS (~5KB), one icon set (~10KB). Hosted on GitHub Pages from `patsa2561-art.github.io/mneme-companion/`. No build pipeline complexity; users install by visiting the URL on their phone and tapping "Add to Home Screen" (or get an auto-prompt on supported browsers).

### Bonus — QR encoding

The QR encodes a single deep-link URL like:

```
https://mneme.dev/companion/#resume=http%3A%2F%2F192.168.1.10%3A7741%2Fxyz123
```

PWA registered for `mneme.dev/companion/` is opened by the OS when QR is scanned, parses the `#resume=...` fragment, fetches it via service worker.

---

## 2-week build plan

### Week 1 — Bare PWA
- [ ] Static HTML + manifest + service worker on `https://patsa2561-art.github.io/mneme-companion/`
- [ ] Manifest: `display: standalone`, app icons, theme colour
- [ ] Service worker: cache shell, fetch handler for LAN URLs
- [ ] JS:
  - [ ] Parse `#resume=<encoded-lan-url>` from location hash
  - [ ] Fetch LAN URL via service worker → get soul text
  - [ ] Render: "✅ Brain received — tap to send to [vendor]"
  - [ ] Tap → `navigator.share({ text: soulText })`
- [ ] Test on real Android (Chrome) + iOS (Safari)

### Week 2 — Polish + integration
- [ ] Mneme CLI: `mneme clone qr` now emits QR pointing at `https://patsa2561-art.github.io/mneme-companion/#resume=...` (instead of raw LAN URL)
- [ ] Add fallback: if PWA not installed, the URL is itself a working web page (degrades to today's flow with Copy button)
- [ ] Vendor inference: read soul's PHENOTYPE block to know which app to suggest in the share button label
- [ ] Install prompt: detect first visit, show "📲 Install Mneme Companion" banner
- [ ] Bilingual UI (EN + TH)
- [ ] Update README + docs/CLONE.md to mention the PWA install (one-time, ~10 sec)

---

## Why this is the moat

The competition (DoNotPay-style copy-paste extensions, password managers with secret URLs) all stop at "browser-based fetch". None ship a **PWA + share-target** combo that turns cross-device AI handoff into one tap.

After the PWA ships:

- **Mneme cross-device clone = 1 tap on phone**. Demo-able. Posts well on social.
- **Lock-in effect**: once a user installs the PWA on their phone, they keep using Mneme on PC. Switching cost is now non-trivial.
- **Foundation for future features**: same PWA can later host a mobile-side polygraph viewer, soul history browser, federation peer chooser — all without an app store.

---

## Honest caveats

- iOS limitations: Safari blocks PWA install prompts unless the user adds to home screen manually. We'll surface a "Tap share → Add to Home Screen" banner the first time iPhone users land.
- Web Share Level 2 (pre-filled text) is supported, but **target app behaviour varies**. Gemini Android app reliably pre-fills. iOS share sheets sometimes truncate text. We test both and document.
- Service worker LAN fetch works in Chrome / Safari / Firefox stable, but corporate firewalls that block service workers (some MDM-managed phones) will break this. Manual clipboard fallback always present.

---

## Decision required

1. **Domain**: ship as `https://patsa2561-art.github.io/mneme-companion/` (free, GitHub Pages, default) OR register `mneme.dev` ($15/yr, cleaner brand)?
2. **Tracking**: ZERO analytics (privacy-pure) OR opt-in basic counter (so we know if anyone's using it)?
3. **Vendor share targets**: ship all 3 (Gemini / ChatGPT / Claude) week 2, or just one (Gemini) for the launch demo + add others after?

Defaults if unanswered: **GitHub Pages domain · ZERO analytics · all 3 vendors at launch**.
