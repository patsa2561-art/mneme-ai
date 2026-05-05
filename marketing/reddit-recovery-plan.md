# Reddit Recovery Plan — หลัง r/SideProject auto-filter

## Action A: Message Mods r/SideProject

### Step 1: หา URL ของ post ที่ถูกลบ

แม้ post ถูก filter แต่ URL ยังใช้ได้:
- ดู browser address bar — copy URL
- Format: `https://www.reddit.com/r/SideProject/comments/XXXXX/...`

### Step 2: ส่งข้อความ Mods

URL: https://www.reddit.com/message/compose?to=/r/SideProject

หรือ:
1. ไป https://www.reddit.com/r/SideProject/
2. Sidebar ขวา → "Moderators" → "Message the mods"

### Step 3: Copy template นี้

**Subject:**
```
Post caught by auto-filter — request to review
```

**Body:**
```
Hi r/SideProject mods,

My post was just removed by automatic filters. Title:
"Show r/SideProject: I got tired of re-explaining my codebase to AI every chat, so I built it a memory"

It's a genuine open-source launch — MIT-licensed npm package, no paywall, no signup, no telemetry. I'm a solo dev sharing what I built.

Post link: [PASTE URL HERE]

Could you please review? If it doesn't fit the subreddit rules, I understand and will adjust.

Thank you for your time.
```

**สำคัญ:** สุภาพ, สั้น, ไม่อ้อน. Mods ตอบ 2-24 ชม.

---

## Action C: โพสต์ r/coolgithubprojects (ทำตอนนี้เลย)

### URL
https://www.reddit.com/r/coolgithubprojects/submit

### Title
```
Mneme — gives your AI coding assistant memory of your git history
```

### Body (สั้น, ลิงก์เดียว)

```markdown
**What it is**

Mneme is an npm package + MCP server that indexes your codebase and exposes it to AI coding assistants (Copilot, Claude, Cursor). 

It solves the "AI forgets my project every chat" problem — your AI can finally answer "why is this code structured this way?" by querying your actual git history and code.

**How it works**

- Indexes git history + code structure into local SQLite + FTS5
- Hybrid retrieval: BM25 + cosine similarity, fused via Reciprocal Rank Fusion  
- Confidence scoring — refuses to answer when it doesn't know
- MCP server so any AI client can query it
- Embeddings via Ollama (offline) or OpenAI (your key)

**Quick try**

\`\`\`bash
npx mneme-ai init
npx mneme-ai ask "what does this project do"
\`\`\`

Works on any language for git/history features. Entity-aware parsing for TS, JS, Python, Go.

**Stack**

TypeScript monorepo, SQLite + FTS5 + WAL, optional Ollama/OpenAI embeddings, MCP integration, property-based testing.

**Why local-first**

Your code never leaves your machine. No telemetry, no signup, MIT licensed.

https://github.com/patsa2561-art/mneme-ai

Feedback welcome — especially adversarial testing.
```

### ⚠️ สำคัญสำหรับ post นี้

- ✅ **ลิงก์เดียว** (GitHub เท่านั้น — ไม่มี npm, ไม่มี wiki)
- ✅ ไม่มีคำว่า "Show r/..."
- ✅ ไม่มี em dash (—) ใน title
- ✅ Body ~200 คำ (สั้น)
- ✅ Code block แค่ 1 อัน

---

## Action B (background): Build Karma Plan 14 วัน

ทำขนานกับ A + C เพื่อให้โพสต์ครั้งหน้าผ่าน auto-filter

### กฎประจำวัน
- 5-10 comments/วัน
- ใน subreddit ที่ตรงกับสายคุณ:
  - r/SideProject
  - r/programming  
  - r/webdev
  - r/typescript
  - r/node
  - r/devtools

### ประเภท comment ที่ได้ karma เร็ว
1. **ตอบคำถาม technical** — แชร์ความรู้ที่คุณมี
2. **เล่าประสบการณ์** — "I had this issue, here's how I solved it"
3. **แชร์ tool/resource** ที่เคยใช้แล้วดี (ไม่ใช่ Mneme)
4. **ถามคำถาม follow-up** ดีๆ ใน thread

### ห้าม
- ❌ Comment "Cool!" หรือ "+1" — ไม่ได้ karma
- ❌ Spam ลิงก์ Mneme ทุก comment — ban risk
- ❌ Comment เร็วเกินไป (5+ comments ใน 5 นาที) — rate limit flag

### เป้า karma
- **Day 7:** 30+ karma
- **Day 14:** 80+ karma
- หลังจากนั้น auto-filter จะไม่จับ

---

## Timeline แนะนำ

| เวลา | ทำอะไร |
|------|--------|
| **ตอนนี้** | Action A — ส่ง mod message |
| **+5 นาที** | Action C — post r/coolgithubprojects |
| **ทุกวัน** | Action B — comment 5-10 ครั้ง build karma |
| **Day 7** | ลอง r/opensource |
| **Day 14** | กลับ r/SideProject (ถ้า karma 80+) |
| **Day 21** | r/programming (subreddit ใหญ่) |
| **Day 30** | HN Show HN (account อายุ + karma พร้อม) |

---

## Subreddits สำรองถ้า r/coolgithubprojects ก็ filter

ลองตามลำดับ:
1. r/opensource
2. r/typescript  
3. r/node
4. r/devtools
5. r/SideProject (หลังได้ mod approval หรือ karma 50+)

ใช้ body เดียวกับ Action C ได้ — แค่เปลี่ยน subreddit
