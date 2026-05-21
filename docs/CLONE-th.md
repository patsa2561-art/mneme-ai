# 📡 Mneme Clone

**คำสั่งเดียวย้ายบทสนทนา AI ปัจจุบันไปที่ไหนก็ได้ — editor อื่น, มือถือ, คอมเครื่องที่สอง**

ไม่ต้อง paste history. ไม่ต้องเล่า context ใหม่. ไม่ต้องจำชื่อคำสั่ง.

[🇬🇧 English ↗](./CLONE.md)

---

## Clone คืออะไร

ตอนคุณคุยกับ AI ใน editor (Claude Code, Cursor, Codex, Cline, Continue, Zed) บทสนทนาจะอยู่แค่ใน window เดียวนั้น. พอเปลี่ยน tool หรือเปลี่ยนเครื่อง → context หายหมด.

`mneme clone` จับ **บทสนทนาปัจจุบัน real time** แล้วส่ง "soul prompt" ที่ paste ได้ ไปยังปลายทางที่คุณเลือก. Paste ใน AI ใหม่ → คุยต่อจากที่ค้างไว้ได้เลย.

3 transport ครอบคลุมทุกสถานการณ์:

| คุณอยากจะ… | พิมพ์ | เกิดอะไรขึ้น |
|---|---|---|
| เปิดบทสนทนานี้ใน AI อื่น **เครื่องเดียวกัน** | `mneme clone` | Soul prompt ลง clipboard. เปิด editor ใหม่ กด Ctrl/Cmd-V. |
| ส่งไป **มือถือ / iPad** ที่อยู่ WiFi เดียวกัน | `mneme clone qr` | Local web server + QR สแกนได้. มือถือสแกน → soul auto-copy ลง clipboard มือถือ. |
| ส่งไป **เครือข่ายอื่น** (คอมที่บ้าน, cellular, เพื่อน) | `mneme clone remote` | Public URL anonymous + QR. ผู้รับเปิด URL. |

---

## เริ่มใช้

### 1. เครื่องเดียวกัน, AI ตัวอื่น

```bash
mneme clone
```

```
📡 MNEME CLONE — clipboard
  ✅ written via win-clip  (8,016 bytes · ~1455 tokens)

  Next: open Claude Code / Cursor / Codex in your destination workspace,
        click into the chat box, press Ctrl+V, send.
```

จบ. เปิด editor ปลายทาง, paste, ส่ง. AI ใหม่จะรับ context เหมือนเป็น memory ของตัวเอง.

### 2. ส่งไปมือถือ (WiFi เดียวกัน)

```bash
mneme clone qr
```

จะได้:
- LAN URL 2-3 URL (Mneme เลือก network interface ที่ถูก)
- QR แบบ SVG inline ที่ AI agent render ในแชทได้เลย
- HTTP server ป้องกัน token, อายุสั้น, auto-stop หลัง idle 10 นาที

สแกน QR ด้วยกล้องมือถือ. หน้าที่เปิดมาจะ auto-copy soul prompt ลง clipboard มือถือ.

### 3. ข้ามเครือข่าย

```bash
mneme clone remote
```

Upload ไปยัง `dpaste.com` (anonymous, expire 1 วัน) แล้ว return short URL. เปิดบน device ไหนก็ได้, copy soul prompt, paste ใน AI.

> ⚠ **เป็น public paste.** ใครที่มี URL อ่านได้ก่อน expire. **ห้ามใช้** กับ session ที่มี secrets / API keys / PII.

---

## ไม่ต้องจำคำสั่ง

ไม่จำเป็นต้องพิมพ์ `mneme clone`. AI agent ใน editor ของคุณอ่าน rule ของ Mneme และเข้าใจ intent ภาษาธรรมชาติทั้งไทย/อังกฤษ:

> *"clone session นี้"* · *"ส่งสมอง"* · *"ส่งความจำ"* · *"ย้ายไปคุยต่อใน Cursor"* · *"continue elsewhere"*
> → ยิง `mneme clone` ให้อัตโนมัติ

> *"ส่งสมองไปมือถือ"* · *"แสกน QR"* · *"send to phone"* · *"beam to iPad"*
> → ยิง `mneme clone qr` ให้อัตโนมัติ

> *"ส่งไปคอมที่บ้าน"* · *"ส่งทางไกล"* · *"phone is on cellular"*
> → ยิง `mneme clone remote` ให้อัตโนมัติ

AI จะ surface ผลลัพธ์เป็นภาษาธรรมดา — *"บทสนทนาอยู่ใน clipboard แล้ว เปิด Cursor แล้ว paste ได้เลย"*. คุณไม่เห็นชื่อ verb เลย.

---

## เบื้องหลังทำงานยังไง

`mneme clone` รวม 3 primitive ของ Mneme เข้าด้วยกัน — แต่คุณไม่ต้องรู้. สำหรับคนอยากรู้:

1. **`live_session_mirror`** — Mneme อ่าน file conversation ของ AI editor ตรงจาก disk (`~/.claude/projects/<repo>/<id>.jsonl`). ไม่ผ่าน vendor API. ไม่มี daemon บันทึก. **ข้อมูลของคุณบน disk ของคุณ**.
2. **`genesplice.compressToSoulPrompt`** — แปลง 30 turns ล่าสุดเป็น portable prompt ~1500 tokens พร้อม voice directive, dictionary, version gate, และ HMAC origin signature.
3. **Transport** — clipboard (OS native), beacon (local HTTP + QR), หรือ relay (anonymous paste).

ทุกอย่าง local-first. Clipboard กับ LAN transport ไม่แตะ internet เลย.

---

## ตัวเลือก

```
mneme clone [transport]

  transport            clipboard | qr | remote   (default: clipboard)

Options:
  --receiving-vendor   Vendor tailoring: claude / chatgpt / gemini / cursor / cline / codex
                       ปรับ soul prompt ให้เหมาะกับ quirks ของ AI ปลายทาง
  --last-n <n>         จำนวน turn ล่าสุดที่จะรวม (default 30)
  --port <n>           Port สำหรับ `qr` transport (default 7741)
  --json               Output แบบ JSON
```

---

## คำถามที่พบบ่อย

**AI ปลายทางต้อง install Mneme ด้วยมั้ย?**
ไม่ต้อง. Soul prompt เป็น plain text. AI ไหนที่รับ paste ได้ก็ใช้ได้. Mneme ที่ปลายทางจะปลดล็อค feature เพิ่ม (memory chain, polygraph) แต่ไม่จำเป็นสำหรับการ resume.

**AI ปลายทางเห็นอะไรบ้าง?**
Prompt ที่ self-contained มี: voice directive (วิธีพูดจา), Mneme dictionary (กันแปล jargon ผิด), origin metadata (HMAC-signed), context summary, turns ล่าสุด, decisions ที่ดึงมา. ประมาณ 1,500 tokens — ใส่ใน first message ของ AI ตัวไหนก็ได้.

**Clipboard sync ของผม (Phone Link / Universal Clipboard / KDE Connect) ตั้งไว้แล้ว — clipboard transport ส่งถึงมือถือมั้ย?**
ใช่. `mneme clone` write ลง OS clipboard; sync provider จะ mirror ไปมือถือภายในไม่กี่วินาที. ไม่ต้อง QR.

**LAN URL ปลอดภัยมั้ย?**
URL มี token random 12 ตัวอักษร. ไม่มี token = server return 404 — port scanner เห็นไม่ได้. Server ก็ auto-stop หลัง idle 10 นาที.

**Clone จาก Cursor / Codex / Cline ได้มั้ย?**
ตอนนี้ live mirror อ่านได้แค่ Claude Code session file. Cursor กับ Cline เก็บบทสนทนาในรูปแบบของตัวเอง; การ support เพิ่มอยู่ใน roadmap. ตอนนี้ clone จาก Claude Code window เป็นหลัก.

---

## ดูเพิ่ม

- [Mneme README](../README.md)
- [Quickstart (TH)](./QUICKSTART-th.md) · [Quickstart (EN)](./QUICKSTART.md)
