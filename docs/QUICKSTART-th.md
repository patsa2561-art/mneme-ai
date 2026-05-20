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

Mneme ขึ้นเวอร์ชั่นใหม่ทุกครั้งที่ feature ใหม่ลง npm (วันละหลายครั้งเลย). CLI จะเช็คให้เองทุกๆ prompt — ถ้าพี่เห็นใน pulse บอกว่า **"v2.19.X is available"** ให้ทำ 3 ขั้นนี้:

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

## 📜 ดูเพิ่ม

- [README](../README.md)
- [AI Agent Contract](./AI_AGENT_CONTRACT.md) — สิ่งที่ AI agent ของคุณจะอ่านตอนเปิด session แรก
- [Demo dashboard](https://patsa2561-art.github.io/mneme-ai/) — visual demo ทุกฟีเจอร์
