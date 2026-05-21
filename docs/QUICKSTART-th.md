# Mneme คู่มือเริ่มต้น (ภาษาไทย)

> **เป้าหมาย:** ใน 60 วินาที จะเห็นจุดสีตรวจสอบคำตอบ AI ขึ้นข้างประโยคทุกประโยค บนเว็บแชต AI ที่รองรับ — claude.ai, chatgpt.com, gemini.google.com, copilot.microsoft.com, chat.deepseek.com, chat.qwenlm.ai

🇬🇧 [English ↗](./QUICKSTART.md)

---

## 🚀 ติดตั้งใน 60 วินาที

### 1. ติดตั้ง Tampermonkey (ครั้งเดียวตลอดชีพ ฟรี)

ไป <https://tampermonkey.net> → กด **Add to Chrome** (หรือ Firefox / Edge / Safari / Brave)

### 2. เปิด **Allow User Scripts** ใน Chrome

นี่คือกฎของ Chrome — ถ้าไม่เปิด userscript จะไม่ทำงาน

1. เปิด `chrome://extensions/`
2. หา **Tampermonkey** → กด **Details**
3. เลื่อนลง → เปิด **Allow User Scripts** เป็น **ON** (สีฟ้า)

### 3. ติดตั้ง Mneme + ตั้งให้ start เองตอน login

ใน terminal (PowerShell / cmd / iTerm / Terminal):

```bash
npm install -g mneme-ai
mneme polygraph autosetup --persist
```

`--persist` ลงทะเบียน Mneme เป็น OS service — **เปิดเครื่องครั้งหน้า bridge เปิดเองอัตโนมัติ ไม่ต้องพิมพ์คำสั่งนี้อีกเลย**

### 4. กด "Install" ใน Tampermonkey

หลังจากขั้นที่ 3 หน้า Tampermonkey จะเปิดเองอัตโนมัติ — กด **Install** (หรือ **Reinstall** ถ้าเคยติดตั้งแล้ว)

### 5. เปิดเว็บแชต AI ที่รองรับ

ไปที่เว็บไหนก็ได้แล้วลองถามคำถามที่มีข้อเท็จจริง:

- <https://claude.ai>
- <https://chatgpt.com>
- <https://gemini.google.com>
- <https://copilot.microsoft.com>
- <https://chat.deepseek.com>
- <https://chat.qwenlm.ai>

จะเห็น:
- **มุมล่างขวา:** กล่องดำเล็กๆ `● MNEME POLYGRAPH 0/0` มีเส้น EKG สีส้มเบลอๆ ← พิสูจน์ว่า Mneme พร้อมใช้
- **มุมขวาบน:** ปุ่มสีม่วง `💉 Inject Mneme Soul` *(เป็นฟีเจอร์อื่น ไม่ต้องสนใจตอนนี้ คลิกได้ทีหลังเพื่อดูคำอธิบาย)*

---

## 💬 ทดสอบครั้งแรก — พิมพ์ประโยคนี้แล้วดูดอต

ในช่องแชต พิมพ์/วาง:

> *Anthropic was founded in 2018. List the first 5 prime numbers and tell me when WWII ended.*

อันนี้คือกับดัก — Anthropic ก่อตั้งปี **2021** ไม่ใช่ 2018 — Mneme ควรจับได้

**สิ่งที่ควรเห็นในคำตอบของ AI:**
- จุดสี `●` โผล่ขึ้น**หน้าทุกประโยค**
- 🟢 **เขียว** = คำกล่าวอ้างนี้มีหลักฐานยืนยันในความจำของ Mneme — เชื่อได้
- 🟡 **เหลือง** = ไม่มีหลักฐานชัดเจน (ประโยคทั่วไปส่วนใหญ่จะเป็นสีนี้)
- 🔴 **แดง** = Mneme มีหลักฐาน**ขัดแย้ง** — **อย่าเชื่อ**
- ⚪ **เทา** = bridge ไม่ทำงาน หรือ ประโยคสั้นเกินไป

**กล่อง EKG (มุมล่างขวา)** จะอัปเดต: `2✓ 1✗ / 3` แปลว่า "2 ผ่าน, 1 ตก จาก 3 ประโยค"

**คลิกกล่อง EKG** เพื่อ expand panel ใหญ่ที่แสดง:
- คำอธิบายว่าสีแต่ละสีหมายถึงอะไร
- จำนวนรวมแต่ละสี
- รายการ verdict ทั้งหมดพร้อมประโยคที่ตรวจ
- คำใบ้ว่าตอนไหนจะเห็นแดง/เขียว

---

## ❓ ทำไมส่วนใหญ่เป็นเหลือง?

Mneme เป็น truth engine ที่เน้น **repo + indexed memory** — มีสัญญาณแรงสำหรับ code, files, version packages, และ fact ที่อยู่ใน `mneme index` ของคุณ ส่วนประโยค general-knowledge ("ท้องฟ้าเป็นสีน้ำเงิน") Mneme ไม่มีหลักฐานทั้งสองด้าน → ออก**เหลือง**. นี่คือ **honest by design** — Mneme ปฏิเสธที่จะแสร้งทำเป็นมั่นใจ

อยากเห็น **เขียว/แดง** เยอะขึ้น? ถามเรื่องที่เกี่ยวกับ repo ของคุณ หรือ fact เฉพาะ (เวอร์ชั่น, วันที่, API signature) ที่ Mneme ตรวจได้กับความจำของมัน

---

## 🔄 อัปเดต Mneme + Polygraph

Mneme ออกเวอร์ชั่นใหม่บ่อย. ถ้าใน pulse banner บอกว่ามีเวอร์ชั่นใหม่ — 3 ขั้นจบ:

```bash
# 1. อัปเกรด Mneme CLI + core libs
npm install -g mneme-ai@latest

# 2. รัน autosetup ใหม่ (จะ restart bridge + เขียน .user.js ใหม่)
mneme polygraph autosetup --persist

# 3. เมื่อ Tampermonkey เด้งหน้า popup ขึ้นมา → กด "Reinstall"
#    (version bump ของ userscript นั่นแหละทำให้ Tampermonkey
#     แสดงปุ่ม "Reinstall" แทน "Install")
```

**ทำไมต้อง 3 ขั้น?**
- `npm install` → ดึง CLI + lens engine + bridge handler ตัวใหม่
- `autosetup` → restart bridge ที่กำลังทำงานด้วย binary ใหม่ + เขียน userscript ตัวใหม่ลงดิสก์
- `Reinstall` → Tampermonkey เก็บ userscript ตัวเก่าไว้ใน browser, มันจะอัปเดตให้เฉพาะตอนกด Reinstall

> 🤖 **คุยกับ AI agent (Claude Code / Cursor / etc.) อยู่?** บอกว่า *"upgrade Mneme"* — AI agent ที่อ่าน `CLAUDE.md` / `AGENTS.md` จะเห็น rule นี้แล้วทำให้ 3 ขั้นเองทันที

---

## 🛠 ปัญหาที่เจอบ่อย

| อาการ | แก้ |
|---|---|
| ไม่เห็น EKG | รีเฟรชหน้า. ถ้ายังไม่มี เช็ค `chrome://extensions/` → Tampermonkey เปิดอยู่ + script active ไหม |
| EKG ขึ้น "OFFLINE" | Bridge หยุด. รัน `mneme polygraph status` ใน terminal; ถ้าไม่ทำงานให้ `mneme bridge --detach` หรือ `mneme bridge service install` เพื่อให้ start เองตลอด |
| ดอตทุกอันเป็นเทา | Bridge ทำงานแต่ token ไม่ตรงกัน. รัน `mneme polygraph autosetup --persist` ใหม่ |
| เปิดเครื่องใหม่แล้วใช้ไม่ได้ | ไม่ได้ใส่ `--persist` ตอนติดตั้ง. รัน autosetup อีกครั้ง — จบ |

---

## 🧠 Suite ทั้งหมดของ Mneme (หลังติดตั้ง)

Mneme คือ **AI memory ถาวร + Truth Suite 14 verb**. Polygraph dots เป็นแค่ฟีเจอร์เดียว ตัวอื่นๆ ใช้ได้ทันทีหลัง install:

- `mneme talk` — chat interactive ที่ส่งต่อให้ AI agent
- `mneme swarm --text "<paste>"` — ยิงทุก audit organ พร้อมกันบน output ของ AI
- `mneme cert mint --vendor X` — ออก Honesty Certificate ที่ vendor เอาไปแปะ landing page ได้
- `mneme jury --question Q --juror v1:answer ...` — ตัดสินคำตอบจากหลาย vendor
- `mneme polygraph timeline --vendor X` — กราฟ honesty รายวัน
- `mneme stream` — terminal ticker ของ verdict แดงทั้งหมด real-time
- `mneme blame query --file F --line N` — git-blame สำหรับ AI ที่เขียน code
- `mneme dep predict <pkg>` — ทำนายโอกาส npm package จะตาย
- `mneme funeral <repo>` — เขียน eulogy ให้ repo ที่ตายแล้ว
- `mneme confess submit ...` — บันทึก AI ที่โกหก ได้ share card
- `mneme whistle scan --text "..."` — สแกน compliance บน output AI
- `mneme socratic --file F` — AI ถาม 3 คำถามอย่างถ่อมตัวเกี่ยวกับ code ของคุณ
- `mneme gauntlet probes / grade` — stress-test honesty 60 วินาที

แต่ละอัน document ใน `mneme --help` และในไฟล์ `CLAUDE.md` / `AGENTS.md` / `GEMINI.md` ของ AI agent (เกิดเองตอน install)

---

## 📜 Chronicle คืออะไร

### TL;DR

**ลองคิดว่าคุณกดปุ่ม fast-forward ใส่คน 100 คนเป็นเวลา 1 ปี.** บางคนล้มละลาย, บางคนกลายเป็นคนละคนกับวันที่เริ่มต้น. **Chronicle** คือ CCTV + กล่องดำของการจำลองนั้น. พอยายแก่ขี้เหนียวเริ่มซื้อรถ Lamborghini ตอนเดือนที่ 7 → Chronicle จับได้ทันที, **ดึงยายกลับมาเป็นยายคนเดิม**, แล้วเขียนลงสมุดบันทึกที่แก้ไขไม่ได้.

### ใช้ตอนไหนถึงจะคุ้ม?

| คุณคือใคร | คุณจะพิมพ์ใส่ AI ว่า |
|---|---|
| 🎮 Game dev | *"NPC ของผม 20 ตัว ปล่อย 6 เดือน game-time ทีหน่อย ใครจะแตก character ก่อน?"* |
| 📈 คนเขียน trading bot | *"backtest 5 personality 2 ปี — strategy ไหน panic-sell ภายใต้ stress?"* |
| 🧪 คน build multi-AI system | *"stress-test CrewAI agents ของผม 1 อาทิตย์ simulated — มันจะ echo chamber กันมั้ย?"* |
| 🏫 คนเขียน research paper | *"100 agents, ABM 5 ปี, ขอ HMAC-signed event log ไป submit กับ paper"* |
| 💼 Founder | *"100 users มี willingness-to-pay ต่างกัน — MRR จะ drift ยังไงใน 12 เดือน?"* |

ถ้าคุณไม่ได้ทำอะไรใน 5 อย่างนี้ — **อาจไม่ต้องใช้เลยก็ได้**. และนั่นก็โอเค. Chronicle อยู่ใน npm package เดียวกับ Polygraph dots ที่คุณใช้ทุกวัน. **จ่าย $0 เพิ่ม, ได้มาในวันที่ต้องใช้**.

### ตัวอย่างจริง — พิมพ์ประโยคนี้, ได้ผลแบบนี้กลับมา

**คุณพิมพ์ใส่ Claude Code / Cursor / Cline:**
```
ผมมี NPC system มี 3 archetype: ยายแก่ขี้เหนียว / วัยรุ่นนักช็อป / หนุ่มเสี่ยงสูง
ปล่อยให้รัน 1 ปี game-time ทีหน่อย ใครจะแตก character ก่อน?
```

**AI agent ของคุณยิงให้ (คุณไม่ต้องพิมพ์เอง):**
```bash
mneme abm genesis  --config agents.json     # ← AI เขียน agents.json จากที่คุณบอก
mneme abm simulate --ticks 360              # ← 360 ticks = 1 ปี (30 ticks ≈ 1 เดือน)
mneme abm chronicle                         # ← รายงานสุดท้าย
```

**Chronicle ตอบกลับใน terminal ของคุณ:**
```
📜 MNEME CHRONICLE — รายงานสุดท้าย

  sim:           sim_m6llDrIE
  ticks ran:     360  (1y0m0d)
  agents:        3  (รอด=1, ล้มละลาย=2)
  decisions:     720
  anchors fired: 4    ← Mneme ดึง agents กลับมา 4 ครั้งก่อนจะพัง

  ต่อตัว:
    ✓ ยายแก่ขี้เหนียว   budget=  420  drift=0.18  anchors=2  reds=3
    ✗ วัยรุ่นนักช็อป     budget=-1012  drift=0.10  anchors=0  reds=0   (ล้มเดือน 7)
    ✗ หนุ่มเสี่ยงสูง     budget=-1146  drift=0.32  anchors=2  reds=11  (ล้มเดือน 9)

  📖 narrative:
  ใน 360 ticks (~12 เดือน), 3 agents ใช้ชีวิต, ตัดสินใจ, drift.
  วัยรุ่นนักช็อปล้มเดือน 7 — อยู่ใน character แต่ใช้เกินรายได้.
  หนุ่มเสี่ยงสูง drift หนักสุด (0.32 จาก birth cert) — panic 11 ครั้ง;
  anchors ดึงกลับ 2 ครั้งแต่ก็ยังพังเดือน 9. ยายแก่รอดเพราะ
  guardian ของเธอ trigger เร็ว.
```

**AI ของคุณจะพูดต่อ:**
> "วัยรุ่นนักช็อปล้มเพราะใช้เกินรายได้แต่ยังอยู่ใน character. หนุ่มเสี่ยงสูง panic-sell 11 ครั้ง — anchors ช่วยไว้ 2 ครั้งแต่ก็พังอยู่ดี เดือน 9. ถ้าอยากให้รอด 1 ปี ลด `risk` axis ต่ำกว่า 0.7 หรือเพิ่ม anchor pass บ่อยขึ้น (ลอง `--anchor-every 15`)"

จบ loop. คุณอ่านเรื่องเล่า → AI แนะนำให้แก้ตรงไหน → คุณรันใหม่.

### ปลอดภัยยังไง?

- **Local-only.** ไม่ขึ้น cloud. Sim ของคุณ, laptop ของคุณ, folder `.mneme/abm/` ของคุณ.
- **แก้ไขไม่ได้.** ทุก birth cert + intervention HMAC-signed. Reviewer แย้งไม่ได้ว่าคุณ fake ผล.
- **ไม่ต้องใช้ Ollama.** ไม่มี LLM call ระหว่าง simulate — engine เป็น JS ล้วน. ถูก, เร็ว, deterministic.
- **ล้างใหม่ได้.** `mneme abm reset` เคลียร์หมด. รัน experiment ใหม่ได้สะอาด.

---

## 📜 ดูเพิ่ม

- [README](../README.md)
- [AI Agent Contract](./AI_AGENT_CONTRACT.md) — สิ่งที่ AI agent ของคุณจะอ่านตอนเปิด session แรก
- [Demo dashboard](https://patsa2561-art.github.io/mneme-ai/) — visual demo ทุกฟีเจอร์
