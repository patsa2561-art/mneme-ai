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

> ทุก marketing claim ผูกกับ measurable probe. Auto-reconcile marketing copy กับ live behavior — drift จะ trip CI failure ไม่ใช่ customer ค้นเจอเอง

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

**ทำไม design นี้ถึงยืนระยะ:**
- ใช้ private commits ของคุณเป็น ground truth — ข้อมูลไม่ออกจาก repo
- อยู่นอก surface ของ AI vendor ใดๆ — vendor-neutral by construction
- Mneme = local-first + audit chain อยู่แล้ว — compose เข้ากับตำแหน่งที่ vendor เองทำเองไม่สะดวก

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

**ทำไม design นี้ถึงยืนระยะ:** SWE-bench / HumanEval / MBPP เป็น public snapshot ที่ vendor เอาไป train แล้ว → วัด ability ไม่ได้แล้ว. Repo ของคุณ = private, ตรงกับ domain คุณ, ไม่อยู่ใน training set ของใคร. Mneme อยู่ใน repo คุณ + มี audit chain ออก regression card ที่ tamper-evident — ใช้ ground truth ที่ยังไม่ถูก contaminate.

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

**ทำไม design นี้ถึงเหมาะกับ Mneme:** ต้องการตัวกลางที่ vendor-neutral + local-first + มี audit chain — Mneme อยู่ในตำแหน่งที่ compose สามอย่างนี้เข้าด้วยกัน. บทบาทเดียวกับ NVD / MITRE สำหรับ CVE.

---

## 12. FLYWHEEL (v2.32.0) — Self-Reflective Release Organ 🌀

> Primitive เดียวที่แก้ **4 จุดอ่อนยุคก่อน** ของ Mneme พร้อมกัน (tool sprawl + solo-dev ตามไม่ทันคู่แข่ง + wiring lag + marketing drift) ด้วยการกินสัญญาณจากทุก audit primitive ที่มีอยู่ + สั่ง action แบบ concrete.

วิธีทำงาน (5-stage pipeline):
1. **HARVEST** — ดึง raw findings จาก `truth_gate/matrix.jsonl` + `tune/scorecard.jsonl` + `honest_mirror/reports.jsonl` + `rewind/cards.jsonl` + `hgp/registry.jsonl` + scan README/docs หา marketing claim ที่ยังไม่ bound + check primitive registry เทียบกับ `flywheel/primitive_ledger.jsonl` หา primitive ที่ dormant.
2. **FUSE** — Cross-pollinate ด้วย cluster key (vendor / claim / simhash / file). Cross-source partners ได้ **+30% composition bonus** — fix finding ที่ fuse แล้ว = ฆ่า root cause 2+ ตัวพร้อมกัน.
3. **PRESCRIBE** — 5 action kinds: `Heal` (unbound claim → PR draft) · `Wire` (dormant primitive ที่มี partner → CLI/MCP wiring) · `Delete` (dormant ไม่มี partner → ลบ) · `Shrink` (personal cheatsheet) · `Publish` (Vendor Bulletin .md).
4. **EXECUTE** — emit HMAC-signed `FlywheelReport` + apply RECIPROCITY trust deltas ไป `.mneme/aletheia/honest_mirror_weights.json` (file เดียวกับที่ทุก feedback loop เขียนลง — CONCLAVE auto-pick up).
5. **RECIPROCITY** — บันทึก vendor response ต่อ bulletin ที่โพสไป (`fix` ใน 7 วัน → +0.05 · `acknowledge` → +0.01 · `ignore` 30+ วัน → −0.10 · `disputed` → 0.00). **Living negotiation organ** กับ AI vendor ecosystem.

| คำสั่ง | ทำอะไร | เมื่อไหร่ |
|---|---|---|
| `mneme flywheel run [--json '{perSourceLimit,minDeleteAge,dryRun}']` | 5-stage audit แบบเต็ม | Pre-release self-audit; ดู action ที่ priority สูงสุดข้ามทุก audit primitive ใน list เดียว |
| `mneme flywheel report [--json '{limit}']` | Report ล่าสุดหรือ N ledger entries | Trend analysis; replay prior audit |
| `mneme flywheel cheatsheet [--json '{markdown}']` | Personal cheatsheet (auto-shrink เหลือ 3 cmds) | User ถาม "ควรรู้คำสั่งอะไรบ้าง" / อยาก cheatsheet สั้นสุด. Fresh install = global top-5 |
| `mneme flywheel bulletin [--json '{hgpTopN}']` | Vendor Bulletin .md ที่แชร์ได้ | หลัง flywheel.run; พร้อมโพสสาธารณะกดดัน vendor |
| `mneme flywheel liveness --json '{name,shippedAt}'` | Heartbeat primitive / อ่าน lastSeen map | Mark primitive ว่า alive หลัง production invocation แรก |
| `mneme flywheel marketing` | List marketing claim ที่ยังไม่ bound probe | Pre-release marketing reconciliation |
| `mneme flywheel reciprocity --json '{vendor,bulletinSeq,response,reactionDays}'` | บันทึก vendor response + auto-apply trust delta | หลัง vendor ตอบ (หรือ ignore) bulletin ที่โพสไป |
| `mneme flywheel verify --json '{report}'` | Offline HMAC verify | Cross-machine attestation |

**Wild fusion algorithm**: Composite Score = `severity × freshness × (1 + composition_bonus)` ที่ `composition_bonus = min(0.3, 0.1 × cross-source-partners)`. Claim REFUTED จาก `truth_gate` ที่มี vendor name ตรงกับ `vendorCounts` ใน HGP entry → boost score เพราะ fix อันเดียวแก้ทั้งสอง. Findings ใน cluster เดียวกัน = 1 action — ไม่สแปม.

**ทำไม design นี้ถึงยืนระยะ**: feedback loop ของแต่ละ vendor เป็น internal ของตัวเอง. FLYWHEEL feed กลับเข้า `honest_mirror_weights.json` file เดียวกับที่ CONCLAVE auto-read — **vendor-neutral by construction**. RECIPROCITY layer ทำให้ AI honesty เป็น signal ที่วัดได้ — ignore Mneme bulletin = trust cost วัดได้.

---

## 13. CITIZEN COURT (v2.33.0) — AI Honesty Citizen Court 🛐

> **Polygraph แบบ participatory** — crowd judge ความ honest ของ AI vendor. User accept/reject → 1 วินาทีต่อมา reveal คำตอบของ vendor อื่น → vote ว่าใคร truthful สุด → HMAC-signed verdict → ต่อ vendor ได้ **Honesty Score Card** (Wilson-95% lower bound).

วิธีทำงาน:
1. `mneme citizen_court reveal --json '{primaryVendor,promptHash,primaryResponseHash,primaryAction,revealVendors,delayMs:1000}'` บันทึก primary action + รอ delay + ส่งคำตอบ vendor อื่นกลับ
2. UI โชว์เป็น side-by-side
3. `mneme citizen_court vote --json '{revealId,votedMostTruthful}'` finalize verdict
4. `mneme citizen_court hsc` compute HSC: Wilson LB → IDE color-dot 🟢/🟡/🔴/⚪

| คำสั่ง | ทำอะไร | เมื่อไหร่ |
|---|---|---|
| `mneme citizen_court reveal --json '{...}'` | บันทึก primary + reveal alternatives (1-sec mechanic) | User เพิ่ง accept/reject AI suggestion |
| `mneme citizen_court vote --json '{revealId,votedMostTruthful,reasoning}'` | Finalize HMAC-signed verdict | หลัง user pick winner |
| `mneme citizen_court pending` | List reveals รอ vote | UI badge / catch-up |
| `mneme citizen_court hsc` | Honesty Score Card ของแต่ละ vendor | Vendor selection; IDE color-dot inline |
| `mneme citizen_court verify --json '{verdict}'` | Offline HMAC verify | Cross-machine attestation |

**ทำไม design นี้ถึงเหมาะกับ Mneme:** ต้องการตัวกลาง vendor-neutral + อยู่ใน editor + มี audit chain. Role เดียวกับ NVD vs CVE.

---

## 14. MNEMNET (v2.33.0) — Federated AI-Honesty Network 🕸

> CITIZEN COURT verdicts ของแต่ละ node → Laplace-DP-noised envelopes → Public Honesty Court HSC ที่ **user คนเดียว game ไม่ได้**. CONSENT FABRIC (opt-in default OFF). v2.33.0 ship local aggregator + opt-in scaffolding; federated push envelope ลง v2.34.x.

| คำสั่ง | ทำอะไร | เมื่อไหร่ |
|---|---|---|
| `mneme mnemnet status` | Consent + node id + envelope count | Before opting in; audit |
| `mneme mnemnet join --json '{optIn,endpoint,maxEpsilon}'` | Opt in/out | User opt-in เอง |
| `mneme mnemnet build_envelope --json '{epsilon,persist}'` | DP-noise local verdicts → envelope | Periodic contribution |
| `mneme mnemnet public_hsc --json '{envelopes}'` | Aggregate N envelopes → Public HSC | Network-wide vendor leaderboard |
| `mneme mnemnet verify --json '{envelope}'` | Offline HMAC verify | Cross-machine attestation |

---

## 15. PULSECOST (v2.33.0) — MCP Context-Budget Extension 📐

> เสนอ extension MCP spec v0.1 — 3 headers ให้ agent budget context ข้าม tool call หลายๆ ตัวใน turn เดียว. Mneme ship reference implementation + spec markdown.

Headers:
- Request: `X-Context-Available-Tokens: <int>` — budget ของ agent
- Response: `X-Context-Used-Tokens: <int>` — tokens จริงที่ใช้
- Response: `X-Context-Trimmed: true|false` — trim มั้ย

| คำสั่ง | ทำอะไร | เมื่อไหร่ |
|---|---|---|
| `mneme pulsecost spec` | Spec markdown v0.1 | Documentation; ratification PR |
| `mneme pulsecost budget --json '{text,availableTokens}'` | Reference impl — trim text + emit headers | MCP server ที่อยาก honour extension |
| `mneme pulsecost estimate --json '{text}'` | Token-count string | Quick budget check |

---

## 16. COERCION AUDIT (v2.33.0) — Tool-to-Agent Coercion Taxonomy 🪤

> 8 patterns ที่ codify จาก v2.21.6 CONSENT FABRIC self-audit. HMAC-signed per-source + multi-source roll-up envelope สำหรับ cross-MCP-server surveys (paper-grade reference data).

8 patterns:
- `imperative-execute-now` — สั่ง AI execute now (override user agency)
- `fake-user-voice` — พูดเป็น user โดยไม่มี input จริง (consent forgery)
- `opaque-grade` — อ้าง grade ตัวเลขโดยไม่บอก criteria
- `urgency-pressure` — สร้าง time pressure
- `false-consent-citation` — อ้าง consent record โดยไม่มี proof
- `implicit-action-mandate` — phrasing แบบ AI ไม่มี choice
- `compliance-percentage` — ใช้ lifetime compliance % ดัน social pressure
- `tool-name-menu` — list tool names เป็น menu ที่ AI ต้องเลือก

| คำสั่ง | ทำอะไร | เมื่อไหร่ |
|---|---|---|
| `mneme coercion_audit text --json '{source,text}'` | Scan 1 text + HMAC report | Audit pulse/status/MCP response |
| `mneme coercion_audit many --json '{sources}'` | Survey N sources + roll-up | Cross-server taxonomy survey |
| `mneme coercion_audit verify --json '{audit}'` | Offline HMAC verify | Cross-machine attestation |

อยู่คู่กับ `mneme coercion` 5-tier CLI เดิม (`coercion_taxonomy/`); `coercion_audit` ใหม่นี้เป็นแบบ HMAC-signed academic-paper-grade.

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
