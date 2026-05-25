# `@mneme-ai/sdk` — Documentation index / สารบัญเอกสาร

> World-class premium in-process SDK for Mneme. 30-80× faster than CLI subprocess.
> SDK ฝังตรงในแอปของคุณ — เร็วกว่า CLI 30-80 เท่า เพราะไม่ต้อง spawn subprocess

**npm:** `npm install @mneme-ai/sdk`
**Source:** [packages/sdk/](../../packages/sdk/)
**Version:** 2.55.0 (ships with monorepo v2.55.0)

---

## 📚 Pick your guide / เลือกคู่มือ

| Doc | English | ภาษาไทย |
|---|---|---|
| 🚀 **Quick start** (install + 8 common use cases) | [QUICKSTART-EN.md](QUICKSTART-EN.md) | [QUICKSTART-TH.md](QUICKSTART-TH.md) |
| 📘 **Design doc** (16 sections — full API, types, perf budget, test strategy) | [DESIGN.md](DESIGN.md) | [DESIGN-TH.md](DESIGN-TH.md) |
| 🔄 **Migration guide** (CLI subprocess → SDK side-by-side) | [MIGRATION.md](MIGRATION.md) | [MIGRATION-TH.md](MIGRATION-TH.md) |

---

## 🧭 Reading order / ลำดับการอ่าน

**First time / ครั้งแรก:**
1. [QUICKSTART](QUICKSTART-EN.md) — 5-minute hands-on / ลองมือ 5 นาที
2. [DESIGN § 2 Surface API](DESIGN.md#2-surface-api) — what methods exist / มี method อะไรบ้าง
3. [DESIGN § 7 Stateless vs stateful](DESIGN.md#7-stateless-vs-stateful) — which methods touch disk / method ไหนแตะ disk

**Migrating from CLI / ย้ายจาก CLI:**
1. [MIGRATION](MIGRATION.md) — side-by-side examples
2. [DESIGN § 14 Performance budget](DESIGN.md#14-performance-budget) — speedup numbers
3. [QUICKSTART § Multi-tenant](QUICKSTART-EN.md#5-multi-tenant--sandbox-isolation) — if you embed in multi-user app

**Building a vendor integration (Cursor / Continue / Cline) / ทำ vendor integration:**
1. [DESIGN § 16 SDK ≠ CLI replacement](DESIGN.md#16-sdk--cli-replacement-they-coexist) — architecture diagram
2. [QUICKSTART § Embed in IDE plugin](QUICKSTART-EN.md#2-embed-in-ide-plugin-cursor-style)
3. [DESIGN § 6 Auth + key handling](DESIGN.md#6-auth--key-handling) — how to manage HMAC keys safely
4. [DESIGN § 12 Examples](DESIGN.md#12-examples)

---

## ⚡ TL;DR

```ts
import { createMneme } from "@mneme-ai/sdk";

const mneme = createMneme();

// Tagged-template verify (the wild feature)
const r = await mneme.verify`Mneme is a CLI tool`;
console.log(r.data?.verdict);  // → "FUSION"

// Classify a diff's AI vendor
const id = mneme.nemesis.classify({ diff, prDescription, commitMessages });

// EU Article 50 stamp
const stamp = mneme.nemesis.stamp({ message: "fix bug", vendor: "claude-code" });

// Live events
for await (const ev of mneme.events(["stamp.issued"])) { telemetry.record(ev); }

// Prove the speedup on YOUR hardware
const bench = await mneme.benchmark.vsCli();
console.log(`SDK is ${bench.averageSpeedup}× faster than CLI`);
```

ดูเพิ่ม / Read more → [QUICKSTART-EN.md](QUICKSTART-EN.md) · [QUICKSTART-TH.md](QUICKSTART-TH.md)
