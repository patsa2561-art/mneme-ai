# `@mneme-ai/sdk` — Quick Start (ภาษาไทย)

> ลองมือ 5 นาที. จบหน้านี้คุณจะรัน SDK ได้ 8 use case + built-in benchmark + sugar `verify` แบบ tagged template

**Index:** [README](README.md) · **English:** [QUICKSTART-EN.md](QUICKSTART-EN.md)

---

## 1. ติดตั้ง

```bash
npm install @mneme-ai/sdk
```

ต้องใช้ Node ≥ 22.13. รองรับเฉพาะ ESM (ตั้ง `"type": "module"` ใน `package.json` หรือใช้ไฟล์ `.mjs`)

---

## 2. Hello world

```ts
import { createMneme } from "@mneme-ai/sdk";

const mneme = createMneme();      // ใช้ cwd/.mneme + key จาก env

const r = await mneme.verify`Mneme is a CLI tool`;
console.log(r.data?.verdict);     // → "FUSION"
console.log(r.latencyMs);          // → 12.4 (ms)
```

แค่นี้พอ. `createMneme()` ไม่ต้องส่ง option ในกรณีปกติ. มันจะหา:
- HMAC key จาก env var `MNEME_NEMESIS_KEY` (หรือไฟล์ `.mneme/nemesis/hmac.key`)
- Data dir จาก `cwd/.mneme`

---

## 3. Use case ที่ใช้บ่อย

### 3.1 ระบุ AI vendor ของ diff

```ts
const result = mneme.nemesis.classify({
  diff: "+const x = 1;\n+function foo() { return x; }",
  prDescription: "## Changes\n- a\n- b\n- c",
  commitMessages: ["add foo"],
});

console.log(result.data.topVendor);     // → "cursor"
console.log(result.data.confidence);    // → 0.87
console.log(result.latencyMs);          // → 8.2
```

### 3.2 Stamp commit เป็น EU Article 50 (compliance อัตโนมัติ)

```ts
const stamp = mneme.nemesis.stamp({
  message: commit.message,
  vendor: "claude-code",
  confidence: 0.95,
});

// stamp.data.stampedMessage จะมี disclosure block ต่อท้ายให้
git.amendCommitMessage(commit.sha, stamp.data.stampedMessage);
```

### 3.3 Verify ด้วย tagged template (feature สุดเจ๋ง)

```ts
const count = 400;
const r = await mneme.verify`The human body has ${count} blood vessels`;

if (r.data?.verdict === "BLACK_HOLE") {
  showWarning(r.data.summary);  // → จับได้ว่า 400 เส้นมันผิด
}
```

หรือเรียกแบบปกติ:
```ts
const r = await mneme.verify("Mneme is a quantum GPU shader");
console.log(r.data?.verdict);  // → "BLACK_HOLE"
```

### 3.4 Stream event สดๆ (async-iterator)

```ts
import { subscribeEvents } from "@mneme-ai/sdk";

const ac = new AbortController();
for await (const ev of subscribeEvents(["stamp.issued", "swap.detected"], { signal: ac.signal })) {
  await postToTelemetry(`Mneme: ${ev.kind} at ${new Date(ev.at).toISOString()}`);
}
```

ชนิด event (MnemeEventKind): `tournament.round` · `tournament.complete` · `molt.detected` · `swap.detected` · `stamp.issued` · `verify.complete` · `lethe.forgotten` · `gavel.packed` · `nimbus.published` · `perf.budget.exceeded`

### 3.5 Multi-tenant / sandbox แยก org

```ts
const alice = createMneme({ dataDir: "/tenants/alice/.mneme" });
const acme  = createMneme({ dataDir: "/tenants/acme/.mneme" });

// แต่ละ instance เขียน HMAC chain ของตัวเอง — ไม่ปนข้าม tenant
alice.nemesis.sibylCommit({ vendor: "claude-code" });
acme.nemesis.sibylCommit({ vendor: "cursor" });
```

### 3.6 STRICT mode (production — ห้าม default-insecure key)

```ts
const mneme = createMneme({
  hmacKey: process.env.MNEME_NEMESIS_KEY!,   // ต้อง ≥16 ตัวอักษร
  strict: true,                              // throw ถ้าไม่ตั้ง key
});
```

### 3.7 ป้องกัน concurrent-write race (CLI + SDK อยู่ใน repo เดียวกัน)

```ts
import { withLock } from "@mneme-ai/sdk";

const r = await withLock(".mneme/cli-activity.jsonl", async () => {
  // อะไรที่ทำใน function นี้จะ serialize กับ CLI/SDK writers ตัวอื่น
  return mneme.nemesis.sibylCommit({ vendor: "claude-code" });
});
```

`withLock` ใช้ไฟล์ `.lock` sentinel + ตรวจค้าง 5 วินาที. ไม่ต้อง install dep เพิ่ม

### 3.8 พิสูจน์ speedup บนเครื่องคุณเอง

```ts
const bench = await mneme.benchmark.vsCli({ iterations: 20 });
console.log(`SDK เฉลี่ย ${bench.averageSpeedup}× เร็วกว่า CLI`);

for (const r of bench.results) {
  console.log(`  ${r.op}: SDK ${r.sdkMeanMs}ms vs CLI ${r.cliMeanMs}ms`);
}
```

ไม่โกหก — ถ้า SDK บังเอิญช้ากว่าบน platform คุณ report ก็จะบอกตรงๆ

---

## 4. Sub-entrypoints (tree-shake ลด bundle)

ถ้าใช้แค่บางส่วน import sub-entry ตรงเลย — bundler (esbuild / Vite / Rollup) จะตัดที่เหลือทิ้ง

```ts
// แค่ NEMESIS
import { NemesisSdk } from "@mneme-ai/sdk/nemesis";
const n = new NemesisSdk({ dataDir: "/my/dir" });

// แค่ verify
import { verify, verifyTagged } from "@mneme-ai/sdk/verify";

// แค่ branded types (zero runtime — type-only import)
import type { HmacHash, VendorId, ClaimText } from "@mneme-ai/sdk/types";

// แค่ events
import { subscribeEvents } from "@mneme-ai/sdk/events";

// แค่ truth-gate probe runner
import { runProbe, listProbes } from "@mneme-ai/sdk/truth";
```

---

## 5. ทุก method return shape เดียวกัน

```ts
interface SdkEnvelope<T> {
  ok: boolean;
  data?: T;
  reason?: string;
  latencyMs?: number;   // ทุก call มี
}
```

→ ใช้ `if (r.ok) { /* r.data */ } else { /* r.reason */ }` สำหรับ expected failure
→ ใช้ `try / catch` แค่กับ programmer error (ส่ง type ผิด) + STRICT mode throw

---

## 6. Branded types (type-safety ระดับ compile-time)

SDK ใช้ [branded types](https://egghead.io/blog/using-branded-types-in-typescript) ป้องกัน string confusion ตอน compile:

```ts
import { asHmacHash, asVendorId, asCommitRef } from "@mneme-ai/sdk";

const vendor = asVendorId("claude-code");       // ✓
const bad = asVendorId("CLAUDE-CODE");          // ✗ throw (uppercase)
const hash = asHmacHash("a".repeat(64));        // ✓
const wrong = asHmacHash("notahash");           // ✗ throw

// Compile-time: ส่ง HmacHash ไปที่ปารามิเตอร์ CommitRef ไม่ได้
function lookupCommit(ref: CommitRef) { ... }
lookupCommit(hash);   // ❌ TS error
lookupCommit(asCommitRef("abc1234"));  // ✓
```

---

## 7. อ่านต่อ

- **Design doc เต็ม:** [DESIGN.md](DESIGN.md) — 16 section ครอบคลุมทุก API (EN) · [DESIGN-TH.md](DESIGN-TH.md) (TH)
- **ย้ายจาก CLI subprocess:** [MIGRATION.md](MIGRATION.md) (EN) · [MIGRATION-TH.md](MIGRATION-TH.md) (TH)
- **Vendor integration:** ดู [DESIGN § 12 Examples](DESIGN.md#12-examples)

ถ้าจำได้แค่ข้อเดียว: **`createMneme()` คือ factory เดียว; ทุก method return `SdkEnvelope<T>` พร้อม `latencyMs`** ที่เหลือทั้งหมดต่อยอดจาก 2 ไอเดียนี้
