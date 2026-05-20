/**
 * v2.19.80 — BROWSER POLYGRAPH ENGINE.
 *
 * Closes the gap from IDEA #1 (AI POLYGRAPH): the web demo at #polygraph
 * is interactive but until now Mneme had no way to verify a sentence
 * streaming out of claude.ai / chatgpt.com / gemini.google.com /
 * copilot.microsoft.com in real time.
 *
 * Two halves:
 *   1. `verifyBrowserSentence()` — server-side: takes a single AI-uttered
 *      sentence, decides whether it has enough "specific-entity" signal
 *      to be worth running through ACGV, then runs it and normalises
 *      the verdict into a wire-shape the browser can render as a dot.
 *   2. `extractVerifiableSentences()` — sentence chunker the userscript
 *      uses on the streaming response. Filters fillers / short / opinion
 *      strings so the bridge isn't pinged on every "Let me think...".
 *
 * Composes with: SQUADRON ACGV (truth check engine), HTTP BRIDGE
 * (transport), PERMEATE USERSCRIPT (renderer), AI POLYGRAPH dashboard
 * view (canonical demo).
 *
 * Design rules (LOAD-BEARING — do not erode):
 *  - NEVER throw. The polygraph runs in the user's eye-line; a 500 surfaces
 *    as a broken dot in their AI chat. On any error → `unknown / grey`.
 *  - Default to YELLOW for anything ambiguous. RED only when ACGV gives
 *    an actual refutation. The polygraph errs toward "I don't know" rather
 *    than crying wolf — false-positive REDs would teach the user to
 *    distrust the polygraph itself.
 *  - Server-side latency budget: <300ms per sentence (fast path uses
 *    propositional ACGV, never z3, to stay snappy under streaming load).
 */

import { runACGV, type ACGVResult } from "../squadron/acgv.js";
import { runAllLenses, type MultiLensReport } from "../polygraph_lenses/index.js";

/** Wire-format verdict returned to the browser userscript. Kept tiny on
 *  purpose — the userscript renders this next to a single sentence and
 *  cannot afford deep nesting. */
export interface BrowserPolygraphVerdict {
  verdict: "trustworthy" | "mixed" | "refuted" | "impossible" | "unknown";
  color: "green" | "yellow" | "red" | "grey";
  confidence: number;
  oneLine: string;
  nextAction?: string;
  latencyMs: number;
  engine: string;
  /** v2.19.91 — Multi-lens detector results so the dashboard can render
   *  the crystal-ring UI with per-lens icons + tooltips. */
  lenses?: MultiLensReport;
}

/** Map ACGV's internal verdict family to the friendlier 5-state used by
 *  the browser. Mirrors the mapping in `mneme.truth.check` MCP tool. */
function toFriendlyVerdict(acgv: ACGVResult["verdict"]): BrowserPolygraphVerdict["verdict"] {
  switch (acgv) {
    case "FUSION":            return "trustworthy";
    case "LIMBO":             return "mixed";
    case "PASSTHROUGH":       return "mixed";
    case "BLACK_HOLE":        return "refuted";
    case "IMPOSSIBLE_REFUTE": return "impossible";
    case "AUTO_REFUTE":       return "impossible";
    default:                  return "mixed";
  }
}

function toColor(v: BrowserPolygraphVerdict["verdict"]): BrowserPolygraphVerdict["color"] {
  if (v === "trustworthy")             return "green";
  if (v === "refuted" || v === "impossible") return "red";
  if (v === "unknown")                 return "grey";
  return "yellow"; // mixed → caution
}

/** Quick heuristic: does the sentence carry "specific entities" worth
 *  running through ACGV? If not, we save a round-trip and return grey.
 *
 *  WHY: a polite filler like "Let me think about that" has no extractable
 *  facts. ACGV would correctly mark it MIXED and waste ~30ms. We pre-filter
 *  to keep streaming render-rate snappy. */
export function looksWorthVerifying(sentence: string): boolean {
  const s = sentence.trim();
  if (s.length < 12) return false;                    // too short to carry a claim
  if (/^(let me|i think|i believe|in my opinion|maybe|perhaps|i'm not sure|actually,|so,)/i.test(s)) return false;
  // At least ONE of: a digit, a version-like token, a file/symbol with dots,
  // a proper-noun (capitalised word that isn't sentence-initial), a CamelCase
  // identifier, a percentage, or a quoted code/value.
  // NOTE: do NOT close `\b\d+...` with a trailing `\b` — `\b` does not exist
  // between `\d` and `\w` (e.g. `250ms`), so the boundary check breaks valid
  // numeric-claim sentences. Leading boundary is enough.
  const digitOrPct = /\b\d+(\.\d+)?/.test(s);
  const versionish = /\bv?\d+\.\d+(\.\d+)?/.test(s);
  const dottedSymbol = /\b[a-zA-Z_][\w]*\.[a-zA-Z_][\w]*/.test(s);
  const camelCase = /\b[a-z]+[A-Z][\w]*/.test(s);
  // Strip the very first word before checking proper nouns (avoid sentence-initial caps).
  const tail = s.split(/\s+/).slice(1).join(" ");
  const properNoun = /\b[A-Z][a-z]{2,}/.test(tail);
  const codeQuote = /`[^`]{2,}`|"[^"]{3,}"/.test(s);
  return digitOrPct || versionish || dottedSymbol || camelCase || properNoun || codeQuote;
}

/** Split an AI response into candidate sentences. Handles English `.!?`,
 *  Japanese/Chinese `。`, Thai `ฯ` end-mark, and Markdown bullets / line
 *  breaks. Returns ALL sentences (filter happens in `looksWorthVerifying`). */
export function extractVerifiableSentences(responseText: string): string[] {
  if (!responseText) return [];
  // Strip code blocks — we don't polygraph code (yet). Replace with placeholder
  // so adjacent sentences aren't accidentally merged.
  const noCode = responseText.replace(/```[\s\S]*?```/g, " ¶CODE¶ ");
  // CJK + Thai terminators don't always carry trailing whitespace
  // (`これはテストです。次の文。` is two sentences with no space). Force a
  // newline after every CJK/Thai end-mark so the split regex below can
  // rely on whitespace.
  const normalised = noCode.replace(/([。ฯ])/g, "$1\n");
  // Split on common sentence terminators (English + normalised CJK/Thai).
  const raw = normalised
    .split(/(?<=[.!?])\s+|\n+|^\s*[-*]\s+/m)
    .map((s) => s.trim())
    .filter((s) => s.length > 0 && s !== "¶CODE¶");
  return raw;
}

/** The core server-side verifier. Composed of: looksWorthVerifying →
 *  runACGV → friendlify → colorize. Wrapped in try/catch so a single
 *  failure can't crash the bridge. */
export async function verifyBrowserSentence(input: {
  sentence: string;
  context?: string;
  vendor?: string;
  repoRoot: string;
}): Promise<BrowserPolygraphVerdict> {
  const t0 = Date.now();
  const sentence = input.sentence.trim();
  if (!sentence) {
    return { verdict: "unknown", color: "grey", confidence: 0, oneLine: "empty sentence", latencyMs: 0, engine: "noop" };
  }
  if (!looksWorthVerifying(sentence)) {
    return {
      verdict: "unknown", color: "grey", confidence: 0,
      oneLine: "no specific entities to verify",
      latencyMs: Date.now() - t0, engine: "prefilter",
    };
  }
  try {
    // Always use propositional engine in the browser path: z3 spawns a
    // worker + can take 1-3s. The browser polygraph is per-sentence on a
    // streaming response; we MUST stay under ~300ms.
    const result = runACGV({ claim: sentence, repoRoot: input.repoRoot });
    // v2.19.91 — Run the 6 micro-lenses in parallel.  If any lens fires
    // RED with high weight, the lens verdict overrides ACGV (lenses know
    // world facts ACGV doesn't).
    const lensReport = runAllLenses(sentence);
    let friendly = toFriendlyVerdict(result.verdict);
    let color = toColor(friendly);
    // Lens override: a confident lens verdict wins over a mixed ACGV.
    if (lensReport.rolledUpColor === "red" && (friendly === "mixed" || friendly === "unknown")) {
      friendly = "refuted"; color = "red";
    } else if (lensReport.rolledUpColor === "green" && friendly === "mixed") {
      friendly = "trustworthy"; color = "green";
    }
    // One-liner now favours the lens reason when it's stronger than
    // ACGV's generic "mixed evidence" line.
    const lensReason = lensReport.rolledUpReason;
    const isLensInformative = lensReport.lenses.some((l) => l.color !== "grey" && l.weight >= 0.5);
    const oneLine = isLensInformative && lensReason
      ? lensReason
      : friendly === "trustworthy"
        ? `verified · ${result.verdict.toLowerCase()} (${Math.round(result.confidence * 100)}%)`
        : friendly === "refuted" || friendly === "impossible"
          ? `refuted · ${result.verdict.toLowerCase()} (${Math.round(result.confidence * 100)}%)`
          : `no specific entity to verify`;
    return {
      verdict: friendly,
      color,
      confidence: result.confidence,
      oneLine,
      nextAction: friendly === "refuted" || friendly === "impossible"
        ? "Do not rely on this sentence — re-prompt for a specific source."
        : friendly === "trustworthy"
          ? "Safe to rely on."
          : "Ask the AI to cite a specific file / function / version.",
      latencyMs: Date.now() - t0,
      engine: "multi-lens",
      lenses: lensReport,
    };
  } catch (e) {
    // Defensive: ACGV throwing is unexpected but we MUST not bubble the
    // error to the browser. Surface a grey dot.
    return {
      verdict: "unknown", color: "grey", confidence: 0,
      oneLine: `polygraph error · ${(e as Error).message || "unknown"}`,
      latencyMs: Date.now() - t0, engine: "error",
    };
  }
}
