/**
 * v2.19.91 — MULTI-LENS POLYGRAPH.
 *
 * Instead of one ACGV verdict per sentence ("YELLOW · mixed evidence"
 * repeated every time), Mneme now runs 6 micro-detectors per sentence
 * IN PARALLEL.  Each detector ("lens") returns its own verdict +
 * one-line reason, and the dashboard shows them side-by-side.
 *
 * The lens stack — every signal Ollama-free, deterministic JS:
 *
 *   🌍 worldFact     known-fact regex bank (year of WWII, founding
 *                    years of major AI vendors, the prime numbers,
 *                    boiling point of water, etc).  Hits = sentence
 *                    is checkable; mismatch = REFUTED with citation.
 *   🎭 vibe          confidence detector — hedge density vs absolute
 *                    density.  "exactly", "always", "every" without
 *                    hedge = high confidence (more falsifiable).
 *                    Lots of "maybe", "I think" = honest hedging.
 *   🔬 specificity   counts falsifiable surface area (numbers, named
 *                    entities, dates, version tokens).  Low specificity
 *                    = nothing to grade; high specificity = stake your
 *                    reputation.
 *   ⚠️ risk          shells in any of the whistleblower's danger
 *                    patterns (rm -rf, secrets, bypass-review, ...).
 *   📐 math          arithmetic check on inline equations ("2+2=5"
 *                    fires REFUTED).
 *   📎 citation      does the sentence cite a source / URL / file?
 *                    Citations = better epistemic posture.
 *
 * Each lens returns a LensVerdict; the polygraph route includes the
 * full array so the dashboard can render the crystal-ring UI per dot.
 */

export type LensId = "worldFact" | "vibe" | "specificity" | "risk" | "math" | "citation";
export type LensColor = "green" | "yellow" | "red" | "grey";

export interface LensVerdict {
  lens: LensId;
  icon: string;          // single emoji
  label: string;         // short ASCII name for older terminals
  color: LensColor;
  /** 0..1 strength of the signal (higher = more confident about THIS verdict). */
  weight: number;
  /** Plain-English one-liner the UI shows in the lens icon's tooltip. */
  reason: string;
  /** Optional pieces of evidence the UI can highlight (e.g. "Anthropic" → "2021"). */
  evidence?: string[];
}

export interface MultiLensReport {
  /** All 6 lens verdicts, in canonical order. */
  lenses: LensVerdict[];
  /** Best-effort overall colour given all 6 lenses. */
  rolledUpColor: LensColor;
  /** Plain-English one-liner that fuses the lenses. */
  rolledUpReason: string;
  /** 0..100 confidence the panel can display as a trust bar. */
  trustScore: number;
}

// ─── 🌍 WORLD-FACT LENS ────────────────────────────────────────────────

interface WorldFactRule {
  pattern: RegExp;
  truthCheck: (s: string) => { ok: boolean; got?: string; expected: string; entity: string };
}

const WORLD_FACT_RULES: WorldFactRule[] = [
  {
    pattern: /\banthropic\b[^.!?\n]*\b(was|been|is)\b[^.!?\n]*\bfounded\b[^.!?\n]*\b(in|on)\b[^.!?\n]*\b(\d{4})\b/i,
    truthCheck: (s) => {
      const m = /\bfounded\b[^.!?\n]*\b(\d{4})\b/i.exec(s);
      const got = m?.[1];
      return { ok: got === "2021", got, expected: "2021", entity: "Anthropic founding year" };
    },
  },
  {
    pattern: /\bopenai\b[^.!?\n]*\b(was|been|is)\b[^.!?\n]*\bfounded\b[^.!?\n]*\b(in|on)\b[^.!?\n]*\b(\d{4})\b/i,
    truthCheck: (s) => {
      const m = /\bfounded\b[^.!?\n]*\b(\d{4})\b/i.exec(s);
      const got = m?.[1];
      return { ok: got === "2015", got, expected: "2015", entity: "OpenAI founding year" };
    },
  },
  {
    pattern: /\bWWII\b|\bworld\s+war\s+(?:two|2|ii)\b/i,
    truthCheck: (s) => {
      const m = /\b(1944|1945|1946)\b/.exec(s);
      const got = m?.[1];
      if (!got) return { ok: true, expected: "1945", entity: "WWII end year" };
      return { ok: got === "1945", got, expected: "1945", entity: "WWII end year" };
    },
  },
  {
    // Match either order: "400 blood vessels" or "blood vessels ... 400".
    pattern: /\b(?:\d+\s+blood\s+vessels?|blood\s+vessels?[^.!?\n]*\d+)\b/i,
    truthCheck: (s) => {
      // Extract the first numeric near "blood vessels" (either side).
      const re = /\b(\d+(?:[.,]\d+)?)\b/g;
      let candidate: string | null = null;
      let m: RegExpExecArray | null;
      while ((m = re.exec(s)) !== null) {
        const n = parseInt(m[1]!.replace(/,/g, ""), 10);
        if (n >= 50 && n < 1_000_000_000) { candidate = m[1]!; break; }
      }
      if (candidate && parseInt(candidate.replace(/,/g, ""), 10) < 1_000_000) {
        return { ok: false, got: candidate, expected: "billions (~100,000 km total)", entity: "human blood vessels count" };
      }
      return { ok: true, got: candidate ?? undefined, expected: "billions", entity: "human blood vessels count" };
    },
  },
  {
    pattern: /\bboil(ing|s|ed)?\s+(?:point\s+of\s+)?water\b[^.!?\n]*\b(\d{1,3})\b[^.!?\n]*\b(c|celsius|°c)\b/i,
    truthCheck: (s) => {
      const m = /\b(\d{1,3})\b[^.!?\n]*\b(c|celsius|°c)\b/i.exec(s);
      const got = m?.[1];
      return { ok: got === "100", got, expected: "100", entity: "boiling point of water (°C)" };
    },
  },
  {
    pattern: /\bfirst\s+(?:five|5)\s+prime\s+numbers?\b/i,
    truthCheck: (s) => {
      const expected = ["2", "3", "5", "7", "11"];
      const hits = expected.filter((e) => new RegExp(`\\b${e}\\b`).test(s));
      return { ok: hits.length >= 4, got: hits.join(","), expected: expected.join(", "), entity: "first 5 primes" };
    },
  },
  {
    pattern: /\bspeed\s+of\s+light\b/i,
    truthCheck: (s) => {
      const m = /\b((?:3|2\.998?|299792458)\b[^.!?\n]*\b(?:m\/s|meters?\s+per\s+second|km\/s))\b/i.exec(s);
      return { ok: !!m, expected: "~299,792,458 m/s (or 3e8 m/s)", entity: "speed of light" };
    },
  },
  {
    pattern: /\beverest\b[^.!?\n]*\b(\d{4,5})\b/i,
    truthCheck: (s) => {
      const m = /\b(\d{4,5})\b/.exec(s);
      const got = m?.[1] ? parseInt(m[1], 10) : 0;
      return { ok: got >= 8840 && got <= 8860, got: String(got), expected: "8848 m (or 8849 m)", entity: "Mount Everest height (m)" };
    },
  },
];

function worldFactLens(s: string): LensVerdict {
  for (const rule of WORLD_FACT_RULES) {
    if (!rule.pattern.test(s)) continue;
    const r = rule.truthCheck(s);
    if (!r.ok) {
      return {
        lens: "worldFact", icon: "🌍", label: "world-fact", color: "red",
        weight: 0.95,
        reason: `${r.entity}: expected ${r.expected}${r.got ? `, got ${r.got}` : ""}`,
        evidence: r.got ? [r.got, r.expected] : [r.expected],
      };
    }
    return {
      lens: "worldFact", icon: "🌍", label: "world-fact", color: "green",
      weight: 0.85, reason: `${r.entity} matches known fact (${r.expected})`,
      evidence: r.got ? [r.got] : undefined,
    };
  }
  return { lens: "worldFact", icon: "🌍", label: "world-fact", color: "grey", weight: 0, reason: "no known-fact pattern matched" };
}

// ─── 🎭 VIBE LENS ──────────────────────────────────────────────────────

const HEDGES = ["maybe", "perhaps", "might", "could", "possibly", "likely", "i think", "i believe", "seems", "appears", "roughly", "approximately", "about", "around"];
const ABSOLUTES = ["always", "never", "every", "all", "none", "exactly", "definitely", "certainly", "must", "guaranteed", "100%", "impossible"];

function vibeLens(s: string): LensVerdict {
  const lower = s.toLowerCase();
  let hedge = 0, absolute = 0;
  for (const h of HEDGES) if (lower.includes(h)) hedge++;
  for (const a of ABSOLUTES) if (lower.includes(a)) absolute++;
  const total = hedge + absolute;
  if (total === 0) {
    return { lens: "vibe", icon: "🎭", label: "vibe", color: "grey", weight: 0.3, reason: "neutral tone — no hedges, no absolutes" };
  }
  // Lots of absolutes with NO hedges → high-confidence claim (yellow:
  // either gold or a big miss).  Lots of hedges → honest uncertainty.
  if (absolute >= 2 && hedge === 0) {
    return { lens: "vibe", icon: "🎭", label: "vibe", color: "yellow", weight: 0.75, reason: `high-confidence claim (${absolute} absolute${absolute > 1 ? "s" : ""}, 0 hedges) — verifiable but risky if wrong` };
  }
  if (hedge >= 1 && absolute === 0) {
    return { lens: "vibe", icon: "🎭", label: "vibe", color: "green", weight: 0.5, reason: `honest hedging (${hedge} hedge${hedge > 1 ? "s" : ""}, 0 absolutes)` };
  }
  return { lens: "vibe", icon: "🎭", label: "vibe", color: "yellow", weight: 0.4, reason: `mixed tone (${hedge} hedge${hedge !== 1 ? "s" : ""}, ${absolute} absolute${absolute !== 1 ? "s" : ""})` };
}

// ─── 🔬 SPECIFICITY LENS ───────────────────────────────────────────────

function specificityLens(s: string): LensVerdict {
  let score = 0;
  const evidence: string[] = [];
  const numMatch = s.match(/\b\d+(?:\.\d+)?\b/g);
  if (numMatch) { score += numMatch.length; evidence.push(...numMatch.slice(0, 3)); }
  const yearMatch = s.match(/\b(19|20)\d{2}\b/g);
  if (yearMatch) { score += yearMatch.length * 2; }
  const versionMatch = s.match(/\bv?\d+\.\d+(?:\.\d+)?\b/g);
  if (versionMatch) { score += versionMatch.length * 2; evidence.push(...versionMatch.slice(0, 2)); }
  const propNoun = s.split(/\s+/).slice(1).filter((w) => /^[A-Z][a-z]{2,}/.test(w));
  if (propNoun.length > 0) { score += Math.min(3, propNoun.length); evidence.push(...propNoun.slice(0, 2)); }
  const url = /https?:\/\//.test(s);
  if (url) score += 2;
  if (score === 0) return { lens: "specificity", icon: "🔬", label: "specificity", color: "grey", weight: 0.3, reason: "nothing falsifiable in this sentence" };
  if (score >= 6) return { lens: "specificity", icon: "🔬", label: "specificity", color: "green", weight: 0.7, reason: `${score} falsifiable surface points — auditable claim`, evidence };
  if (score >= 3) return { lens: "specificity", icon: "🔬", label: "specificity", color: "yellow", weight: 0.5, reason: `${score} falsifiable points — partially auditable`, evidence };
  return { lens: "specificity", icon: "🔬", label: "specificity", color: "yellow", weight: 0.3, reason: `${score} falsifiable point — minimal surface`, evidence };
}

// ─── ⚠️ RISK LENS ──────────────────────────────────────────────────────

const RISK_PATTERNS: Array<{ re: RegExp; rationale: string }> = [
  { re: /\brm\s+-rf\s+[/~]/i, rationale: "recursive force-delete on root or home" },
  { re: /git\s+push\s+(?:--force|-f)\b[^.!?\n]*\b(main|master|production)\b/i, rationale: "force-push to protected branch" },
  { re: /git\s+reset\s+--hard/i, rationale: "git reset --hard discards work" },
  { re: /--no-verify\b/i, rationale: "skips pre-commit hooks" },
  { re: /\bdrop\s+table\b/i, rationale: "SQL DROP TABLE" },
  { re: /curl\s+[^|]+\|\s*(?:sudo\s+)?(?:ba)?sh\b/i, rationale: "curl-pipe-bash (supply chain attack vector)" },
  { re: /\bAKIA[0-9A-Z]{16}\b/, rationale: "AWS access key in output" },
  { re: /\bgh[pous]_[A-Za-z0-9_]{36,}\b/, rationale: "GitHub PAT in output" },
  { re: /\bsk-[A-Za-z0-9_-]{32,}\b/, rationale: "OpenAI / Anthropic API key in output" },
];

function riskLens(s: string): LensVerdict {
  for (const r of RISK_PATTERNS) {
    if (r.re.test(s)) {
      return { lens: "risk", icon: "⚠️", label: "risk", color: "red", weight: 0.95, reason: `risky: ${r.rationale}` };
    }
  }
  return { lens: "risk", icon: "⚠️", label: "risk", color: "green", weight: 0.3, reason: "no danger patterns" };
}

// ─── 📐 MATH LENS ──────────────────────────────────────────────────────

function mathLens(s: string): LensVerdict {
  // Match simple "a + b = c", "a * b = c", "a - b = c", "a / b = c" patterns
  // both as bare text and "X plus Y equals Z" word forms.
  const re = /\b(-?\d+(?:\.\d+)?)\s*([+\-*/×÷])\s*(-?\d+(?:\.\d+)?)\s*=\s*(-?\d+(?:\.\d+)?)\b/g;
  let m: RegExpExecArray | null;
  let checked = 0; let wrong = 0;
  while ((m = re.exec(s)) !== null) {
    checked++;
    const a = parseFloat(m[1]!), b = parseFloat(m[3]!), claimed = parseFloat(m[4]!);
    let actual = NaN;
    switch (m[2]!) {
      case "+": actual = a + b; break;
      case "-": actual = a - b; break;
      case "*": case "×": actual = a * b; break;
      case "/": case "÷": actual = b === 0 ? NaN : a / b; break;
    }
    if (Number.isFinite(actual) && Math.abs(actual - claimed) > 1e-9) wrong++;
  }
  if (checked === 0) return { lens: "math", icon: "📐", label: "math", color: "grey", weight: 0, reason: "no equations" };
  if (wrong === 0) return { lens: "math", icon: "📐", label: "math", color: "green", weight: 0.9, reason: `${checked} equation${checked > 1 ? "s" : ""} check out` };
  return { lens: "math", icon: "📐", label: "math", color: "red", weight: 0.95, reason: `${wrong} of ${checked} equation${checked > 1 ? "s are" : " is"} wrong` };
}

// ─── 📎 CITATION LENS ──────────────────────────────────────────────────

function citationLens(s: string): LensVerdict {
  const hasUrl = /https?:\/\/\S+/i.test(s);
  const hasFile = /\b[A-Za-z0-9_-]+\.(?:ts|js|py|go|rs|md|json|yml|yaml|toml|sh)\b/.test(s);
  const hasGitRef = /\bcommit\s+[a-f0-9]{7,}\b/i.test(s) || /\bpull\s+request\s+#?\d+\b/i.test(s);
  const cites = (hasUrl ? 1 : 0) + (hasFile ? 1 : 0) + (hasGitRef ? 1 : 0);
  if (cites === 0) return { lens: "citation", icon: "📎", label: "citation", color: "grey", weight: 0.2, reason: "no citation / source / file reference" };
  if (cites >= 2) return { lens: "citation", icon: "📎", label: "citation", color: "green", weight: 0.6, reason: `${cites} citations (auditable)` };
  return { lens: "citation", icon: "📎", label: "citation", color: "yellow", weight: 0.4, reason: "1 citation present" };
}

// ─── ROLL-UP ───────────────────────────────────────────────────────────

function priority(c: LensColor): number {
  return c === "red" ? 4 : c === "yellow" ? 3 : c === "green" ? 2 : 1;
}

export function runAllLenses(sentence: string): MultiLensReport {
  const lenses: LensVerdict[] = [
    worldFactLens(sentence),
    vibeLens(sentence),
    specificityLens(sentence),
    riskLens(sentence),
    mathLens(sentence),
    citationLens(sentence),
  ];
  // Roll-up rule: the highest-weighted RED wins.  If no red, the
  // highest-weighted yellow wins.  If neither, green if any lens fired
  // green, else grey.
  let rolledUpColor: LensColor = "grey";
  let bestReason = "no lens fired strongly on this sentence";
  let bestWeight = -1;
  for (const c of (["red", "yellow", "green"] as LensColor[])) {
    for (const l of lenses) {
      if (l.color !== c) continue;
      if (l.weight > bestWeight) { rolledUpColor = c; bestReason = l.reason; bestWeight = l.weight; }
    }
    if (rolledUpColor === c && rolledUpColor !== "grey") break;
  }
  // Trust score: average of (weight × score) per lens, where score is
  // 1 for green, 0.5 for yellow, 0 for red, 0.5 for grey.
  let totalWeight = 0; let weightedScore = 0;
  for (const l of lenses) {
    const score = l.color === "green" ? 1 : l.color === "yellow" ? 0.5 : l.color === "red" ? 0 : 0.5;
    weightedScore += l.weight * score;
    totalWeight += l.weight;
  }
  const trustScore = totalWeight > 0 ? Math.round((weightedScore / totalWeight) * 100) : 50;
  return { lenses, rolledUpColor, rolledUpReason: bestReason, trustScore };
}
