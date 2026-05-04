# LinkedIn — Thai dev community draft

> LinkedIn is a different beast. Personal voice + the journey + the lesson. Numbers still matter but the framing is human, not technical-cold.
>
> เขียนภาษาไทย — กลุ่มเป้าหมายคือ dev ไทยและคนต่างประเทศที่ติดตาม Thai tech.

## Post (ภาษาไทย, ภาษาอังกฤษด้านล่าง)

```
ปัญหาจริงของ AI coding assistant ทุกวันนี้ ไม่ใช่ความฉลาดของโมเดล

แต่คือมัน "มองไม่เห็นทั้ง codebase" และ "ไม่รู้ว่าทำไม"

ผมถาม Claude ว่า "ทำไมโค้ดส่วนนี้ถึง try/catch แปลกๆ?" มันมองแค่ไฟล์ปัจจุบันแล้วเดา
มันไม่เห็น PR ที่อธิบายไว้เมื่อ 8 เดือนก่อนว่าเจอ bug ของ Stripe ส่ง BigInt มา

ก็เลยลงมือสร้างเครื่องมือที่ผมต้องการเอง — Mneme (μνήμη — เทพีกรีกแห่งความทรงจำ)

เป็น CLI + MCP server ที่ index git history ทั้งหมด
แล้วให้ Claude / Cursor / Copilot ถามได้ว่า "ทำไม"

🔧 Tech: TypeScript monorepo, SQLite + FTS5 + vector blob, hybrid retrieval (BM25 + cosine ผสมด้วย Reciprocal Rank Fusion)

📊 วัดผลจริง ไม่ใช่อ้างลอยๆ:
  • recall@3:  86.7%
  • MRR:       90.0%
  • query p50: 1.2 ms
  • 98 unit tests + integration tests + eval harness + benchmark suite

🛡️ Local-first 100%:
  • Ollama default — โค้ดไม่ออกจากเครื่อง
  • ฟรี ไม่ต้อง API key
  • MIT license

💭 บทเรียนที่อยากแชร์:

1. การทำ AI tool ที่ "ฉลาด" ไม่ได้อยู่ที่ model — อยู่ที่ context ที่ป้อนให้ model
2. การสร้าง eval harness ตั้งแต่วันแรก คือสิ่งที่แยกของเล่นออกจากของใช้จริง
3. คนไทยทำ open-source ระดับโลกได้ ถ้ากล้าเริ่ม

repo: github.com/patsa2561-art/mneme-ai
ลอง clone ดูได้ ทุกอย่างเปิดหมด

ใครทำงานสายเดียวกัน หรือเคยเจอปัญหา AI hallucinate เพราะขาด context มาแลกเปลี่ยนกันได้

#opensource #ai #developertools #thailand #คนไทยทำได้ #mcp #claude
```

---

## English version (for cross-posting)

```
The real problem with AI coding assistants today isn't model intelligence.

It's that they don't see your entire codebase, and they don't know why.

I ask Claude "why does this code use try/catch around toString()?" — it looks at the current file and guesses. It doesn't read the PR from 8 months ago that explains the BigInt bug from Stripe.

So I built the tool I wished existed — Mneme (μνήμη, the Greek personification of memory).

A CLI + MCP server that indexes git history (commits + PR descriptions + issue bodies + blame) and lets any AI assistant query the WHY.

Stack: TypeScript monorepo, SQLite + FTS5 + BLOB embeddings, hybrid retrieval (BM25 + cosine fused via Reciprocal Rank Fusion).

Numbers (measured, not claimed):
  • recall@3:  86.7%
  • MRR:       90.0%
  • query p50: 1.2 ms
  • 98 unit + integration tests, eval harness, benchmark suite, CI on Win/Mac/Linux × Node 20/22

Local-first by default — Ollama embedder, no API key, no telemetry, MIT-licensed.

Three things I learned building this:

1. AI tool quality isn't a function of the model — it's a function of the context you feed it.
2. Building an eval harness on day 1 is what separates toys from tools.
3. The most expensive bug is the one you fix without remembering why it existed.

github.com/patsa2561-art/mneme-ai

Looking for collaborators on phase 3 — incident correlation (joining commits with Sentry/Datadog timelines).

#opensource #ai #developertools #mcp #anthropic #claude
```

## Why this works on LinkedIn

- Personal narrative (the "why I built this" arc) — LinkedIn rewards story
- Includes a specific lesson section (LinkedIn loves lessons-learned)
- "คนไทยทำได้" frames it as community pride without overdoing it
- Includes English version for cross-pollination
- Real numbers — devs verify, executives skim

## Engagement tips

- **Tag relevant people** sparingly: 1-2 max. Tagging too many flags as engagement-bait.
- **Reply to every comment in the first 24 hours** — LinkedIn's algorithm heavily weights this.
- **Repost into Thai dev FB groups** with a different opening (don't paste the LinkedIn URL into FB; it kills both algorithms).
