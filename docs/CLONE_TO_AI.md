# 🧬 Clone your brain to ANY AI / device — phrase guide

> **The honest contract:** Mneme depends on YOUR clipboard. Period. We do NOT depend on Web AIs to fetch URLs, decrypt files, or honor deep-link prefill — those are broken across free tiers. **Clipboard works everywhere.** That's the deal.

---

## 🗣 Just say it in your own words — Mneme understands

You don't memorize commands. Say what you want in any language, any phrasing — Thai, English, mixed. Mneme's intent parser handles fuzzy phrasing.

**Trigger phrases that work** (each row = same outcome; pick whichever feels natural):

| What you want | Say something like (any of these works) |
|---|---|
| 💻 **Browser on THIS PC** | *"clone to localhost"* · *"ก๊อปไปเครื่องนี้"* · *"send mneme to browser on this pc"* · *"browser นี้"* |
| 📱 **Mobile / Phone** | *"ส่งสมองไปมือถือ"* · *"ย้าย mneme ไปใส่ใน mobile หน่อย"* · *"send brain to phone"* · *"clone to my iPhone"* |
| 📱 **iPad / Tablet** | *"clone brain to ipad"* · *"ก๊อปไป tablet"* · *"ส่งไปแทบเล็ต"* |
| 🖥 **Another laptop / PC** | *"send brain to my notebook"* · *"ส่ง mneme ไปคอมอื่น"* · *"sync to second laptop"* |
| 🟢 **ChatGPT.com** | *"send mneme to chat gpt"* · *"share mneme กับ openai"* · *"clone to chatgpt"* |
| 🔵 **Gemini** | *"ส่งความจำของ mneme ไปใน gemini"* · *"Mneme ส่งไป google ai หน่อย"* · *"clone to gemini-web"* |
| 🟣 **Claude.ai** | *"sync to claude.ai"* · *"ส่งไป claude web"* · *"clone to anthropic"* |
| ⚪ **Perplexity** | *"give brain to perplexity"* |
| 🤖 **GitHub Copilot** | *"ส่ง mneme ไป copilot"* · *"copilot ใช้ mneme หน่อย"* |
| 📝 **VS Code / Cursor** | *"clone to vscode"* · *"sync to editor"* |
| 💾 **USB / offline** | *"pack mneme as a file"* · *"แพ็คไป usb"* |
| 🪃 **Send BACK from Web AI** | *"send back to my pc"* · *"ส่งกลับมาที่ pc"* · *"boomerang"* |

**You don't have to type the EXACT phrase.** Mneme matches on `verb + subject + target` and is fuzzy on each. Some examples that ALSO work even though they're not in the table:

- *"พา mneme ไปลง samsung"* → mobile
- *"Please ดัน brain ไปใส่ chatgpt"* → chatgpt (Thai-English mixed)
- *"share my context with gemini real quick"* → gemini

**No target specified?** Mneme shows you a numbered menu — pick a number.

---

## 🧠 What ACTUALLY happens behind the scenes

Honest postmortem of why earlier versions broke (v1.85 RELAY architecture is **DEPRECATED**):

### 🔴 4 things Web AIs CANNOT do (don't pretend they can)

| Bug | Reality |
|---|---|
| Web AI fetches URL | Free Gemini / ChatGPT-Free / Claude.ai do **NOT** have web-fetch in chat. "Fetch this URL..." is silently ignored. |
| Web AI does AES decryption | No Web Crypto in chat sandbox. AI will hallucinate the decryption output instead of failing honestly. |
| `gemini.google.com/?q=...` deep link | **Verified broken**: deep-link prefill is ignored by current Gemini Web. User has to type/paste anyway. |
| Web AI parses encrypted files | Same as above — no crypto, no fetch, no reliable execution path. |

### ✅ The ONE thing every Web AI CAN do: read what the user pastes

So Mneme's clipboard-based flow is:

```
1. User says any phrase →
2. Mneme parses intent + picks target →
3. Mneme renders soul prompt as PLAIN TEXT (no encryption needed when local) →
4. Mneme COPIES to clipboard via navigator.clipboard →
5. Mneme OPENS the AI's home page (NOT a ?q= deep link) →
6. User sees banner: "Brain is on your clipboard. Press Ctrl+V." →
7. User Ctrl+V into the chat box →
8. AI reads plain text. Done.
```

**Zero crypto burden on the AI. Zero web-fetch dependency. Zero deep-link reliance.**

---

## 🎯 For AI agents — the one tool to know

```typescript
import { cloneTo, parseCloneIntent, formatCloneToPulseLine } from "@mneme-ai/core";

// When user says ANY phrase about sending/cloning/syncing brain:
const r = cloneTo({ userText: userMessage });
// Or with explicit target:
const r = cloneTo({ target: "gemini" });

// r.intent             — parsed intent (verb + subject + target evidence)
// r.resolvedTarget     — canonical target (mobile/gemini/chatgpt/...)
// r.plan               — transport plan (same-shell / web-paste / tunnel-qr / ...)
// r.userInstruction    — one-line message to surface to the user
// r.browserOpen        — { command, args, opened } when applicable
```

If `r.resolvedTarget === "unknown"` → `r.plan.transport === "menu"` and `r.userInstruction` contains the numbered options. Surface that to the user and wait for their pick.

If `r.resolvedTarget` is concrete (mobile/gemini/etc.) → Mneme **already opened the browser** and **already copied the brain to clipboard**. Just relay `r.userInstruction` to the user verbatim.

**Rule:** when the user says ANYTHING containing "send / clone / sync / move / ย้าย / ส่ง / โคลน" + "brain / memory / mneme / สมอง / ความจำ" → ALWAYS call `cloneTo` first. Don't improvise alternative tools.

---

## 🔄 Round-trip: getting the Web AI's reply back to your editor AI

Web AIs can't call Mneme MCP tools — but they CAN emit a structured response. The flow:

1. Mneme's soul prompt embeds a `# HOMUNCULUS RETURN` contract
2. Web AI (Gemini/ChatGPT) thinks + responds; user-facing reply ends with the structured block
3. User copies the block, opens the SAME-SHELL page on this PC
4. The page has a `🪃 BOOMERANG return-pad` textarea — user pastes there
5. POSTs to `/return` → lands in `.mneme/inbox/homunculus-return.jsonl`
6. Editor AI's next pulse surfaces it → user can ingest via `mneme.abyss.homunculus.ingest`

**Trigger phrase:** *"send back to my pc"* · *"ส่งกลับมาที่ pc"* · *"boomerang"*

---

## 🧪 Live test (copy-paste-able)

Try right now in Claude Code / Cursor:

```
User: "ส่งสมองไปมือถือ"
→ AI calls cloneTo({userText: "ส่งสมองไปมือถือ"})
→ Returns transport=tunnel-qr, lanPort=7741
→ AI relays: "Mobile handoff page ready. Scan the QR with your phone camera..."
```

```
User: "ส่งความจำของ mneme ไปใน gemini"
→ AI calls cloneTo({userText: "ส่งความจำของ mneme ไปใน gemini"})
→ Browser opens https://gemini.google.com/app (NOT ?q= — that's broken)
→ Brain on clipboard
→ AI relays: "Brain is on your clipboard. Opened Gemini. Paste with Ctrl+V."
```

```
User: "send mneme to mobile and also another laptop"
→ AI parses → first target = mobile (highest specificity)
→ AI can call cloneTo a second time for another-pc if user follows up
```

---

← [Back to README](../README.md) · [QX-BRIDGE](QX_BRIDGE.md) · [Cross-vendor brain transfer](CROSS_VENDOR_BRAIN.md) · [AI agent contract](AI_AGENT_CONTRACT.md)
