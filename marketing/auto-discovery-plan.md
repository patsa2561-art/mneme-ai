# Auto-Discovery Plan — เพื่อให้คน "หาเจอเอง" 24/7

ไม่ต้องวิ่งโพสต์ — channel เหล่านี้ทำงานเอง

## ✅ ทำเสร็จแล้ว (v0.11.0)

- [x] **npm keywords** ขยายเป็น 25+ tags (memory-layer, mcp-server, ai-coding-assistant, …)
- [x] **package description** ชัดเจนใน CLI package
- [x] **CHANGELOG** อัพเดต — Google จะ index "v0.11.0 mneme"

## 🎯 ทำต่อ — actionable, 5 ช่องทาง

### 1. GitHub Topics (3 นาที)

ไปที่: https://github.com/patsa2561-art/mneme-ai

กดดอกจัน ⚙️ ข้าง "About" → Topics → เพิ่ม:
```
mcp
mcp-server
ai-coding-assistant
codebase-memory
git-archaeology
local-first
typescript
sqlite
rag
retrieval-augmented-generation
ai-memory
developer-tools
```

→ เมื่อใครค้น `topic:mcp-server` ใน GitHub → เห็น Mneme

### 2. MCP Server Registry (10 นาที)

MCP servers เริ่มมี registry กลาง — submit ไปที่:

**ก) anthropics/mcp-servers (อย่างเป็นทางการ)**
- Repo: https://github.com/modelcontextprotocol/servers
- File ที่ต้อง edit: `README.md` → "Community Servers"
- เพิ่มบรรทัด:
  ```markdown
  - **[Mneme](https://github.com/patsa2561-art/mneme-ai)** — codebase memory layer with git history + hybrid retrieval (BM25 + cosine), local-first SQLite, MIT licensed
  ```
- เปิด PR

**ข) mcp.so registry (community)**
- ที่: https://mcp.so/submit
- Form กรอก: name, description, link

**ค) glama.ai mcp directory**
- ที่: https://glama.ai/mcp/servers
- มี form submission

### 3. Awesome Lists (15 นาที total)

PR ไปยัง 4 lists (1-3 นาที ต่อ list):

**a) awesome-mcp**
- https://github.com/punkpeye/awesome-mcp-servers
- Section: TypeScript / Node implementations

**b) awesome-developer-tools**
- https://github.com/jondot/awesome-devenv
- Section: Code intelligence

**c) awesome-typescript-projects**
- https://github.com/semlinker/awesome-typescript
- Section: Tools

**d) awesome-ai-developer-tools**
- https://github.com/raycast/awesome-ai
- Section: Code & Dev

### 4. Dev.to / Hashnode Cross-Post (1 บทความ → 3 platforms)

เขียน 1 บทความ:
- **Title:** "I built a memory layer for AI coding assistants — here's what I learned about hybrid retrieval"
- เผยแพร่ที่:
  - **Dev.to** — https://dev.to/new
  - **Hashnode** — https://hashnode.com/draft
  - **Medium** (canonical link → Dev.to)

บทความ 1 ตัว → SEO ranking long-tail ทั่ว Google

### 5. Stack Overflow Strategic Answers

ตอบคำถามที่เกี่ยวกับ:
- "How to give Copilot context about my codebase?"
- "How to query git history from AI?"
- "MCP server examples"

ใส่ link Mneme ใน answer (เป็น disclaimer "I built this", honest)

หา question ผ่าน:
```
https://stackoverflow.com/search?q=copilot+codebase+context
https://stackoverflow.com/search?q=mcp+server+typescript
```

---

## 📅 Timeline แนะนำ

| Day | Action | เวลา |
|-----|--------|------|
| 1 | GitHub topics + MCP registry | 15 นาที |
| 2 | Awesome lists (4 PRs) | 30 นาที |
| 3 | Dev.to article | 1 ชม. |
| 7 | ตอบ 2-3 SO questions | 30 นาที |

หลังทำครบ → traffic จะมาเองผ่าน:
- npm search
- GitHub topic browse
- Google long-tail
- MCP directory
- Awesome list traffic

---

## 🎯 ทำไม channel เหล่านี้ดีกว่า manual posting

| Manual Reddit | Auto channels |
|--------------|---------------|
| ต้องมี karma | ไม่ต้อง |
| โดน auto-filter | ไม่มี filter |
| ไหลผ่านใน 24 ชม. | อยู่ถาวร |
| ต้องโพสต์ทุกครั้งที่ release | ทำครั้งเดียวอยู่ถาวร |
| Audience random | targeted (people searching for X) |
