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
import { canonicalize } from "../protoplasm/super_quan/homograph_guard.js";

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
  /** v2.73 — homograph-guard flags when the input was canonicalized
   *  (e.g. Arabic-Indic / fullwidth digits transliterated to ASCII).
   *  Empty/absent when the input was already canonical. */
  homographFlags?: string[];
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
  const rawSentence = input.sentence.trim();
  if (!rawSentence) {
    return { verdict: "unknown", color: "grey", confidence: 0, oneLine: "empty sentence", latencyMs: 0, engine: "noop" };
  }

  // v2.73.0 — HOMOGRAPH GUARD in the CORE path (closes v2.72 vuln #2).
  // Pre-v2.73 the guard was only applied in the CLI command layer
  // (demo.ts / daemon.ts), so the HTTP bridge path saw Arabic-Indic
  // (٢), fullwidth (２), and other Unicode-digit homographs un-normalized
  // → "٢+٢=٥" slipped past the math lens (which only matches ASCII \d).
  // Now BOTH the CLI and the HTTP bridge canonicalize on the SAME shared
  // engine, so every downstream check (lenses + ACGV) sees ASCII digits.
  let sentence = rawSentence;
  let homographFlags: string[] = [];
  try {
    const c = canonicalize(rawSentence);
    if (c.flags.length > 0 && c.canonical !== rawSentence) {
      sentence = c.canonical;
      homographFlags = c.flags;
    }
  } catch { /* canonicalize is best-effort — never block the polygraph */ }

  try {
    // v2.73.0 — ALWAYS run the 6 micro-lenses (closes v2.72 vuln #3).
    // Pre-v2.73 a "generic"/short sentence returned grey at the prefilter
    // BEFORE any lens ran → the dashboard showed "0 lenses". But the
    // lenses are deterministic, in-process, sub-millisecond JS — there is
    // no cost reason to skip them. A short claim like "2+2=5" (under the
    // 12-char prefilter floor) is exactly the kind of thing the math lens
    // refutes. So lenses now run on EVERY non-empty sentence, on the
    // CANONICAL form, regardless of the heavy-ACGV prefilter.
    const lensReport = runAllLenses(sentence);
    const worthHeavyVerify = looksWorthVerifying(sentence);

    // A lens is "informative" when it fired non-grey with real weight.
    const isLensInformative = lensReport.lenses.some((l) => l.color !== "grey" && l.weight >= 0.5);

    // FAST PATH: the sentence isn't worth the heavier ACGV pass. We STILL
    // return the full lens report (so the dashboard shows 6 lenses, not
    // 0) and let a confident lens stand on its own — a deterministic math
    // refutation or a world-fact miss is not "crying wolf", it is ground
    // truth, so it may surface RED/GREEN even without ACGV.
    if (!worthHeavyVerify) {
      if (isLensInformative) {
        const friendly: BrowserPolygraphVerdict["verdict"] =
          lensReport.rolledUpColor === "red" ? "refuted"
          : lensReport.rolledUpColor === "green" ? "trustworthy"
          : "mixed";
        const color = lensReport.rolledUpColor === "grey" ? "yellow" : lensReport.rolledUpColor;
        return {
          verdict: friendly, color,
          confidence: Math.min(0.9, Math.max(...lensReport.lenses.map((l) => l.weight))),
          oneLine: homographFlags.length > 0 ? `${lensReport.rolledUpReason} · canonicalized (${homographFlags.join(", ")})` : lensReport.rolledUpReason,
          nextAction: friendly === "refuted" ? "Do not rely on this sentence." : friendly === "trustworthy" ? "Safe to rely on." : "Ask the AI to cite a specific file / function / version.",
          latencyMs: Date.now() - t0, engine: "multi-lens",
          lenses: lensReport,
          homographFlags: homographFlags.length > 0 ? homographFlags : undefined,
        };
      }
      // No lens fired + not worth ACGV → genuinely-unknown, but now WITH
      // the (all-grey) lens report attached so the UI shows 6 lenses.
      return {
        verdict: "unknown", color: "grey", confidence: 0,
        oneLine: homographFlags.length > 0 ? `no specific entities to verify · canonicalized (${homographFlags.join(", ")})` : "no specific entities to verify",
        latencyMs: Date.now() - t0, engine: "prefilter",
        lenses: lensReport,
        homographFlags: homographFlags.length > 0 ? homographFlags : undefined,
      };
    }

    // HEAVY PATH: worth a full ACGV pass.
    // Always use propositional engine in the browser path: z3 spawns a
    // worker + can take 1-3s. The browser polygraph is per-sentence on a
    // streaming response; we MUST stay under ~300ms.
    const result = runACGV({ claim: sentence, repoRoot: input.repoRoot });
    // v2.28.0 R3 fix — surface INPUT_TRUNCATED / INPUT_UNVERIFIABLE
    // caveats in the polygraph response so the browser dot tooltip can
    // show the user WHY the verdict is uncertain. Pre-v2.28 these
    // caveats were dropped silently before they reached the userscript.
    const truncated = result.caveats.find((c) => c.startsWith("INPUT_TRUNCATED"));
    const unverifiable = result.caveats.find((c) => c.startsWith("INPUT_UNVERIFIABLE:"));
    if (truncated) {
      return {
        verdict: "unknown", color: "grey", confidence: 0,
        oneLine: `input truncated (${truncated.split(":")[1] ?? "over cap"}) — split into smaller sentences`,
        latencyMs: Date.now() - t0, engine: "input-guard",
        lenses: lensReport,
        homographFlags: homographFlags.length > 0 ? homographFlags : undefined,
      };
    }
    if (unverifiable) {
      const kind = unverifiable.split(":")[1] ?? "INVALID";
      return {
        verdict: "unknown", color: "grey", confidence: 0,
        oneLine: `unverifiable input: ${kind.toLowerCase().replace(/_/g, " ")}`,
        latencyMs: Date.now() - t0, engine: "input-guard",
        lenses: lensReport,
        homographFlags: homographFlags.length > 0 ? homographFlags : undefined,
      };
    }
    // v2.19.91 — lensReport (computed at the top on the canonical form).
    // If any lens fires RED with high weight, the lens verdict overrides
    // ACGV (lenses know world facts ACGV doesn't).
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
    const baseOneLine = isLensInformative && lensReason
      ? lensReason
      : friendly === "trustworthy"
        ? `verified · ${result.verdict.toLowerCase()} (${Math.round(result.confidence * 100)}%)`
        : friendly === "refuted" || friendly === "impossible"
          ? `refuted · ${result.verdict.toLowerCase()} (${Math.round(result.confidence * 100)}%)`
          : `no specific entity to verify`;
    const oneLine = homographFlags.length > 0 ? `${baseOneLine} · canonicalized (${homographFlags.join(", ")})` : baseOneLine;
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
      homographFlags: homographFlags.length > 0 ? homographFlags : undefined,
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
