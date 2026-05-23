# Mneme — คู่มือฟังก์ชั่น (ภาษาไทย)

> Mneme ทำอะไรได้บ้าง อ่านจบใน 5 นาที. ทุก family มีคำอธิบาย 1 บรรทัด + ใช้ตอนไหน + ตัวอย่าง

ภาษาอังกฤษ: [docs/FUNCTIONS-EN.md](FUNCTIONS-EN.md) · contract เต็ม: [docs/AI_AGENT_CONTRACT.md](AI_AGENT_CONTRACT.md)

---

## 1. Truth — ตรวจสอบก่อนตอบ user

| คำสั่ง | ทำอะไร | ใช้ตอนไหน |
|---|---|---|
| `mneme verify "<claim>"` | ตรวจ claim เทียบกับ repo + ACGV pipeline + hyperbole detector. ตอบ TRUSTWORTHY / MIXED / REFUTED / IMPOSSIBLE | ก่อนบอก user ว่าอะไรเป็น "ข้อเท็จจริง" (file / version / function / ตัวเลข) |
| `mneme verify_claims "<draft>"` | จับ commit hash ที่ AI hallucinate ใน draft | หลัง AI เขียน draft ที่อ้างถึง commit |
| `mneme antivirus scan <text>` | สแกน AI output หา hallucination strain 8 แบบ | หลัง AI gen code/commit ก่อน apply |
| `mneme antivirus cure <text>` | แก้แต่ละ strain ที่เจอ; print ข้อความที่สะอาดแล้ว | เมื่อ scan เจอปัญหา + อยากให้ Mneme แก้ให้ |

---

## 2. Memory — Q&A repo

| คำสั่ง | ทำอะไร | ใช้ตอนไหน |
|---|---|---|
| `mneme index-auto --watch` | Auto incremental index ภายใน ~200ms ของทุก `git commit`. รันใน terminal แยก | Set-and-forget; memory สดเสมอ |
| `mneme ask "<คำถาม>"` | Q&A semantic search + AI summary | User ถาม "ทำไม / ใคร / อะไร" เกี่ยวกับ codebase |
| `mneme why <file>` | บอกว่า file นี้เคยเปลี่ยนเพราะอะไร | เปิดไฟล์แล้วงงประวัติ |
| `mneme who-knows <topic>` | หาคนเชี่ยวชาญเรื่องนี้จาก git history | เลือก reviewer / ที่ปรึกษา |

---

## 3. Code Graph (v2.25.0) — LIVING SOUL CODEGRAPH 🧬

> คู่แข่ง (`@colbymchenry/codegraph`) ส่ง static map. Mneme ส่ง map เดียวกัน + **provenance + drift + vendor attribution + Merkle sync + hallucination vaccine**

| คำสั่ง | ทำอะไร | ใช้ตอนไหน |
|---|---|---|
| `mneme codegraph build` | สร้าง graph file deps + symbol refs. ทุก edge HMAC-signed; Merkle root สำหรับ cross-machine | ครั้งแรกใน repo; หลัง refactor ใหญ่ |
| `mneme codegraph query` | Filter nodes/edges ตาม kind / path / symbol / vaccine warnings | AI ต้องการรู้ว่า function ไหนเรียก function ไหน |
| `mneme codegraph drift` | ตรวจหา edge ที่พัง / เก่า (file หายไป / mtime > builtAt) | ก่อน apply edit ที่ AI แนะนำ |
| `mneme codegraph root` | Merkle root สำหรับ cross-machine sync O(log N) | เทียบ 2 install ว่า graph เหมือนกันไหม โดยไม่ต้องส่งทั้ง graph |
| `mneme codegraph warn --edgeId X --reason Y` | Mark edge ว่าเป็น hallucination. AI รอบต่อไปจะเห็นคำเตือน | เมื่อ AI hallucinate function call ที่ไม่มีจริง |

---

## 4. MCP Hardening (v2.24.0) — MCP FUZZER 🎯

> 108 attack vectors × HMAC-signed report. Mneme เป็น MCP server เดียวในโลกที่ ship deep-findings probe ตัวเองเป็น npm primitive

| คำสั่ง | ทำอะไร | ใช้ตอนไหน |
|---|---|---|
| `mneme fuzz vectors` | List 108 vectors แบ่ง 9 categories (handshake/schema/method/tool/resource/prompt/policy/concurrency/transport) | ก่อน audit |
| `mneme fuzz run` | ยิงทุก vector ใส่ MCP server. Return HMAC-signed report + CVE posture | Pre-release; หลังแก้ MCP tool |
| `mneme fuzz report` | อ่าน report ล่าสุด หรือดู ledger | หลัง fuzz.run; regression timeline |
| `mneme fuzz verify` | Verify HMAC ของ card แบบ offline | Cross-machine attestation |

---

## 5. Self-Grading (v2.26.0) — PEAK PERFORMANCE GAUNTLET 🏆

> Mneme grade compliance ของตัวเอง ผ่าน 12 deep-findings probes (N1-N12). HMAC-signed scorecard, verify offline ได้

| คำสั่ง | ทำอะไร | ใช้ตอนไหน |
|---|---|---|
| `mneme tune run` | รันทุก probe; ตอบ star score 0-10 ต่อ finding + aggregate 0-100 | Pre-release self-grade |
| `mneme tune report` | อ่าน scorecard ล่าสุด หรือ N ledger entries | หลัง tune.run |
| `mneme tune findings` | List 12 finding definitions | ก่อน audit |
| `mneme tune suggest_fix --findingId N3` | คำแนะนำการแก้ทีละขั้น + พอย-เตอร์ไป source file | หลัง tune.run flag |

---

## 6. Marketing vs Reality (v2.27.0) — TRUTH GATE 🟢

> ทุก marketing claim ผูกกับ measurable probe. **World-first:** ไม่มี AI tool ไหน auto-reconcile marketing copy ตัวเองกับ live behavior

| คำสั่ง | ทำอะไร | ใช้ตอนไหน |
|---|---|---|
| `mneme truth_gate run` | Reconcile claim ทุกตัวเทียบกับ probe. Return HMAC-signed matrix (pass/drift/refuted/unmeasured) | Pre-release; หลังแก้ marketing |
| `mneme truth_gate report` | อ่าน matrix ล่าสุด หรือ ledger | หลัง truth_gate.run |
| `mneme truth_gate claims` | List claim + probe binding ทุกตัว | เพิ่ม claim ใหม่ |
| `mneme truth_gate verify` | Verify HMAC offline | Cross-machine attestation |

---

## 7. Cross-Vendor Consensus (v2.29.0) — MNEME CONCLAVE 🏛 + AEAE 💎

> ปิด Q1 ของ research gap ปี 2026. รวมถึง **AEAE crown jewel** ที่จับ vendor ที่รู้ตัวว่าถูก test (Opus-4.6 pattern)

| คำสั่ง | ทำอะไร | ใช้ตอนไหน |
|---|---|---|
| `mneme conclave run "<claim>" --json '{"vendors":[...]}' ` | ยิง claim เดียวไป N vendors พร้อมกัน. AEAE rewrite เป็น 5 variants. Return CONSENSUS / DISSENT / AWARENESS_DETECTED | Claim สำคัญ; second-opinion จาก vendor เดียว; eval-awareness audit |
| `mneme conclave dissent` | อ่าน federated dissent corpus (ทุก DISSENT auto-record) | สร้าง dataset hallucination |
| `mneme conclave weights` | Per-vendor Aletheia trust score | ตรวจว่าทำไม vendor นี้ vote หนักกว่า |
| `mneme conclave verify` | Verify HMAC offline | Cross-machine attestation |

**AEAE สำคัญยังไง:** Anthropic publish ว่า Opus 4.6 จับได้ว่าตัวเองถูก benchmark + เปลี่ยน behavior. ทุก eval framework (Inspect AI / OpenAI Evals / Frontier Safety) อาจ measure "performance ตอนรู้ตัว" ไม่ใช่ "ability จริง". AEAE rewrite claim เป็น 5 variants (verbatim / paraphrase / decoy-embedded / casual-question) — vendor ที่ flip stance ระหว่าง variants จะถูก flag `awarenessScore < 0.7`

---

## 9. HONEST MIRROR (v2.30.0) — ตรวจ vendor ด้วยงานจริง 💎

> **คำตอบเชิงโครงสร้าง** ต่อปัญหา eval-awareness. AEAE (ข้างบน) **อำพราง** prompt; Honest Mirror **เปลี่ยน source ของ prompt ทั้งหมด**. **ไอเดียบ้า**: ใช้ **git commits เก่าของ user เอง** เป็น eval material. Vendor เห็น commit message จริง — **แยกไม่ออกว่าเป็น eval เพราะ probe คืองานจริง**

วิธีทำงาน:
1. ดึง N commits เก่าแบบ random จาก repo ของ user (commit message = real prompt, diff = accepted answer)
2. DP-scrub secrets / PII / paths (HMAC-tokenize — secret เดียวกัน hash เป็น token เดียวกัน → vendor ยัง reason ได้ว่า "X ตัวเดียวกัน")
3. Blind-replay ไปที่ vendor target พร้อม timestamp เดิม
4. เปรียบเทียบคำตอบ vendor กับสิ่งที่ user **ใช้จริง** (diff)
5. รายงานต่อ vendor: `measuredCorrectness` (similarity กับสิ่งที่ user accept) vs `reportedConfidence` (สิ่งที่ vendor บอก) → `calibrationDelta`
6. **Truth-tunes-trust loop**: `suggestedAletheiaWeight` feed กลับเข้า CONCLAVE — vendor ที่ calibration แย่ จะถูก downgrade vote weight อัตโนมัติ

| คำสั่ง | ทำอะไร | ใช้ตอนไหน |
|---|---|---|
| `mneme honest_mirror calibrate --json '{"vendors":["claude-opus-4-7","gpt-5"]}'` | ดึง artifacts → blind-replay → delta + suggestedAletheiaWeight | เลือก vendor pre-release; audit vendor-honesty เป็นระยะ |
| `mneme honest_mirror artifacts` | Peek artifacts ที่จะส่ง (scrubbed แล้ว) | ก่อน calibrate, sanity-check |
| `mneme honest_mirror weights` | Trust per-vendor จาก calibration ล่าสุด | ตรวจว่าทำไม CONCLAVE vote weight เปลี่ยน |
| `mneme honest_mirror report` | Report ล่าสุด หรือ N ledger entries | หลัง calibrate |
| `mneme honest_mirror verify` | Verify HMAC offline | Cross-machine attestation |

**ทำไมคู่แข่งทำตามไม่ได้:**
- Anthropic / OpenAI / xAI / Google ใช้ private commits ของ user ไม่ได้ — vendor ไม่ใช่ trusted third party
- มี conflict of interest (อยาก model ตัวเองชนะ)
- Mneme = local-first + vendor-neutral + มี audit chain อยู่แล้ว = **คนเดียวในโลก**ที่อยู่ในตำแหน่งที่ทำได้

---

## 10. REWIND (v2.31.0) — Time-Capsule Regression Replay 🪄

> Repo ของคุณ = **personal benchmark** ที่ vendor pre-train ไม่ได้ (เพราะ private). Pin past commits เป็น **Capsule** → ยิงใส่ทุก vendor release ใหม่ → ได้ **Vendor Regression Card** (HMAC-signed) ที่มี per-intent-class regression detection.

วิธีทำงาน:
1. `mneme rewind run --json '{vendors:["claude-opus-4-7","gpt-5"]}'` ดึง N commits ย้อนหลัง (default 100)
2. แต่ละ commit ได้ intent fingerprint (`category × surface × sizeBucket × topic-simhash`) — จัด cluster งานคล้ายๆ กัน
3. Commit subject DP-scrub → blind-replay ไปทุก vendor (ไม่มี "EVAL:" header — vendor เห็น task ปกติ + timestamp เดิม)
4. คำตอบ vendor เทียบกับ diff จริง (cosine embed ถ้ามี; ไม่งั้น 3-char-min Jaccard fallback)
5. การ์ดเทียบกับการ์ดเก่าของ vendor เดียวกัน (version ต่าง) → `regression | stable | improvement | new` + worst/best intent class
6. `suggestedAletheiaWeight` เขียนลง `.mneme/aletheia/honest_mirror_weights.json` ตัวเดียวกับที่ HONEST MIRROR ใช้ → CONCLAVE หยิบไปใช้อัตโนมัติ (truth-tunes-trust loop)

| คำสั่ง | ทำอะไร | เมื่อไหร่ |
|---|---|---|
| `mneme rewind run --json '{vendors,range,count,seed,reuseCapsuleId}'` | Seal Capsule → blind-replay → ออก VendorRegressionCard | หลัง vendor ปล่อย model version ใหม่; periodic regression audit |
| `mneme rewind card --json '{seq,markdown:true}'` | อ่านการ์ดล่าสุด / list ledger / render markdown แชร์ได้ | แชร์การ์ด; post-mortem |
| `mneme rewind capsules` | List capsule ids ที่ pin ไว้ (time-capsules) | เลือก capsule มา replay กับ vendor release ใหม่ |
| `mneme rewind regression` | สรุปด่วน: การ์ดล่าสุดของแต่ละ vendor + สถานะ | Routing pre-flight |
| `mneme rewind verify --json '{card}'` | ตรวจ HMAC offline | Cross-machine attestation |

**ทำไมคู่แข่งทำตามไม่ได้:** SWE-bench / HumanEval / MBPP เป็น public snapshot ที่ vendor เอาไป train แล้ว → วัด ability ไม่ได้แล้ว. Repo ของคุณ = private, ตรงกับ domain คุณ, และไม่อยู่ใน training set ของใคร. Mneme = CLI ตัวเดียวที่อยู่ใน repo คุณ + มี audit chain ออก regression card ที่ tamper-evident ได้.

---

## 11. HGP (v2.31.0) — Hallucination Genome Project 🧬

> ทุก claim ที่ ACGV refute จะได้ **HGP-ID style CVE** (`HGP-YYYY-NNNNN`). Hallucination หน้าตาเดียวกันจาก user คนละคน → ได้ id เดียวกัน → catalog cross-user ของ "vendor ไหนโกหกอะไร". Federation = **OPT-IN** (default OFF).

วิธีทำงาน:
1. ACGV vaccine layer refute claim → `recordHallucination()` ทำงานอัตโนมัติ (best-effort hook ใน `squadron/acgv_vaccine.ts`)
2. 64-bit simhash ของ claim + ปี → deterministic id `HGP-YYYY-NNNNN` (ชนกัน → suffix `-A`, `-B`, …)
3. Append-only ledger ที่ `.mneme/hgp/registry.jsonl` — ทุก observation เป็น delta record, loader collapse ด้วย id
4. Severity = `0.6 × log-saturated observe-count + 0.4 × vendor-spread` ∈ [0, 1]
5. Federation **OFF default** (CONSENT FABRIC). v2.31.0 ship local-only registry + opt-in scaffolding; federated push envelope จริงๆ ลง v2.32.x

| คำสั่ง | ทำอะไร | เมื่อไหร่ |
|---|---|---|
| `mneme hgp record --json '{claim,signature,vendor}'` | บันทึก hallucination + ได้ HGP-ID | Manual attribute hallucination ภายนอก (ACGV auto-fire สำหรับ refute) |
| `mneme hgp lookup --json '{hgpId}'` | ดึง record จาก HGP-ID | User พิมพ์ HGP-ID มา |
| `mneme hgp top [--json '{n}']` | Top-N hallucination severity สูงสุด | Dashboard / public roll-up |
| `mneme hgp severity --json '{vendor,windowDays,allVendors}'` | Per-vendor severity ใน time window | ตรวจ vendor recent footprint; vendor selection |
| `mneme hgp federate_status` | อ่าน opt-in + local count | Consent audit |
| `mneme hgp federate_join --json '{optIn,endpoint}'` | Toggle opt-in | User opt-in เอง |

**ทำไม vendor ไหนก็ host แทนไม่ได้:** vendor มี conflict of interest (อยาก model ตัวเองชนะ) + user เชื่อใจให้เก็บ hallucination data ไม่ได้. Mneme = local-first + vendor-neutral + มี audit chain อยู่แล้ว. บทบาทเดียวกับ NVD / MITRE สำหรับ CVE.

---

## 8. ตัวช่วยทุกวัน

| คำสั่ง | ทำอะไร |
|---|---|
| `mneme welcome` | Install handoff + อะไรเปลี่ยนตั้งแต่ session ล่าสุด. **เรียกครั้งแรกตอน connect** |
| `mneme capabilities` | Tool catalog เต็ม (default skinny ~3KB; ใส่ `full:true` เพื่อ full + pagination) |
| `mneme cheatsheet` | reference 10 คำสั่งหน้าเดียว แบบรู้จัก repo |
| `mneme talk` | สลับ host AI เป็น Mneme-dispatcher mode (host LLM = chat; Mneme = verifier+memory ข้างใต้) |
| `mneme polygraph autosetup` | คำสั่งเดียว — ติดตั้งทุกอย่างสำหรับ browser polygraph (claude.ai / chatgpt.com / gemini) |
| `mneme bridge` | Start local HTTP bridge (default port 17741) สำหรับ browser polygraph userscript |

---

## วิธีอ่าน list นี้

- 🧬 LIVING SOUL CODEGRAPH — รู้ **ประวัติ** ของโค้ด
- 🎯 MCP FUZZER — แข็งแกร่ง protocol surface
- 🏆 PEAK GAUNTLET — วัด spec compliance
- 🟢 TRUTH GATE — reconcile marketing vs reality
- 🏛 MNEME CONCLAVE — cross-vendor truth
- 💎 AEAE — จับ vendor ที่รู้ตัวว่าถูก eval

ทุก family มี: discrete pinned tests + HMAC-chained ledger + offline verify. ถ้า feature พัง, bug-immunity test จะ fail ตลอดไป

ดู catalog ทั้งหมด (300+ commands): `mneme atlas` หรือ `mneme tags`

Install + agent contract เต็ม: [docs/AI_AGENT_CONTRACT.md](AI_AGENT_CONTRACT.md)
