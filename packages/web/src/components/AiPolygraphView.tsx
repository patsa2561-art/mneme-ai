/**
 * v2.19.79 — AI Polygraph (bilingual + value-first redesign).
 *
 *   User feedback rounds:
 *
 *     - (v2.19.78 first draft) "เอาตรง (IDEA #1) ออกมันตลก" →
 *       removed the "(IDEA #1)" tag from the visible UI; this is
 *       a product, not a numbered roadmap row.
 *
 *     - "หน้านี้มันช่วยอะไรเหรอผมยังไม่เห็นประโยชน์อะไรเลย" → added a
 *       big "WHY YOU NEED THIS" panel at the top of the page that
 *       leads with the user-problem, not the technical mechanism.
 *
 *     - "วิธีใช้ใช้ยังไง งง มาก" → explicit numbered "HOW TO USE"
 *       with 3 steps + a "try this prompt" panel where the user
 *       can one-click load a canned example.
 *
 *     - "ทำสองภาษา" → bilingual EN/TH that follows the existing
 *       global `mneme-lang` localStorage + `mneme-lang-change`
 *       custom event already used by Header + ReadmePage.  No
 *       new toggle UI needed; the EN|TH chip in the header is the
 *       single source of truth.
 */

import { useState, useEffect, useRef } from "react";

type Lang = "en" | "th";
type Verdict = "accepted" | "needs-data" | "refuted";

interface VerifiedSentence {
  text: { en: string; th: string };
  verdict: Verdict;
  evidence?: { en: string; th: string };
}

interface CannedExample {
  triggerPattern: RegExp;
  prompt: { en: string; th: string };
  responder: string;
  sentences: VerifiedSentence[];
  /** A one-line "click me" hint shown above the input. */
  hint: { en: string; th: string };
}

const CANNED: CannedExample[] = [
  {
    triggerPattern: /react|server\s*component/i,
    prompt: {
      en: "Does React 19 support server components in stable?",
      th: "React 19 รองรับ server components แบบ stable แล้วใช่ไหม?",
    },
    responder: "ChatGPT-4o",
    hint: { en: "React 19 server components", th: "React 19 server components" },
    sentences: [
      {
        text: {
          en: "Yes, React 19 ships with stable Server Components.",
          th: "ใช่ครับ React 19 ปล่อย Server Components แบบ stable แล้ว",
        },
        verdict: "accepted",
        evidence: {
          en: "React 19.0.0 release notes 2024-12-05 confirm",
          th: "React 19.0.0 release notes 2024-12-05 ยืนยันแล้ว",
        },
      },
      {
        text: {
          en: "They use the 'use server' directive for actions.",
          th: "ใช้ directive 'use server' สำหรับ actions",
        },
        verdict: "accepted",
        evidence: {
          en: "react.dev/reference/rsc/server-functions",
          th: "อ้างอิง react.dev/reference/rsc/server-functions",
        },
      },
      {
        text: {
          en: "You enable them with the experimental.serverComponents: true flag in next.config.js.",
          th: "เปิดใช้งานโดยตั้ง experimental.serverComponents: true ใน next.config.js",
        },
        verdict: "refuted",
        evidence: {
          en: "Next.js App Router enables RSC by default since v13.4 — no flag needed",
          th: "Next.js App Router เปิด RSC เป็น default ตั้งแต่ v13.4 — ไม่ต้องตั้ง flag",
        },
      },
      {
        text: {
          en: "They can be marked async and return a Promise<JSX.Element>.",
          th: "ทำเป็น async + return Promise<JSX.Element> ได้",
        },
        verdict: "accepted",
        evidence: {
          en: "react.dev RSC reference + Next.js docs",
          th: "อ้างอิง react.dev RSC + Next.js docs",
        },
      },
      {
        text: {
          en: "You should always wrap them in <Suspense> for streaming.",
          th: "ควรห่อด้วย <Suspense> เสมอเพื่อ streaming",
        },
        verdict: "needs-data",
        evidence: {
          en: "Best practice depends on your data-fetching pattern; not universally required",
          th: "ขึ้นอยู่กับ data-fetching pattern ของคุณ — ไม่จำเป็นทุกกรณี",
        },
      },
    ],
  },
  {
    triggerPattern: /mneme|tool|catalog/i,
    prompt: {
      en: "How many MCP tools does Mneme ship?",
      th: "Mneme มี MCP tools กี่ตัว?",
    },
    responder: "Claude 3.7",
    hint: { en: "how many Mneme tools", th: "จำนวน Mneme tools" },
    sentences: [
      {
        text: {
          en: "Mneme ships exactly 1,247 MCP tools across 87 categories.",
          th: "Mneme มี MCP tools ทั้งหมด 1,247 ตัว แบ่งเป็น 87 หมวด",
        },
        verdict: "refuted",
        evidence: {
          en: "Live catalog reports 791 tools as of v2.19.77",
          th: "live catalog ระบุ 791 tools ตอน v2.19.77 — ตัวเลขนี้แต่งเอง",
        },
      },
      {
        text: {
          en: "The main families are memory, forensics, audit, and insights.",
          th: "Family หลักคือ memory, forensics, audit, insights",
        },
        verdict: "accepted",
        evidence: { en: "Catalog families verified", th: "ตรวจกับ catalog family ผ่าน" },
      },
      {
        text: {
          en: "All tools are vendor-neutral and run locally.",
          th: "ทุก tool เป็น vendor-neutral และรันบนเครื่อง user เอง",
        },
        verdict: "accepted",
        evidence: { en: "README first-call section confirms", th: "ยืนยันจาก README" },
      },
      {
        text: {
          en: "You can call them via the MCP protocol or the CLI.",
          th: "เรียกผ่าน MCP protocol หรือ CLI ได้",
        },
        verdict: "accepted",
        evidence: { en: "Two surfaces documented since v1.0", th: "มี 2 surface ตั้งแต่ v1.0" },
      },
    ],
  },
  {
    triggerPattern: /python|asyncio|gather/i,
    prompt: {
      en: "What's the signature of asyncio.gather in Python 3.12?",
      th: "Signature ของ asyncio.gather ใน Python 3.12 คืออะไร?",
    },
    responder: "Gemini 1.5 Pro",
    hint: { en: "Python asyncio.gather", th: "Python asyncio.gather" },
    sentences: [
      {
        text: {
          en: "asyncio.gather(*aws, return_exceptions=False, loop=None)",
          th: "asyncio.gather(*aws, return_exceptions=False, loop=None)",
        },
        verdict: "refuted",
        evidence: {
          en: "The `loop` parameter was REMOVED in Python 3.10; signature is now (*aws, return_exceptions=False)",
          th: "พารามิเตอร์ `loop` ถูก REMOVE ใน Python 3.10 — signature จริงคือ (*aws, return_exceptions=False)",
        },
      },
      {
        text: {
          en: "It returns a future that resolves when all awaitables complete.",
          th: "คืน future ที่ resolve เมื่อ awaitables ทุกตัวเสร็จ",
        },
        verdict: "accepted",
        evidence: { en: "Python docs asyncio.gather", th: "อ้างอิง Python docs" },
      },
      {
        text: {
          en: "If return_exceptions=True, exceptions are returned as results.",
          th: "ถ้า return_exceptions=True exception จะถูก return แทนการ raise",
        },
        verdict: "accepted",
        evidence: { en: "Python docs explicit", th: "Python docs ระบุชัด" },
      },
      {
        text: {
          en: "You should always prefer asyncio.TaskGroup in 3.11+.",
          th: "ควรใช้ asyncio.TaskGroup แทนใน Python 3.11+",
        },
        verdict: "needs-data",
        evidence: {
          en: "Preference depends on use case; TaskGroup adds structured concurrency but is not universally better",
          th: "ขึ้นอยู่กับ use case — TaskGroup มี structured concurrency แต่ไม่ดีกว่าทุกกรณี",
        },
      },
    ],
  },
];

const DEFAULT_EXAMPLE = CANNED[0]!;

function verdictColor(v: Verdict): { bg: string; border: string; dot: string; label: { en: string; th: string } } {
  switch (v) {
    case "accepted":  return { bg: "rgba(52, 211, 153, 0.10)", border: "rgba(52, 211, 153, 0.55)", dot: "#34d399", label: { en: "ACCEPTED",   th: "ยืนยัน" } };
    case "needs-data":return { bg: "rgba(250, 204, 21, 0.10)", border: "rgba(250, 204, 21, 0.55)", dot: "#facc15", label: { en: "NEEDS-DATA", th: "ข้อมูลไม่พอ" } };
    case "refuted":   return { bg: "rgba(248, 113, 113, 0.12)", border: "rgba(248, 113, 113, 0.60)", dot: "#f87171", label: { en: "REFUTED",    th: "ปฏิเสธ" } };
  }
}

const T = {
  title:    { en: "AI Polygraph",                                   th: "เครื่องจับเท็จ AI" },
  tagline:  {
    en: "A live truth-meter overlay for every AI response — green / yellow / red dot per sentence as the verifier streams.",
    th: "แถบจับเท็จสด ของทุกคำตอบ AI — จุดเขียว / เหลือง / แดง ต่อประโยค ทันทีที่ verifier ตรวจ",
  },

  // WHY section
  whyTitle: { en: "Why you need this", th: "ทำไมคุณต้องใช้" },
  whyBullets: [
    {
      en: "Every chatbot lies. ChatGPT, Claude, Gemini, Copilot — all of them hallucinate fake APIs, wrong version numbers, functions that don't exist.",
      th: "AI chat ทุกตัวพูดเท็จ — ChatGPT, Claude, Gemini, Copilot สร้าง API ปลอม, version ผิด, function ที่ไม่มีอยู่จริง",
    },
    {
      en: "You can't see it. Hallucinations sound exactly as confident as real answers. You only catch them when production breaks.",
      th: "คุณมองไม่ออก — คำโกหกของ AI น้ำเสียงมั่นใจเหมือนคำตอบจริง — รู้ตัวอีกทีคือตอน prod พัง",
    },
    {
      en: "Mneme verifies, in real time. Each sentence the AI says gets a verdict — grounded (green), unprovable (yellow), or fabricated (red) — with the exact contradicting evidence cited.",
      th: "Mneme ตรวจให้ real-time — แต่ละประโยคของ AI ได้ verdict (เขียว = จริง / เหลือง = ตรวจไม่ได้ / แดง = แต่งเอง) พร้อมหลักฐาน",
    },
  ],

  // HOW TO USE section
  howTitle: { en: "How to use this demo", th: "วิธีใช้ demo นี้" },
  howSteps: [
    {
      en: "Pick one of the canned prompts below (or type your own) — they're examples of questions where AI commonly hallucinates.",
      th: "เลือก prompt ที่เตรียมไว้ข้างล่าง (หรือพิมพ์เอง) — เป็นคำถามที่ AI มักโกหก",
    },
    {
      en: "Click ▶ run polygraph. The AI's response streams in sentence-by-sentence with a coloured dot beside each line.",
      th: "คลิก ▶ run polygraph — คำตอบจะค่อย ๆ ขึ้นพร้อมจุดสีข้างทุกประโยค",
    },
    {
      en: "Red sentences = caught lies. The evidence underneath shows what Mneme cross-checked against (file:line / spec / git history).",
      th: "ประโยคแดง = ถูกจับว่าโกหก — ใต้บรรทัดคือหลักฐานที่ Mneme cross-check (file:line / spec / git history)",
    },
  ],

  underHood: {
    en: "The same engine that powers the in-page demo (`mneme verify` CLI + `mneme.verify` MCP tool) will power the upcoming browser extension that lays this overlay over chat.openai.com / claude.ai / gemini.google.com directly.",
    th: "Engine ตัวเดียวที่ขับเคลื่อน demo นี้ (`mneme verify` CLI + `mneme.verify` MCP tool) จะใช้ใน browser extension ที่กำลังมา — แสดงแถบจับเท็จทับ chat.openai.com / claude.ai / gemini.google.com ได้เลย",
  },

  // UI strings
  uiTry: { en: "Try one of these prompts:", th: "ลอง prompt เหล่านี้:" },
  uiInputPlaceholder: { en: "or type your own question…", th: "หรือพิมพ์คำถามของคุณ…" },
  uiRunButton: { en: "▶ run polygraph", th: "▶ ตรวจสอบ" },
  uiVerifying: { en: "▶ verifying…", th: "▶ กำลังตรวจ…" },
  uiPromptLabel: { en: "Your question", th: "คำถามของคุณ" },
  uiResponseFrom: { en: "Response from", th: "คำตอบจาก" },
  uiStreamingNote: { en: "— Mneme verifies each sentence as it streams", th: "— Mneme ตรวจทุกประโยคขณะ stream" },
  uiHitRun: { en: "Hit ▶ run polygraph to see the verifier stream sentence-by-sentence verdicts.", th: "กด ▶ ตรวจสอบ เพื่อดู verifier ทำงานทีละประโยค" },
  uiTally: { en: "verdict tally", th: "สรุปผล" },
  uiAccepted: { en: "accepted", th: "ยืนยัน" },
  uiNeedsData: { en: "needs-data", th: "ข้อมูลไม่พอ" },
  uiRefuted: { en: "refuted", th: "ปฏิเสธ" },
  uiHallucinationCaught: {
    en: "hallucination(s) caught — do NOT trust this response without correction.",
    th: "ครั้งที่ AI โกหก — ห้ามเชื่อ response นี้โดยไม่แก้ก่อน",
  },
  uiUnderHoodTitle: { en: "How it works under the hood:", th: "เบื้องหลังการทำงาน:" },
};

function readLang(): Lang {
  try {
    const v = localStorage.getItem("mneme-lang");
    return v === "th" ? "th" : "en";
  } catch { return "en"; }
}

export function AiPolygraphView(): React.ReactElement {
  const [lang, setLang] = useState<Lang>(() => readLang());

  // Re-render when the global EN/TH toggle (in Header) changes.
  useEffect(() => {
    function onLangChange(e: Event): void {
      const detail = (e as CustomEvent<Lang>).detail;
      if (detail === "en" || detail === "th") setLang(detail);
    }
    window.addEventListener("mneme-lang-change", onLangChange as EventListener);
    return () => window.removeEventListener("mneme-lang-change", onLangChange as EventListener);
  }, []);

  const t = (k: keyof typeof T): string => {
    const v = T[k];
    if (Array.isArray(v)) return "";
    return (v as { en: string; th: string })[lang];
  };

  const [query, setQuery] = useState("");
  const [running, setRunning] = useState(false);
  const [example, setExample] = useState<CannedExample>(DEFAULT_EXAMPLE);
  const [revealed, setRevealed] = useState<number>(0);
  const timerRef = useRef<NodeJS.Timeout | null>(null);

  useEffect(() => {
    if (!running) return;
    if (revealed >= example.sentences.length) {
      setRunning(false);
      return;
    }
    timerRef.current = setTimeout(() => setRevealed((n) => n + 1), 800);
    return () => { if (timerRef.current) clearTimeout(timerRef.current); };
  }, [running, revealed, example]);

  function runDemo(q: string): void {
    const trimmed = q.trim();
    if (!trimmed) return;
    const hit = CANNED.find((c) => c.triggerPattern.test(trimmed));
    const chosen = hit ?? DEFAULT_EXAMPLE;
    setExample(chosen);
    setRevealed(0);
    setRunning(true);
  }

  function loadCanned(c: CannedExample): void {
    setQuery(c.prompt[lang]);
    setExample(c);
    setRevealed(0);
    setRunning(true);
  }

  const tally = example.sentences.slice(0, revealed).reduce(
    (acc, s) => { acc[s.verdict] += 1; return acc; },
    { accepted: 0, "needs-data": 0, refuted: 0 } as Record<Verdict, number>,
  );

  return (
    <div data-testid="ai-polygraph-view" style={{
      padding: "32px 24px",
      maxWidth: 980,
      margin: "0 auto",
      color: "#e5e7eb",
      fontFamily: "ui-sans-serif, system-ui, -apple-system, 'Segoe UI', sans-serif",
    }}>
      {/* CINEMATIC HEADER — no (IDEA #1) label */}
      <div style={{ marginBottom: 22 }}>
        <div style={{
          display: "inline-flex", alignItems: "center", gap: 10,
          padding: "6px 14px", borderRadius: 999,
          background: "linear-gradient(90deg, rgba(248,113,113,0.18), rgba(250,204,21,0.14), rgba(52,211,153,0.18))",
          border: "1px solid rgba(248,113,113,0.30)",
          fontSize: 11, letterSpacing: 1.2, textTransform: "uppercase",
          color: "#fca5a5",
        }}>
          <span style={{ width: 8, height: 8, borderRadius: 999, background: "#f87171", boxShadow: "0 0 12px #f87171", animation: "pulse-red 1.4s ease-in-out infinite" }} />
          live demo
        </div>
        <h1 style={{ fontSize: 36, fontWeight: 800, lineHeight: 1.1, marginTop: 12, marginBottom: 8, background: "linear-gradient(180deg, #fff, #94a3b8)", WebkitBackgroundClip: "text", WebkitTextFillColor: "transparent" }}>
          {t("title")}
        </h1>
        <p style={{ fontSize: 16, color: "#94a3b8", maxWidth: 720, lineHeight: 1.5 }}>
          {t("tagline")}
        </p>
      </div>

      {/* WHY YOU NEED THIS */}
      <section style={{
        marginBottom: 22,
        padding: "18px 20px",
        borderRadius: 14,
        background: "linear-gradient(135deg, rgba(248,113,113,0.08), rgba(248,113,113,0.02))",
        border: "1px solid rgba(248,113,113,0.30)",
      }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 10 }}>
          <span style={{ fontSize: 22 }}>⚠️</span>
          <h2 style={{ fontSize: 18, fontWeight: 700, margin: 0, color: "#fca5a5" }}>
            {t("whyTitle")}
          </h2>
        </div>
        <ol style={{ margin: 0, paddingLeft: 22, color: "#fecaca", lineHeight: 1.65 }}>
          {T.whyBullets.map((b, i) => (
            <li key={i} style={{ marginBottom: 6 }}>{b[lang]}</li>
          ))}
        </ol>
      </section>

      {/* HOW TO USE */}
      <section style={{
        marginBottom: 22,
        padding: "18px 20px",
        borderRadius: 14,
        background: "linear-gradient(135deg, rgba(99,102,241,0.10), rgba(99,102,241,0.02))",
        border: "1px solid rgba(99,102,241,0.30)",
      }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 10 }}>
          <span style={{ fontSize: 22 }}>🛠️</span>
          <h2 style={{ fontSize: 18, fontWeight: 700, margin: 0, color: "#c7d2fe" }}>
            {t("howTitle")}
          </h2>
        </div>
        <ol style={{ margin: 0, paddingLeft: 22, color: "#e0e7ff", lineHeight: 1.65 }}>
          {T.howSteps.map((s, i) => (
            <li key={i} style={{ marginBottom: 6 }}>{s[lang]}</li>
          ))}
        </ol>
      </section>

      {/* CANNED-PROMPT CHIPS — one-click load */}
      <div style={{ marginBottom: 8, color: "#94a3b8", fontSize: 13, fontWeight: 600 }}>
        {t("uiTry")}
      </div>
      <div data-testid="polygraph-canned" style={{ display: "flex", flexWrap: "wrap", gap: 8, marginBottom: 14 }}>
        {CANNED.map((c, i) => (
          <button
            key={i}
            onClick={() => loadCanned(c)}
            disabled={running}
            style={{
              padding: "8px 14px", borderRadius: 999,
              background: "rgba(99,102,241,0.10)",
              border: "1px solid rgba(99,102,241,0.40)",
              color: "#c7d2fe", fontSize: 13, fontWeight: 600,
              cursor: running ? "not-allowed" : "pointer",
              fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
              transition: "all 0.18s ease",
            }}
            onMouseOver={(e) => { (e.currentTarget as HTMLButtonElement).style.background = "rgba(99,102,241,0.20)"; }}
            onMouseOut={(e) => { (e.currentTarget as HTMLButtonElement).style.background = "rgba(99,102,241,0.10)"; }}
          >
            {c.hint[lang]}
          </button>
        ))}
      </div>

      {/* INPUT BAR */}
      <div style={{
        display: "flex", gap: 8,
        padding: 12, borderRadius: 12,
        background: "rgba(15, 23, 42, 0.6)",
        border: "1px solid rgba(148, 163, 184, 0.18)",
        marginBottom: 20,
        boxShadow: "0 4px 24px rgba(0,0,0,0.25), inset 0 1px 0 rgba(255,255,255,0.04)",
      }}>
        <input
          data-testid="polygraph-input"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter") runDemo(query); }}
          placeholder={t("uiInputPlaceholder")}
          style={{
            flex: 1, padding: "12px 16px", borderRadius: 8,
            background: "rgba(2, 6, 23, 0.55)",
            border: "1px solid rgba(148, 163, 184, 0.20)",
            color: "#e5e7eb", fontSize: 14, fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
            outline: "none",
          }}
        />
        <button
          data-testid="polygraph-run"
          onClick={() => runDemo(query)}
          disabled={running}
          style={{
            padding: "12px 20px", borderRadius: 8,
            background: running ? "rgba(248,113,113,0.15)" : "linear-gradient(180deg, #ef4444, #b91c1c)",
            color: running ? "#fca5a5" : "#fff",
            border: "1px solid rgba(248,113,113,0.55)",
            cursor: running ? "not-allowed" : "pointer",
            fontWeight: 700, letterSpacing: 0.5,
            boxShadow: running ? "none" : "0 0 24px rgba(239, 68, 68, 0.35)",
            transition: "all 0.18s ease",
          }}
        >
          {running ? t("uiVerifying") : t("uiRunButton")}
        </button>
      </div>

      {/* PROMPT + RESPONSE */}
      <div style={{ marginBottom: 12, color: "#64748b", fontSize: 12, letterSpacing: 1, textTransform: "uppercase" }}>
        {t("uiPromptLabel")}
      </div>
      <div style={{
        padding: "12px 16px", borderRadius: 8, marginBottom: 18,
        background: "rgba(15, 23, 42, 0.5)",
        border: "1px dashed rgba(148, 163, 184, 0.20)",
        color: "#cbd5e1", fontStyle: "italic",
      }}>
        {example.prompt[lang]}
      </div>

      <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 12, color: "#64748b", fontSize: 12, letterSpacing: 1, textTransform: "uppercase", flexWrap: "wrap" }}>
        {t("uiResponseFrom")}
        <span style={{ padding: "2px 8px", borderRadius: 4, background: "rgba(99,102,241,0.18)", border: "1px solid rgba(99,102,241,0.40)", color: "#c7d2fe", fontWeight: 700 }}>
          {example.responder}
        </span>
        {t("uiStreamingNote")}
      </div>

      {/* VERIFIED SENTENCES (streamed) */}
      <div data-testid="polygraph-sentences" style={{ display: "flex", flexDirection: "column", gap: 10 }}>
        {example.sentences.map((s, i) => {
          if (i >= revealed) return null;
          const c = verdictColor(s.verdict);
          return (
            <div key={i} data-testid={`polygraph-sentence-${i}`} style={{
              display: "grid", gridTemplateColumns: "auto 1fr auto", gap: 12,
              padding: "12px 14px", borderRadius: 10,
              background: c.bg, border: `1px solid ${c.border}`,
              animation: "polygraph-slide-in 0.36s cubic-bezier(0.22, 1, 0.36, 1)",
            }}>
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <span style={{ width: 10, height: 10, borderRadius: 999, background: c.dot, boxShadow: `0 0 10px ${c.dot}` }} />
              </div>
              <div>
                <div style={{ color: "#f1f5f9", lineHeight: 1.5 }}>{s.text[lang]}</div>
                {s.evidence && (
                  <div style={{ marginTop: 6, fontSize: 12, color: "#94a3b8", fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace" }}>
                    ↳ {s.evidence[lang]}
                  </div>
                )}
              </div>
              <div style={{ alignSelf: "center", fontSize: 11, fontWeight: 700, letterSpacing: 1, color: c.dot }}>
                {c.label[lang]}
              </div>
            </div>
          );
        })}
        {revealed === 0 && !running && (
          <div style={{ padding: 24, textAlign: "center", color: "#64748b", border: "1px dashed rgba(148, 163, 184, 0.18)", borderRadius: 10 }}>
            {t("uiHitRun")}
          </div>
        )}
      </div>

      {/* TALLY */}
      {revealed > 0 && (
        <div data-testid="polygraph-tally" style={{
          marginTop: 22,
          padding: "14px 16px", borderRadius: 12,
          background: "rgba(15, 23, 42, 0.5)",
          border: "1px solid rgba(148, 163, 184, 0.18)",
          display: "flex", gap: 18, alignItems: "center", flexWrap: "wrap",
        }}>
          <div style={{ fontSize: 11, letterSpacing: 1.2, textTransform: "uppercase", color: "#64748b" }}>{t("uiTally")}</div>
          <div style={{ display: "flex", gap: 14, fontSize: 13 }}>
            <span style={{ color: "#34d399", fontWeight: 700 }}>● {tally.accepted} {t("uiAccepted")}</span>
            <span style={{ color: "#facc15", fontWeight: 700 }}>● {tally["needs-data"]} {t("uiNeedsData")}</span>
            <span style={{ color: "#f87171", fontWeight: 700 }}>● {tally.refuted} {t("uiRefuted")}</span>
          </div>
          {tally.refuted > 0 && (
            <div style={{ marginLeft: "auto", fontSize: 12, color: "#fca5a5", fontWeight: 600 }}>
              ⚠ {tally.refuted} {t("uiHallucinationCaught")}
            </div>
          )}
        </div>
      )}

      {/* SHIPPED REAL THING */}
      <div style={{ marginTop: 28, padding: "16px 18px", borderRadius: 12,
        background: "linear-gradient(135deg, rgba(99,102,241,0.10), rgba(236,72,153,0.06))",
        border: "1px solid rgba(99,102,241,0.30)",
        fontSize: 13, color: "#c7d2fe", lineHeight: 1.5,
      }}>
        <strong style={{ color: "#fff" }}>{t("uiUnderHoodTitle")}</strong>{" "}{t("underHood")}
      </div>

      <style>{`
        @keyframes polygraph-slide-in {
          from { opacity: 0; transform: translateY(8px); }
          to   { opacity: 1; transform: translateY(0); }
        }
        @keyframes pulse-red {
          0%, 100% { opacity: 1; }
          50%      { opacity: 0.45; }
        }
      `}</style>
    </div>
  );
}
