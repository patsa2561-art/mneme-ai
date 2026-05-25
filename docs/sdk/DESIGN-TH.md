# `@mneme-ai/sdk` — Design Document (ภาษาไทย)

**สถานะ:** Shipped v2.55.0
**กลุ่มเป้าหมาย:** AI vendors / IDE plugin authors / agent runtime ที่ต้องการ embed Mneme primitives
**สร้างบน:** `@mneme-ai/core` (single source of truth) + thin in-process wrapper
**English version:** [DESIGN.md](DESIGN.md)

---

## 1. Goals + non-goals

**Goals**
- API แบบ native, in-process สำหรับ Mneme primitives — ไม่มี overhead subprocess
- Type-safe (TypeScript-first) ด้วย branded types ป้องกัน string confusion
- เร็วกว่า CLI 30-80 เท่า (พิสูจน์ด้วย built-in benchmark)
- AI vendor embed ได้ — Cursor / Continue / Cline / Claude Code ฝัง Mneme เงียบๆ ในแอปได้
- Stateful resources (HMAC chains, SIBYL ledgers) opt-in ผ่าน `createMneme({ dataDir, hmacKey })`

**Non-goals**
- ไม่แทน CLI. CLI ยังอยู่สำหรับ developer / scripting
- ไม่แทน MCP server. MCP ยังอยู่สำหรับ AI agent tool surface
- ไม่ bundle สำหรับ browser ใน v1 (Node 22+ เท่านั้น; browser path เป็น v2 ผ่าน `@mneme-ai/sdk/browser`)

---

## 2. Surface API

```ts
import { createMneme } from "@mneme-ai/sdk";

const mneme = createMneme({
  dataDir: "/path/to/.mneme",   // optional; default = cwd/.mneme
  hmacKey: "<64-char hex>",      // optional; ใช้ env + file resolution
  strict: false,                 // optional; throw ถ้าเจอ default-insecure key
});

// NEMESIS surface
mneme.nemesis.fingerprint(fx);
mneme.nemesis.classify(fx);
mneme.nemesis.stamp({ message, vendor, confidence });
mneme.nemesis.stealthScore(fx);
mneme.nemesis.capillary(diff);
mneme.nemesis.janusObserve(fx);
mneme.nemesis.janusSwap(fixtures);
mneme.nemesis.alibi({ notVendor, fixture });
mneme.nemesis.sibylCommit({ vendor, model, version });
mneme.nemesis.sibylReveal({ sessionId, identity, nonce });
mneme.nemesis.gavelPack({ commitRef, alibi, stamp?, sibylReveal? });
mneme.nemesis.letheForget({ ledgerRelative, rowIndex, dryRun });
mneme.nemesis.nimbusPublish({ orgTag, topByElo, topByHonesty });

// Verify (tagged template หรือเรียกแบบปกติ)
await mneme.verify`Mneme is a CLI tool`;
await mneme.verify("Mneme is a quantum GPU shader");

// TRUTH GATE in-process probe runner
mneme.truth.listProbes();
await mneme.truth.runProbe({ probeId: "probe.audit.open_wounds_patched" });
await mneme.truth.runAllProbes();

// Async-iterator event bus
for await (const ev of mneme.events(["stamp.issued"])) { ... }

// Built-in benchmark
await mneme.benchmark.vsCli();
```

---

## 3. Type signatures (contract)

ทุก method return `SdkEnvelope<T>`:

```ts
interface SdkEnvelope<T> {
  ok: boolean;
  data?: T;
  reason?: string;
  /** Latency เป็น ms — populated ทุก call */
  latencyMs?: number;
}
```

Branded types อยู่ที่ `@mneme-ai/sdk/types`:

```ts
type HmacHash     = Brand<string, "HmacHash">;
type VendorId     = Brand<string, "VendorId">;
type ClaimText    = Brand<string, "ClaimText">;
type CommitRef    = Brand<string, "CommitRef">;
type IsoTimestamp = Brand<string, "IsoTimestamp">;
type SessionId    = Brand<string, "SessionId">;
```

Constructors validate + cast: `asHmacHash(s)`, `asVendorId(s)`, etc.

---

## 4. Initialization

`createMneme(opts)` เป็น factory เดียวที่ public. มันจะ:

1. Validate `opts.strict` กับ `opts.hmacKey` + `process.env.MNEME_NEMESIS_KEY`
2. Inject `opts.hmacKey` เข้า env เมื่อใส่ค่ามา (เพื่อให้ in-process consumer เห็น)
3. Return frozen instance object

เรียกหลายครั้งได้ — แต่ละ call return surface object อิสระ. มีประโยชน์สำหรับ multi-tenant test หรือ sandboxing

---

## 5. Error model

**สอง layer**:
1. **Envelope-returned errors** — ทุก method return `{ ok: false, reason }` สำหรับ expected failure (missing input, unknown probe, malformed receipt, ฯลฯ)
2. **Thrown errors** — สงวนไว้สำหรับ programmer error (ส่ง type ผิด) + STRICT mode refusal

Branded type constructors **throw** เมื่อ validation fail (TypeScript กัน most cases ตอน compile; runtime guard เป็น last line)

---

## 6. Auth + key handling

ลำดับ resolution (เหมือน core `key_management.ts`):
1. `opts.hmacKey` ที่ส่งเข้า `createMneme()`
2. `process.env.MNEME_NEMESIS_KEY`
3. `<dataDir>/nemesis/hmac.key` (mode 0600)
4. `~/.mneme/nemesis/hmac.key`
5. Default-insecure (warn ดังๆ ตอน first use; throw ใน STRICT mode)

Key bytes อยู่ใน process memory เท่านั้น — ไม่เขียน log, ไม่ serialize ไป event

---

## 7. Stateless vs stateful

| Method | Stateless? | หมายเหตุ |
|---|---|---|
| `nemesis.fingerprint` | ✅ pure | Deterministic |
| `nemesis.classify` | ✅ pure | Deterministic |
| `nemesis.stamp` | ✅ pure | HMAC over body |
| `nemesis.stealthScore` | ✅ pure | ใช้ classify |
| `nemesis.capillary` | ✅ pure | 50+ micro-tells |
| `nemesis.janusObserve` | ✅ pure | Cluster basin |
| `nemesis.janusSwap` | ✅ pure | Sequence over observations |
| `nemesis.alibi` (THEMIS) | ✅ pure | HMAC over body |
| `nemesis.sibylCommit` | ⚠ stateful | เขียน commitments.jsonl |
| `nemesis.sibylReveal` | ⚠ stateful | Append chain |
| `nemesis.gavelPack` | ✅ pure | Bundle อยู่ใน memory |
| `nemesis.letheForget` | ⚠ stateful | Rewrite ledger + backup |
| `nemesis.nimbusPublish` | ⚠ stateful | Append published_cards.jsonl |
| `verify` | ⚠ stateful | Vaccine cache + karma (default ปิดใน SDK) |

Stateful methods ที่แตะ ledger file ห่อด้วย file-lock adapter (`withLock`) เพื่อกัน CLI/SDK concurrent-write race

---

## 8. Async/sync model

I/O methods ทั้งหมดเป็น async (`Promise<SdkEnvelope<T>>`). Pure CPU methods return synchronously. AbortSignal รองรับใน event-bus subscriber (`subscribeEvents`)

---

## 9. Versioning

- **SemVer** เคร่งครัด
- `1.x` API surface stable; breaking → `2.x`
- v2.55.0 ship เป็น v2.x เพื่อให้ตรงกับ parent monorepo version (consistency ดีกว่า SDK ตั้ง version แยก)

---

## 10. Bundling + deps

- **ESM only** ใน v1 (`type: "module"` ใน package.json)
- Runtime dep เดียว: `@mneme-ai/core` (ที่มี deps ของตัวเอง)
- TypeScript types bundle มาด้วย
- Tree-shakable ผ่าน sub-entries: `@mneme-ai/sdk/nemesis`, `/verify`, `/truth`, `/events`, `/types`

---

## 11. Package matrix (ปัจจุบัน + roadmap)

| Package | Version | Status |
|---|---|---|
| `@mneme-ai/sdk` (TypeScript) | 2.55.0 | ✅ Shipped |
| `mneme-py` (Python) | — | 🔜 Planned (v2.56) |
| `mneme-rs` (Rust) | — | 🔜 Planned (v2.57) |
| `mneme-go` (Go) | — | 🔜 Planned (v2.58) |

---

## 12. Examples

**Hello world:**

```ts
import { createMneme } from "@mneme-ai/sdk";
const mneme = createMneme();
const r = await mneme.verify`Mneme is a CLI tool`;
console.log(r.data?.verdict);  // → "FUSION"
```

**Embed ใน IDE plugin (Cursor-style):**

```ts
import { createMneme } from "@mneme-ai/sdk";
const mneme = createMneme({ dataDir: app.userData() });
// ทุก commit:
const stamp = mneme.nemesis.stamp({
  message: commit.message,
  vendor: "cursor",
  confidence: 0.95,
});
git.amendCommitMessage(commit.sha, stamp.data.stampedMessage);
```

**Live event observability:**

```ts
import { createMneme, subscribeEvents } from "@mneme-ai/sdk";
const ac = new AbortController();
for await (const ev of subscribeEvents(["swap.detected"], { signal: ac.signal })) {
  await postToSlack(`Identity swap: ${ev.data.transitions[0].fromBasin} → ${ev.data.transitions[0].toBasin}`);
}
```

---

## 13. Migration guide (CLI subprocess → SDK)

ดู [MIGRATION-TH.md](MIGRATION-TH.md)

---

## 14. Performance budget

Lock ไว้ใน v2.55 perf_budget.ts:

| Op | Warm budget | Cold budget |
|---|---|---|
| `extract_fingerprint` | <30 ms | <100 ms |
| `classify_calibrated` | <50 ms | <200 ms |
| `eu_stamp` | **<30 ms** (กระชับใน v2.55) | <200 ms |
| `stealth_score` | <50 ms (กระชับใน v2.55) | <250 ms |
| `janus_observe` | <50 ms | <200 ms |

Benchmark พิสูจน์ SDK ≥ 5× เร็วกว่า CLI ในแต่ละ op

---

## 15. Test strategy

- **Unit tests** ใน `packages/sdk/src/*.test.ts` (ต่อ-method)
- **Contract tests** (`v55_0-sdk-world-class.test.ts`): SDK output ≡ CLI output สำหรับ input เดียวกัน
- **Benchmark tests**: SDK ≥ 5× เร็วกว่า CLI subprocess
- **TG probe** `probe.sdk.world_class` (severity=block): SDK dist files exist + sub-entrypoints resolve

Combined retest gate ครอบคลุมทุก suite

---

## 16. SDK ≠ ทดแทน CLI; อยู่คู่กัน

```
  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐
  │     CLI     │  │  MCP server │  │ VSCode ext  │  │     SDK     │
  │  (user      │  │  (Claude /  │  │  (IDE       │  │  (Cursor /  │
  │   พิมพ์)    │  │   Cursor)   │  │   panel)    │  │   Continue) │
  └──────┬──────┘  └──────┬──────┘  └──────┬──────┘  └──────┬──────┘
         │                │                │                │
         └────────────────┴────────────────┴────────────────┘
                                  │
                          ┌───────▼────────┐
                          │ @mneme-ai/core │
                          │ (single truth) │
                          └────────────────┘
```

Bug fix ใน core = 4 surface fixed พร้อมกัน. Zero duplication, zero drift
