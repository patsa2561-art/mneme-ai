/**
 * v2.19.78 — IDEA #1: AI POLYGRAPH (interactive web demo)
 *
 *   The flagship "scroll-stop" feature: every AI response gets a live
 *   green/yellow/red truth-meter overlay.  This component is the
 *   in-page demo simulator that shows what the browser extension will
 *   look like when shipped.
 *
 *   Design intent: "cinematic" — the user types something, sees an AI
 *   response stream in, and watches Mneme's verifier turn each
 *   sentence into a coloured verdict in real time.  Goal: 3-second
 *   "wait, what?" reaction when someone screenshots the result.
 *
 *   Limitation by design: there's no real LLM call here (would need
 *   API keys + cost + latency).  Instead, we simulate with a small
 *   library of pre-canned (prompt, response, sentence-verdicts) tuples
 *   that exercise the worst hallucination classes — version numbers
 *   that drift, function-signature lies, fake API endpoints.  When the
 *   user types a query that matches a canned pattern, we play it back
 *   with the same dramatic timing the real extension would use.
 *
 *   Real verification engine: shipped as `mneme verify` (the CLI) +
 *   `mneme.verify` (MCP tool).  The extension version will call that
 *   over a local WebSocket to the daemon; the in-page demo skips that
 *   and uses the canned scripts.
 */

import { useState, useEffect, useRef } from "react";

type Verdict = "accepted" | "needs-data" | "refuted";

interface VerifiedSentence {
  text: string;
  verdict: Verdict;
  evidence?: string;
}

interface CannedExample {
  triggerPattern: RegExp;
  triggerKeyword: string;        // human-readable for UI hint
  prompt: string;                // shown above the response
  responder: string;             // "ChatGPT-4o" / "Claude 3.7" / "Gemini 1.5 Pro"
  sentences: VerifiedSentence[];
}

// Each example is a worst-case real hallucination class the polygraph
// would catch.  Kept short + dramatic so the demo plays in <10 seconds.
const CANNED: CannedExample[] = [
  {
    triggerPattern: /react|server\s*component/i,
    triggerKeyword: "React 19 server components",
    prompt: "Does React 19 support server components in stable?",
    responder: "ChatGPT-4o",
    sentences: [
      { text: "Yes, React 19 ships with stable Server Components.", verdict: "accepted", evidence: "React 19.0.0 release notes 2024-12-05 confirm" },
      { text: "They use the 'use server' directive for actions.", verdict: "accepted", evidence: "react.dev/reference/rsc/server-functions" },
      { text: "You enable them with the experimental.serverComponents: true flag in next.config.js.", verdict: "refuted", evidence: "Next.js App Router enables RSC by default since v13.4 — no flag needed" },
      { text: "They can be marked async and return a Promise<JSX.Element>.", verdict: "accepted", evidence: "react.dev RSC reference + Next.js docs" },
      { text: "You should always wrap them in <Suspense> for streaming.", verdict: "needs-data", evidence: "Best practice depends on your data-fetching pattern; not universally required" },
    ],
  },
  {
    triggerPattern: /mneme|tool|catalog/i,
    triggerKeyword: "how many MCP tools Mneme has",
    prompt: "How many MCP tools does Mneme ship?",
    responder: "Claude 3.7",
    sentences: [
      { text: "Mneme ships exactly 1,247 MCP tools across 87 categories.", verdict: "refuted", evidence: "Live catalog reports 791 tools as of v2.19.77" },
      { text: "The main families are memory, forensics, audit, and insights.", verdict: "accepted", evidence: "Catalog families verified" },
      { text: "All tools are vendor-neutral and run locally.", verdict: "accepted", evidence: "README first-call section confirms" },
      { text: "You can call them via the MCP protocol or the CLI.", verdict: "accepted", evidence: "Two surfaces documented since v1.0" },
    ],
  },
  {
    triggerPattern: /python|asyncio|gather/i,
    triggerKeyword: "Python asyncio.gather signature",
    prompt: "What's the signature of asyncio.gather in Python 3.12?",
    responder: "Gemini 1.5 Pro",
    sentences: [
      { text: "asyncio.gather(*aws, return_exceptions=False, loop=None)", verdict: "refuted", evidence: "The `loop` parameter was REMOVED in Python 3.10; signature is now (*aws, return_exceptions=False)" },
      { text: "It returns a future that resolves when all awaitables complete.", verdict: "accepted", evidence: "Python docs asyncio.gather" },
      { text: "If return_exceptions=True, exceptions are returned as results.", verdict: "accepted", evidence: "Python docs explicit" },
      { text: "You should always prefer asyncio.TaskGroup in 3.11+.", verdict: "needs-data", evidence: "Preference depends on use case; TaskGroup adds structured concurrency but is not universally better" },
    ],
  },
];

const DEFAULT_EXAMPLE = CANNED[0]!;

function verdictColor(v: Verdict): { bg: string; border: string; dot: string; label: string } {
  switch (v) {
    case "accepted":  return { bg: "rgba(52, 211, 153, 0.10)", border: "rgba(52, 211, 153, 0.55)", dot: "#34d399", label: "ACCEPTED" };
    case "needs-data":return { bg: "rgba(250, 204, 21, 0.10)", border: "rgba(250, 204, 21, 0.55)", dot: "#facc15", label: "NEEDS-DATA" };
    case "refuted":   return { bg: "rgba(248, 113, 113, 0.12)", border: "rgba(248, 113, 113, 0.60)", dot: "#f87171", label: "REFUTED" };
  }
}

export function AiPolygraphView(): React.ReactElement {
  const [query, setQuery] = useState("");
  const [running, setRunning] = useState(false);
  const [example, setExample] = useState<CannedExample>(DEFAULT_EXAMPLE);
  const [revealed, setRevealed] = useState<number>(0);
  const timerRef = useRef<NodeJS.Timeout | null>(null);

  // Stream-reveal the sentences one at a time so the user watches the
  // verdict appear like a real-time verification — 800ms per sentence
  // gives drama without being slow.
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
    // Find the first canned example whose trigger matches the query;
    // fall back to the default if nothing matches.
    const hit = CANNED.find((c) => c.triggerPattern.test(trimmed));
    const chosen = hit ?? DEFAULT_EXAMPLE;
    setExample(chosen);
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
      {/* CINEMATIC HEADER */}
      <div style={{ marginBottom: 28 }}>
        <div style={{
          display: "inline-flex", alignItems: "center", gap: 10,
          padding: "6px 14px", borderRadius: 999,
          background: "linear-gradient(90deg, rgba(248,113,113,0.18), rgba(250,204,21,0.14), rgba(52,211,153,0.18))",
          border: "1px solid rgba(248,113,113,0.30)",
          fontSize: 11, letterSpacing: 1.2, textTransform: "uppercase",
          color: "#fca5a5",
        }}>
          <span style={{ width: 8, height: 8, borderRadius: 999, background: "#f87171", boxShadow: "0 0 12px #f87171", animation: "pulse-red 1.4s ease-in-out infinite" }} />
          live demo · IDEA #1
        </div>
        <h1 style={{ fontSize: 36, fontWeight: 800, lineHeight: 1.1, marginTop: 12, marginBottom: 8, background: "linear-gradient(180deg, #fff, #94a3b8)", WebkitBackgroundClip: "text", WebkitTextFillColor: "transparent" }}>
          AI Polygraph
        </h1>
        <p style={{ fontSize: 16, color: "#94a3b8", maxWidth: 720, lineHeight: 1.5 }}>
          Every AI response gets a <strong style={{ color: "#34d399" }}>live</strong> truth-meter overlay.
          Watch Mneme verify each sentence against the real evidence — green <span style={{ display: "inline-block", width: 8, height: 8, borderRadius: 999, background: "#34d399", verticalAlign: "middle", margin: "0 2px" }} /> = grounded · yellow <span style={{ display: "inline-block", width: 8, height: 8, borderRadius: 999, background: "#facc15", verticalAlign: "middle", margin: "0 2px" }} /> = needs-data · red <span style={{ display: "inline-block", width: 8, height: 8, borderRadius: 999, background: "#f87171", verticalAlign: "middle", margin: "0 2px" }} /> = hallucination.
        </p>
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
          placeholder='try: "react server components" · "how many mneme tools" · "asyncio.gather"'
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
          {running ? "▶ verifying…" : "▶ run polygraph"}
        </button>
      </div>

      {/* PROMPT + RESPONSE */}
      <div style={{ marginBottom: 12, color: "#64748b", fontSize: 12, letterSpacing: 1, textTransform: "uppercase" }}>
        prompt
      </div>
      <div style={{
        padding: "12px 16px", borderRadius: 8, marginBottom: 18,
        background: "rgba(15, 23, 42, 0.5)",
        border: "1px dashed rgba(148, 163, 184, 0.20)",
        color: "#cbd5e1", fontStyle: "italic",
      }}>
        {example.prompt}
      </div>

      <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 12, color: "#64748b", fontSize: 12, letterSpacing: 1, textTransform: "uppercase" }}>
        response from
        <span style={{ padding: "2px 8px", borderRadius: 4, background: "rgba(99,102,241,0.18)", border: "1px solid rgba(99,102,241,0.40)", color: "#c7d2fe", fontWeight: 700 }}>
          {example.responder}
        </span>
        — Mneme verifies each sentence as it streams
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
                <div style={{ color: "#f1f5f9", lineHeight: 1.5 }}>{s.text}</div>
                {s.evidence && (
                  <div style={{ marginTop: 6, fontSize: 12, color: "#94a3b8", fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace" }}>
                    ↳ {s.evidence}
                  </div>
                )}
              </div>
              <div style={{ alignSelf: "center", fontSize: 11, fontWeight: 700, letterSpacing: 1, color: c.dot }}>
                {c.label}
              </div>
            </div>
          );
        })}
        {revealed === 0 && !running && (
          <div style={{ padding: 24, textAlign: "center", color: "#64748b", border: "1px dashed rgba(148, 163, 184, 0.18)", borderRadius: 10 }}>
            Hit <strong style={{ color: "#cbd5e1" }}>▶ run polygraph</strong> to see the verifier stream sentence-by-sentence verdicts.
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
          display: "flex", gap: 18, alignItems: "center",
        }}>
          <div style={{ fontSize: 11, letterSpacing: 1.2, textTransform: "uppercase", color: "#64748b" }}>verdict tally</div>
          <div style={{ display: "flex", gap: 14, fontSize: 13 }}>
            <span style={{ color: "#34d399", fontWeight: 700 }}>● {tally.accepted} accepted</span>
            <span style={{ color: "#facc15", fontWeight: 700 }}>● {tally["needs-data"]} needs-data</span>
            <span style={{ color: "#f87171", fontWeight: 700 }}>● {tally.refuted} refuted</span>
          </div>
          {tally.refuted > 0 && (
            <div style={{ marginLeft: "auto", fontSize: 12, color: "#fca5a5", fontWeight: 600 }}>
              ⚠ {tally.refuted} hallucination{tally.refuted > 1 ? "s" : ""} caught — do NOT trust this response without correction.
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
        <strong style={{ color: "#fff" }}>How it works under the hood:</strong> the real engine is shipped as <code style={{ background: "rgba(2,6,23,0.5)", padding: "2px 6px", borderRadius: 4 }}>mneme verify "&lt;claim&gt;"</code> (CLI) and <code style={{ background: "rgba(2,6,23,0.5)", padding: "2px 6px", borderRadius: 4 }}>mneme.verify</code> (MCP tool).  The browser extension version (next release) wraps every AI chat surface and pipes each sentence into the verifier via a local WebSocket to the Mneme daemon — same code path, just rendered on top of <code>chat.openai.com</code> / <code>claude.ai</code> / <code>gemini.google.com</code>.
      </div>

      {/* CSS KEYFRAMES — scoped via tag injection so component is self-contained */}
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
