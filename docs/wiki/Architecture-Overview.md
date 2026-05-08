# Mneme Architecture — เข้าใจได้ใน 5 นาที

> นี่คือหน้าที่ contributor คนใหม่ควรอ่านก่อน. อธิบาย v0.40-v0.43 architecture แบบที่คนทั่วไปเข้าใจได้ — ไม่ต้องเป็นนัก compsci.

═══════════════════════════════════════════════════════════════════════════════

## TL;DR — Mneme คือ "ตารางธาตุของการทำงานกับ git history"

Mneme มี 75 commands. ทุก command ภายในประกอบจาก **ชิ้นเล็กๆ ที่ใช้ซ้ำกัน** (อ่าน git log, embed text, scan regex, ...). ก่อน v0.40 ชิ้นเล็กพวกนี้กระจายอยู่ใน 75 ไฟล์ ไม่มีใครเห็นภาพรวม.

v0.40-v0.43 จัดให้เป็น **ตารางธาตุ** เหมือนเคมี:

```
ธาตุ (Element)    → 1 operation พื้นฐาน        → git.log, embed.text, vector.cosine
อะตอม (Atom)      → ธาตุ + parameters เฉพาะ  → git.log.recent (= git.log{since: 90d})
โมเลกุล (Molecule) → อะตอมรวมกัน              → mneme karma, mneme atrophy
```

**75 commands เก่ายังทำงานเหมือนเดิม.** เพิ่ม layer ใหม่ใต้ commands ไม่ใช่แทนที่.

═══════════════════════════════════════════════════════════════════════════════

## 4 versions, 4 ความสามารถใหม่

| Version | คือ | ใช้คำเดียว |
|---|---|---|
| **v0.40** Periodic Table | catalog ของชิ้นเล็กๆ ทั้งหมด | "พจนานุกรม" |
| **v0.41** Compiler | natural language → plan ของชิ้นเล็กๆ | "นักแปล" |
| **v0.42** Second Brain | จำ plan ที่ใช้บ่อย → กลายเป็น alias | "ความจำ" |
| **v0.43** Holy Grails | 3 ความสามารถใหม่ที่เป็นไปได้เพราะ architecture นี้ | "ของขวัญ" |

═══════════════════════════════════════════════════════════════════════════════

## ลองด้วยตัวเอง — 60 วินาที

```bash
npm install -g mneme-ai@0.43.0
cd <your-repo>
mneme init && mneme index

# v0.40 — ดูตารางธาตุ
mneme periodic-table

# v0.41 — ใช้ภาษาธรรมชาติ
mneme compose "find todo debt by author"

# v0.42 — ดู library ของ plans ที่เคย compose
mneme library

# v0.43 — Holy Grails
mneme heartbeat                # สุขภาพ codebase วันนี้
mneme rewind HEAD~3            # ย้อนเวลา ดู context ของ commit
mneme dna-fold                 # team voice fingerprint
```

═══════════════════════════════════════════════════════════════════════════════

## v0.40 — Periodic Table (พจนานุกรม)

### ปัญหาที่แก้

ก่อน v0.40 ถ้าจะเขียน command ใหม่ที่ "อ่าน git log เฉพาะ author X ในรอบ 90 วัน" — ต้องเขียน git subprocess + parse output เองทุกครั้ง. Code duplication เกิดขึ้นในเกือบทุก command.

### ทางแก้ — manifest

ทุก primitive ลงทะเบียนตัวเองด้วย manifest:

```ts
declare({
  id: "git.log",                       // ชื่อสากล
  kind: "element",                     // ระดับ: element/atom/molecule
  inputs:  { cwd: "string", maxCommits: "number?" },
  output:  "Commit[]",
  cost:    { io: "subprocess", cpu: "low", msP50: 50 },
  modulePath: "../git/batch-log.js",
  exportName: "loadCommitsWithDiffs",
});
```

ลองดู:
```bash
mneme periodic-table              # ดูทั้งหมด
mneme periodic-table git.log      # detail ของ 1 ชิ้น
mneme periodic-table --tag git    # filter
mneme periodic-table --json       # ให้ AI/MCP อ่าน
```

### สำคัญ

- **Additive** — commands เก่าทุกอันยังใช้ได้ ไม่มีอะไรพัง
- **Tests** — `mneme periodic-table` มี test ที่ validate manifest ทุกตัว fail-loud ถ้ามี drift

═══════════════════════════════════════════════════════════════════════════════

## v0.41 — Compiler (นักแปล)

### ปัญหาที่แก้

`mneme do` ที่มีอยู่แล้วเลือก 1 command. แต่ถ้า user อยากให้ทำงาน 3-4 อย่างต่อกัน — ก่อนหน้านี้ต้องรู้ chain เอง.

### ทางแก้

```bash
mneme compose "find SQL injection in payment files"
```

จะ output:
```
Plan
  1. stack.profile             [low·20ms]   detect tech stack
  2. git.log                   [low·50ms]   scan history
  3. score.bayesian.tech-aware [low·1ms]    filter false positives

estimated p50: 71ms
```

**2 modes:**
- **rule-based (default)** — ใช้ keyword + tag matching, ไม่ต้องใช้ LLM, ทำงานในไม่กี่ ms
- **`--llm`** — ใช้ Ollama/OpenAI ที่ config ไว้ refine plan ให้ดีขึ้น

### Cache

Plan ถูก save ที่ `.mneme/molecule-cache.json` — รัน intent เดิมอีกครั้ง = ไม่ต้อง plan ใหม่.

═══════════════════════════════════════════════════════════════════════════════

## v0.42 — Second Brain (ความจำ)

### ปัญหาที่แก้

ถ้าทำ `mneme compose "weekly security check"` 50 ครั้ง — ทุกครั้งยังต้องพิมพ์เต็มๆ. ไม่มี "alias".

### ทางแก้

```bash
# ทุก compose จะเข้า library อัตโนมัติ
mneme compose "weekly security check"
mneme compose "weekly security check"   # hits = 2
# ... ใช้บ่อย, hits = 5

# เห็น list
mneme library

# entries ที่ hits ≥ 5 = "eligible for promotion"
mneme library --eligible

# ตั้ง alias
mneme library --promote <id> --alias weekly

# รันด้วย alias
mneme run weekly                # dry-run
mneme run weekly --execute      # ของจริง
```

### Sandbox-aware execution

```bash
mneme run weekly --execute --forbid-network    # block fetch
mneme run weekly --execute --forbid-filesystem # block fs.write
mneme run weekly --execute --forbid-git        # block subprocess
```

ทุก step ที่จะใช้ side-effect ที่โดน forbid → จะ fail-loud, **ไม่** silent skip.

═══════════════════════════════════════════════════════════════════════════════

## v0.43 — Holy Grails (ของขวัญ 3 อย่าง)

architectural foundation ของ v0.40-v0.42 ทำให้ 3 features ที่ก่อนหน้านี้เป็นไปไม่ได้กลายเป็นเป็นไปได้:

### 💓 `mneme heartbeat`

```bash
mneme heartbeat                 # take pulse, compare to 7-day baseline
mneme heartbeat --json          # cron, post to Slack
```

ทุกครั้งที่รัน = MRI snapshot 20 axes + เทียบกับ rolling baseline + flag axis ที่ ≥ 2σ. Verdicts: ALL-QUIET / WATCHING / ALARMING.

**Cron วันละครั้ง** — ตอน ALARMING จะ exit code 1 → CI catch ได้.

### ⏮ `mneme rewind <commit>`

```bash
mneme rewind HEAD~3
mneme rewind <hash>
```

ย้อนเวลาดู commit เดียว — รวม:
- Cognitive-twin voice profile ของ author
- 5 commits ก่อน + 5 commits หลัง โดย author เดียวกัน
- Time of day + day of week ใน TZ ของ author
- Sandwich-mode markers ("WIP", "fix attempt", "trying to")
- Subject length deviation จาก voice ปกติ

Output: **facts** (commit metadata, surrounding commits) + **inferences** (`✱` prefix ทั้งหมด — speculative, ไม่ใช่ "ที่ author คิดจริงๆ")

### 🧬 `mneme dna-fold`

```bash
mneme dna-fold                  # top 8 contributors auto
mneme dna-fold --email a@x b@y
```

per-person DNA มีอยู่แล้ว. dna-fold = stack ทุกคนเข้าด้วยกัน → ดู:
- **consensus** — feature ไหนทีมเห็นตรงกัน
- **polarised** — feature ไหนทีมแตกเป็นสองค่าย
- **outliered** — feature ไหนมีคนเดียวที่แตกต่าง

ใช้สำหรับ: onboarding ("ทีมเขียน commit แบบไหน"), hiring fit, retros.

═══════════════════════════════════════════════════════════════════════════════

## เพิ่ม element ใหม่ — 5 บรรทัด

ถ้า contributor อยากเพิ่ม operation ใหม่ — เช่น `git.tags`:

```ts
// 1. เขียน implementation ที่ packages/core/src/git/tags.ts
export async function listTags(opts: { cwd: string }): Promise<string[]> { ... }

// 2. ลงทะเบียน manifest ที่ packages/core/src/periodic/catalog.ts
declare({
  id: "git.tags",
  kind: "element",
  summary: "List git tags from the working repo.",
  description: "Wraps `git tag -l` for sorted tag listing.",
  inputs: { cwd: "string" },
  output: "string[]",
  cost: { io: "subprocess", cpu: "low", msP50: 20 },
  deterministic: true,
  sideEffect: "git",
  tags: ["git", "history"],
  modulePath: "../git/tags.js",
  exportName: "listTags",
});

// 3. (optional) เพิ่ม atom ที่มี parameter เฉพาะ
declare({
  id: "git.tags.recent",
  kind: "atom",
  element: "git.tags",
  bind: {},                       // ตอนนี้ไม่มี bind, แต่อาจจะมีถ้า listTags รับ "since"
  // ... rest of manifest
});
```

CI test (`registry.validateAll()`) จะ catch ทุก mismatch (id duplicate, broken cross-ref, missing tag) — fail-loud ก่อน merge.

═══════════════════════════════════════════════════════════════════════════════

## Trade-offs ที่รู้ตัว

| ปัญหา | วิธีแก้ที่เลือก |
|---|---|
| Indirection layer | Wiki + `mneme periodic-table` + commit-template — onboarding 30 นาที |
| Performance overhead 1-5ms/call | ใช้กับ composed plans เท่านั้น; existing commands ตรงๆ ไม่ผ่าน executor |
| Type safety ลำบาก | Static types สำหรับ existing path; runtime validation สำหรับ dynamic |
| 75 existing commands | **ห้าม** refactor ทั้งหมด — additive layer; refactor ทีละน้อยเมื่อ MCP/AI ต้องการ discover |

═══════════════════════════════════════════════════════════════════════════════

## Related

- 🧪 [[Periodic-Table]] — full spec ของ manifest schema + catalog ปัจจุบัน
- 🔧 [[Compose-And-Compiler]] — รายละเอียด rule-based + LLM-augmented planner
- 🧠 [[Second-Brain]] — library schema + promotion algorithm + sandbox flags
- 🆕 [[Holy-Grails]] — heartbeat / rewind / dna-fold ทำอะไร
- 💎 [[The-Frontier]] — 28+ world-firsts (Mneme บนภูมิทัศน์ของวงการ)
- 🆕 [[Originals]] — 5 originals ของ v0.36 (cognitive-twin คือฐานของ rewind + dna-fold)
