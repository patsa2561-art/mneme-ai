# r/SideProject — Clear & Direct version

## Title (เลือก 1)

**Recommended (clear + hook):**
```
Show r/SideProject: Mneme — gives your AI coding assistant memory of your git history
```

**Alternative (with edge):**
```
Show r/SideProject: I got tired of re-explaining my codebase to AI every chat, so I gave it a memory
```

---

## Body (อ่านปุ๊บรู้ทันที)

```markdown
## What it is

**Mneme** is an npm package that gives AI coding assistants (Copilot, Claude, Cursor, etc.) memory of your codebase — git history, code structure, past decisions.

## What problem it solves

You ask your AI: *"Why is this function written this way?"*
It guesses. Confidently. Wrong.

The real answer is in a commit from 4 months ago. Your AI never sees it.

Mneme indexes that history and exposes it via MCP, so your AI can actually look it up.

## What you can do with it

```bash
npx mneme-ai init                    # one-time setup
npx mneme-ai ask "how does auth work"  # answers from your real code + history
npx mneme-ai who-knows "payments"      # who's the expert on this module
npx mneme-ai story src/api/charge.ts   # how this file evolved and why
npx mneme-ai bus-factor                # what knowledge is at risk
npx mneme-ai regret                    # files we keep getting wrong
```

## How it works (30 seconds)

1. Indexes your repo locally → SQLite + FTS5
2. Hybrid search: BM25 (keyword) + cosine (semantic), fused via RRF
3. Confidence scoring — if it doesn't actually know, it says so
4. Exposes everything as an MCP server → any AI client can query it

## Why local-first

- Your code never leaves your machine
- Embeddings via Ollama (offline) or OpenAI (your key)
- No telemetry, no signup, MIT licensed

## Stack

- TypeScript monorepo (6 packages)
- SQLite + FTS5 + WAL
- Optional Ollama / OpenAI embeddings
- MCP server for AI client integration
- Property-based tests (160k generated cases per CI run)

## Try it

```bash
npx mneme-ai init
npx mneme-ai ask "what does this project do"
```

Works on any language for git/history features.
Entity-aware parsing for TS, JS, Python, Go.

## Links

- GitHub: https://github.com/patsa2561-art/mneme-ai
- npm: https://www.npmjs.com/package/mneme-ai

## What I want from you

1. **Try it on your repo** — does it understand your codebase?
2. **Tell me where it breaks** — I need adversarial users
3. **What command would actually save you time?** — I have a backlog but I'd rather build what hurts

Solo dev. No funding. No team. Just shipping.
```

---

## Why this version is better

**Before:** Story-driven, 600+ words, takes 2 minutes to figure out what it does
**Now:** Headers tell you everything in 5 seconds:
- What it is
- What problem
- What you can do
- How it works
- Try it

**Reddit users skim.** Headers + code blocks = they get value before deciding to read deeper.

---

## Format checklist

- ✅ First line tells you what it is (no preamble)
- ✅ Code blocks for commands (skim-friendly)
- ✅ Numbered "how it works" (4 lines, not 4 paragraphs)
- ✅ Clear "try it" section with copy-paste commands
- ✅ Ask for feedback (not upvotes)
- ✅ No "6 months", no time references
- ✅ No competitor comparisons
- ✅ No AI tool fingerprints

---

## วิธีโพสต์

1. **เปลี่ยน subreddit** จาก r/OpenAssistant → **r/SideProject**
2. **Title:** copy บรรทัดแรกในกล่อง "Recommended" ด้านบน
3. **Body:** copy ทั้ง markdown block ใน "Body" ด้านบน (ตั้งแต่ `## What it is` ถึง `Just shipping.`)
4. **Tags:** `Show & Tell` หรือ `Open Source`
5. **Post**

---

## เวลาโพสต์

- 🟢 **ตอนนี้ดีไหม?** เช็คเวลา BKK ปัจจุบัน
  - ถ้า 21:00-23:00 BKK วันธรรมดา → โพสต์เลย
  - ถ้าไม่ใช่ → **Save Draft** รอพรุ่งนี้

- ❌ หลีกเลี่ยง: เสาร์-อาทิตย์, ดึกๆ ตี 2-6 BKK
