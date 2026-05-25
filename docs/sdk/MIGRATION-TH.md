# ย้ายจาก CLI subprocess ไป `@mneme-ai/sdk`

SDK **เร็วกว่า CLI 30-80 เท่า** เพราะทุก call เป็น in-process — ไม่ spawn, ไม่ parse JSON, ไม่ pipe stderr

**English version:** [MIGRATION.md](MIGRATION.md)

---

## เปรียบเทียบทีละจุด

### Classify vendor ของ diff

**ก่อน (CLI):**
```ts
import { execSync } from "node:child_process";
const out = execSync(`mneme nemesis classify --stdin`, {
  input: JSON.stringify(fixture),
}).toString();
const result = JSON.parse(out).result;
// 700-984 ms ต่อ call
```

**หลัง (SDK):**
```ts
import { createMneme } from "@mneme-ai/sdk";
const mneme = createMneme();
const r = mneme.nemesis.classify(fixture);
// 10-50 ms ต่อ call · type-safe · ไม่ parse JSON
console.log(r.data.topVendor, r.data.confidence);
```

### EU Article 50 stamp

**ก่อน:**
```ts
const out = execSync(
  `mneme nemesis eu_stamp --message ${JSON.stringify(msg)} --vendor claude-code`
).toString();
const stamped = JSON.parse(out).stampedMessage;
```

**หลัง:**
```ts
const r = mneme.nemesis.stamp({ message: msg, vendor: "claude-code", confidence: 0.95 });
const stamped = r.data.stampedMessage;
```

### Verify claim

**ก่อน:**
```ts
const out = execSync(`mneme verify ${JSON.stringify(claim)}`).toString();
// fragile parsing ของ human-readable output
```

**หลัง (tagged template — sugar):**
```ts
const r = await mneme.verify`The body has ${count} blood vessels`;
console.log(r.data.verdict);  // → "BLACK_HOLE" ถ้า claim ผิด
```

### Subscribe live events

**ก่อน:** ทำไม่ได้ — CLI เป็น one-shot

**หลัง:**
```ts
import { subscribeEvents } from "@mneme-ai/sdk";
const ac = new AbortController();
for await (const ev of subscribeEvents(["stamp.issued", "swap.detected"], { signal: ac.signal })) {
  await sendToTelemetry(ev);
}
```

---

## ใช้ CLI ต่อเมื่อไหร่

- Developer script ครั้งเดียว (`mneme audit`, `mneme tune run`)
- Shell pipe / Make target
- CI script ที่ไม่ import TS module
- Keyboard check เร็วๆ (`mneme verify "claim"`)

## ย้ายไป SDK เมื่อไหร่

- IDE plugin ที่เรียก >5 ครั้งต่อ session
- Vendor integration ที่ฝัง Mneme เงียบๆ
- Long-running daemon (web server, agent)
- ที่ไหนก็ตามที่ได้ประโยชน์จาก type safety + AbortSignal + events
