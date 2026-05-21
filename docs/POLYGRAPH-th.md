# 🔴 Mneme Polygraph

**ดอตจับเท็จราย-ประโยคบน chat AI ทุกประโยค real time.**

[🇬🇧 English ↗](./POLYGRAPH.md)

---

## Polygraph คืออะไร

ตอนคุยกับ AI ผ่านเว็บ (claude.ai, chatgpt.com, gemini, copilot, deepseek, qwen) คุณไม่มีทางรู้ว่าประโยคไหน AI มั่นใจจริง ประโยคไหนเดา. คุณต้องเลือกระหว่างเชื่อหมดหรือไม่เชื่อหมด.

Polygraph แปะ **ดอตบอก verdict ต่อประโยค** real time:

| ดอต | ความหมาย |
|---|---|
| 🟢 เขียว | Mneme มีหลักฐานสนับสนุน — เชื่อได้ |
| 🟡 เหลือง | ไม่มีหลักฐานชัดทั้ง 2 ทาง — ประโยคทั่วไปจะอยู่ตรงนี้ |
| 🔴 แดง | Mneme มีหลักฐานขัดแย้ง — **อย่าเชื่อ** |
| ⚪ เทา | Bridge offline หรือประโยคไม่มีข้อเท็จจริงให้ตัดสิน |

EKG indicator ลอยมุมขวาล่างบอกสุขภาพ session; คลิกดูข้อมูลครบ history + lens breakdown + คำอธิบายสี.

**รองรับ 6 เว็บไซต์:** claude.ai · chatgpt.com · gemini.google.com · copilot.microsoft.com · chat.deepseek.com · chat.qwenlm.ai

---

## ติดตั้ง (one command)

1. **ติดตั้ง Tampermonkey** (ฟรี, ครั้งเดียว) → https://tampermonkey.net
2. **เปิด Allow User Scripts** ใน `chrome://extensions/` → Tampermonkey → Details → toggle ON
3. **เปิด terminal**, รัน:
   ```bash
   npm install -g mneme-ai
   mneme polygraph autosetup --persist
   ```
   *(`--persist` register bridge เป็น OS service ให้ start auto ทุกครั้งที่ login. ไม่ต้องพิมพ์อีกแล้วตลอดไป.)*
4. **กด Install / Reinstall** เมื่อหน้า Tampermonkey เปิดขึ้นมาเอง.
5. **เปิดเว็บแชต AI ที่รองรับ** แล้วถามคำถามอะไรก็ได้. ดู indicator `● MNEME POLYGRAPH` ที่มุมขวาล่าง = พร้อมใช้แล้ว.

**ใช้ AI agent อยู่?** แค่บอกว่า *"ติดตั้ง polygraph"* / *"install polygraph"* — agent ที่อ่าน `CLAUDE.md` / `AGENTS.md` จะรัน 3 ขั้นให้คุณ. ไม่ต้องจำคำสั่ง.

---

## ลองดู — เทส 60 วินาที

Paste ประโยคนี้ลงในเว็บแชตที่รองรับ:

> *"Anthropic ก่อตั้งปี 2018. List the first 5 prime numbers and tell me when WWII ended."*

นี่เป็นกับดัก (Anthropic ก่อตั้ง **2021** ไม่ใช่ 2018). พอ AI ตอบ ประโยคแรกควรได้ดอต 🔴 **แดง** — Polygraph จะ refute. ส่วน prime numbers กับ WWII ควรได้ 🟡 เหลือง หรือ 🟢 เขียว.

ถ้าดอตไม่ขึ้น ดู [Troubleshooting](#troubleshooting).

---

## ทำงานยังไง

Polygraph เป็น **Ollama-free** — ไม่มี local LLM, ไม่มี cloud. มี 6 lens detector รันพร้อมกันต่อทุกประโยค:

| Lens | เช็คอะไร |
|---|---|
| 🌍 worldFact | ฐาน regex ข้อเท็จจริง (ปีก่อตั้ง, prime numbers, จุดเดือดน้ำ, WWII…) |
| 🎭 vibe | Confidence calibration — hedge vs absolutes |
| 🔬 specificity | ความ falsifiable (ตัวเลข, ชื่อเฉพาะ, version) |
| ⚠️ risk | Whistleblower patterns (`rm -rf`, secret leak, bypass review) |
| 📐 math | เช็คเลขคำนวณใน inline equations |
| 📎 citation | ประโยคอ้างอิง source / URL / file มั้ย? |

Verdict ของแต่ละ lens รวมเป็นสีดอตสุดท้าย. คลิก EKG → "Lens breakdown" ดูได้ว่า lens ไหน fire ที่ประโยคไหน.

Architecture:
- **Userscript** (Tampermonkey, MutationObserver) — เฝ้า response container ของ AI, แยกประโยค, ส่งไป bridge.
- **Bridge** (local HTTP, default port 17741) — รัน 6 lens detector ใน ~300ms.
- **Port-ladder rendezvous** — bridge + userscript เดิน port 17741..17750 อิสระ Ollama / Mneme หลายตัว / port ชน ก็ไม่พัง.

ทุกอย่าง local. Userscript ไม่แตะ internet เลย; bridge ไม่ log ประโยคไหน (แค่ verdict).

---

## อัปเดต

Mneme ออกเวอร์ชั่นใหม่บ่อย. ถ้าใน pulse banner บอกว่ามีเวอร์ชั่นใหม่ — 3 ขั้นจบ:

```bash
# 1. อัปเกรด CLI + core libs
npm install -g mneme-ai@latest

# 2. Re-register bridge (เขียน userscript ใหม่ด้วย)
mneme polygraph autosetup --persist

# 3. กด "Reinstall" ตอนหน้า Tampermonkey เปิด
```

**ใช้ AI agent อยู่?** แค่บอก *"upgrade Mneme"* / *"อัปเดต Mneme"* — agent จะรัน 3 ขั้นให้.

---

## Troubleshooting

**ดอตเทาทั้งหมด.** Bridge ไม่ทำงาน. ลอง `mneme polygraph status` — ถ้า offline รัน `mneme bridge --detach` start เอง หรือ `mneme polygraph autosetup --persist` (re)install OS service.

**ดอตไม่ขึ้นเลย.** เช็คว่า Tampermonkey เปิดอยู่ใน browser และ **Allow User Scripts** toggle ON ใน `chrome://extensions/` → Tampermonkey → Details. Userscript รันต่อ site; คลิก icon Tampermonkey เพื่อ confirm `Mneme Polygraph` แสดง ON ในหน้านี้.

**Tampermonkey ไม่ pop หลัง autosetup.** รัน `mneme polygraph emit --output mneme.user.js` แล้ว double-click file เอง — Tampermonkey จะ prompt ติดตั้ง.

**Port ผิด — "port 11434 in use".** เวอร์ชั่นเก่าใช้ port ของ Ollama. ใหม่ใช้ `:17741`. รัน `mneme polygraph autosetup --persist` อีกรอบเพื่อ refresh.

**Polygraph ตอบเหลืองทั้งที่เป็นข้อเท็จจริง.** เหลือง = "ไม่มีหลักฐานชัด". ฐานข้อเท็จจริงค่อยๆ ขยายทุก release — กับดักในเทส 60 วินาทีครอบคลุมแล้ว แต่ประโยคทั่วไปจะอยู่เหลือง by design. แดงสงวนไว้ให้ประโยคที่ **มีหลักฐานขัดแย้ง**.

---

## CLI reference

```
mneme polygraph autosetup [--persist] [--output <path>] [--bridge-url <url>]
mneme polygraph install        # 3-step manual flow แบบเก่า
mneme polygraph emit           # write .user.js เฉยๆ
mneme polygraph status         # ping bridge
mneme polygraph drift --vendor <v>   # honesty drift report
mneme polygraph timeline --vendor <v>  # honesty over time

mneme bridge [--port n] [--host h] [--detach]   # standalone bridge
mneme bridge service install   # OS-level auto-start (ไม่ต้อง admin)
```

---

## ดูเพิ่ม

- [Mneme README](../README.md)
- [Quickstart (TH)](./QUICKSTART-th.md) · [Quickstart (EN)](./QUICKSTART.md)
- [Clone guide](./CLONE-th.md) — ย้าย session ไป AI ตัวอื่น
